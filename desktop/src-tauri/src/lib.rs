use std::fs;
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv6Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::Path;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BACKEND_PORT: u16 = 8080;

/// The app's own databases (#277): compose project, file and containers. Kept
/// apart from the dev scripts' "nexusnotes" project, with passwords per install.
const APP_PROJECT: &str = "nexusnotes-app";
const APP_COMPOSE_FILE: &str = "docker-compose.app.yml";
const APP_POSTGRES: &str = "nexusnotes-app-postgres-1";
const APP_REDIS: &str = "nexusnotes-app-redis-1";
const APP_DB_PORT: u16 = 5433;
const APP_REDIS_PORT: u16 = 6380;

/// Files in the app's local data dir holding this install's database and Redis
/// passwords. Either may be regenerated: the role is re-keyed on every start and
/// Redis takes its password from the container's environment.
const DB_PASSWORD_FILE: &str = "db-password";
const REDIS_PASSWORD_FILE: &str = "redis-password";

/// Written once the notes of the shared dev database (used by app builds before
/// #277) were copied into the app's own database, or there were none to copy.
const LEGACY_MIGRATED_FILE: &str = "legacy-db-migrated";

/// The dev scripts' compose project, which older app builds shared: its Postgres
/// volume holds those installs' notes under the well-known dev password.
const LEGACY_PROJECT: &str = "nexusnotes";
const LEGACY_COMPOSE_FILE: &str = "docker-compose.dev.yml";
const LEGACY_POSTGRES: &str = "nexusnotes-postgres-1";
const LEGACY_VOLUME: &str = "nexusnotes_postgres_dev_data";

/// File in the app's local data dir holding this install's JWT signing secret.
const JWT_SECRET_FILE: &str = "jwt-secret";

/// File in the app's local data dir holding this install's key for encrypting
/// user data at rest (#353). Unlike the JWT secret it is never replaced or
/// swapped for a per-run value: data written under a lost key is unreadable.
const DATA_KEY_FILE: &str = "data-encryption-key";

/// Object storage for attachments: the MinIO service of the bundled dev compose
/// file, bound to localhost only. The credentials are the compose file's fixed
/// dev values; unlike the databases (#277) MinIO is still shared with the dev
/// scripts.
const MINIO_PORT: u16 = 9000;
const MINIO_ACCESS_KEY: &str = "nexus_minio";
const MINIO_SECRET_KEY: &str = "nexus_minio_dev";
const MINIO_BUCKET: &str = "attachments";

/// How long startup waits for MinIO before running the backend without attachments.
const MINIO_READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Bytes of CSPRNG output per secret; hex-encoded to twice as many characters.
const SECRET_BYTES: usize = 32;

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}

/// A fresh secret: `SECRET_BYTES` from the OS CSPRNG, hex-encoded.
fn generate_secret() -> io::Result<String> {
    let mut bytes = [0u8; SECRET_BYTES];
    // getrandom's error only implements std::error::Error with its "std" feature.
    getrandom::fill(&mut bytes).map_err(|err| io::Error::other(err.to_string()))?;
    Ok(to_hex(&bytes))
}

/// True for a secret shaped like the ones `generate_secret` makes. Anything else
/// (empty, cut short by a crash, the old "dev-secret") gets replaced.
fn is_valid_secret(secret: &str) -> bool {
    secret.len() >= SECRET_BYTES * 2 && secret.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Creates a new file that only the current user can read, where the OS allows it.
#[cfg(unix)]
fn create_private_file(path: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

/// On Windows the file inherits the ACL of the per-user app data directory,
/// which grants access to the user (plus SYSTEM and administrators) only.
#[cfg(not(unix))]
fn create_private_file(path: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

/// Writes through a temp file and a rename, so a crash never leaves a half-written file.
fn write_private(path: &Path, contents: &str) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp); // left over from an interrupted earlier write
    {
        let mut file = create_private_file(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

/// Returns the secret stored at `path`, generating and storing one on first run.
fn load_or_create_secret(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Ok(contents) if is_valid_secret(contents.trim()) => return Ok(contents.trim().to_owned()),
        Ok(_) => eprintln!(
            "[backend] replacing the invalid secret in {}",
            path.display()
        ),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    let secret = generate_secret()?;
    write_private(path, &secret)?;
    Ok(secret)
}

/// Returns the data encryption key stored at `path`, generating and storing one
/// on first run. A file that exists but does not hold a valid key is an error,
/// never overwritten: the rows encrypted under it would be lost for good.
fn load_or_create_data_key(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let key = contents.trim();
            if key.len() == SECRET_BYTES * 2 && is_valid_secret(key) {
                Ok(key.to_owned())
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "{} does not hold a valid data encryption key; restore it from a backup",
                        path.display()
                    ),
                ))
            }
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            let key = generate_secret()?;
            write_private(path, &key)?;
            Ok(key)
        }
        Err(err) => Err(err),
    }
}

/// This install's data encryption key. There is no per-run fallback: data
/// encrypted under a key that is not kept could never be read again.
fn backend_data_key(app: &tauri::AppHandle) -> io::Result<String> {
    let dir = app.path().app_local_data_dir().map_err(io::Error::other)?;
    load_or_create_data_key(&dir.join(DATA_KEY_FILE))
}

/// This install's JWT secret, kept in the app's local data dir so sign-ins survive
/// restarts. If it cannot be stored, a secret for this run only is still far better
/// than a shared constant: open sessions then renew through their refresh token.
fn backend_jwt_secret(app: &tauri::AppHandle) -> io::Result<String> {
    let stored = app
        .path()
        .app_local_data_dir()
        .map_err(io::Error::other)
        .and_then(|dir| load_or_create_secret(&dir.join(JWT_SECRET_FILE)));
    stored.or_else(|err| {
        eprintln!("[backend] cannot store the JWT secret ({err}); using one for this run only");
        generate_secret()
    })
}

/// This install's database and Redis passwords (#277), created on first run. If
/// they cannot be stored the databases cannot be reached across restarts, so
/// there is no per-run fallback: the error stops the backend from starting.
struct DbSecrets {
    db_password: String,
    redis_password: String,
}

fn backend_db_secrets(app: &tauri::AppHandle) -> io::Result<DbSecrets> {
    let dir = app.path().app_local_data_dir().map_err(io::Error::other)?;
    Ok(DbSecrets {
        db_password: load_or_create_secret(&dir.join(DB_PASSWORD_FILE))?,
        redis_password: load_or_create_secret(&dir.join(REDIS_PASSWORD_FILE))?,
    })
}

fn database_url(password: &str) -> String {
    format!("postgres://nexus:{password}@localhost:{APP_DB_PORT}/nexus_notes?sslmode=disable")
}

fn redis_url(password: &str) -> String {
    format!("redis://:{password}@localhost:{APP_REDIS_PORT}")
}

/// SQL that sets the role's password to the stored one. The password is a
/// generated hex string (checked here as well), so it needs no escaping.
fn rekey_sql(password: &str) -> Option<String> {
    is_valid_secret(password).then(|| format!("ALTER ROLE nexus PASSWORD '{password}';\n"))
}

/// BIND_ADDR for the bundled backend: loopback only. `localhost` resolves to ::1
/// first on most systems, so without an IPv6 listener every new connection would
/// wait for ::1 to be refused before falling back to 127.0.0.1.
fn loopback_bind_addrs(ipv6_loopback: bool) -> &'static str {
    if ipv6_loopback {
        "127.0.0.1,::1"
    } else {
        "127.0.0.1"
    }
}

/// False when IPv6 is disabled, in which case the backend could not listen on ::1.
fn ipv6_loopback_available() -> bool {
    TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).is_ok()
}

/// Holds the backend sidecar child process so it can be killed on app exit.
struct Backend(Mutex<Option<CommandChild>>);

/// Set once the app is exiting so the supervisor thread stops restarting the backend.
struct Shutdown(AtomicBool);

/// Wait before retry number `attempt` (0-based): 1s, 2s, 4s … capped at 30s.
fn backoff(attempt: u32) -> Duration {
    Duration::from_secs((1u64 << attempt.min(5)).min(30))
}

/// True when an HTTP response starts with a 200 status line.
fn is_ok_status(response: &str) -> bool {
    response.starts_with("HTTP/1.1 200")
}

/// True for a 200 answer from the backend's `/health` endpoint.
fn is_healthy_response(response: &str) -> bool {
    is_ok_status(response) && response.contains("\"status\":\"ok\"")
}

/// Plain HTTP GET on localhost; None when nothing answers in time.
fn http_get_local(port: u16, path: &str) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(1)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    Some(response)
}

/// Asks `/health` on localhost; a plain TCP listener that is not our backend does not count.
fn backend_healthy(port: u16) -> bool {
    http_get_local(port, "/health").is_some_and(|r| is_healthy_response(&r))
}

/// True once MinIO reports it can serve requests (the readiness endpoint;
/// liveness can answer before a fresh instance serves bucket calls).
fn object_storage_ready(port: u16) -> bool {
    http_get_local(port, "/minio/health/ready").is_some_and(|r| is_ok_status(&r))
}

/// This machine's address on its default route (no packet is sent: connecting
/// a UDP socket only picks the route). None when offline or loopback-only.
fn non_loopback_local_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?; // TEST-NET-1: never actually contacted
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

/// True when something accepts connections on `port` at `ip`, a non-loopback
/// address of this machine: a backend there is reachable from the network,
/// not only from this computer (#336).
fn listens_on(ip: IpAddr, port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::new(ip, port), Duration::from_millis(500)).is_ok()
}

/// Whether the backend on `port` is also reachable beyond loopback. Unknown
/// (no network address to test from) counts as not exposed.
fn backend_exposed(port: u16) -> bool {
    non_loopback_local_ip().is_some_and(|ip| listens_on(ip, port))
}

/// Health checks in a row a running sidecar may fail before it is restarted,
/// and how long after its start the first counts (#330).
const MAX_FAILED_HEALTH_CHECKS: u32 = 3;
const HEALTH_GRACE: Duration = Duration::from_secs(60);
const HEALTH_INTERVAL: Duration = Duration::from_secs(10);

/// Whether a sidecar should be restarted: it is past its start-up grace
/// period and has failed `failures` health checks in a row.
fn should_restart(uptime: Duration, failures: u32) -> bool {
    uptime >= HEALTH_GRACE && failures >= MAX_FAILED_HEALTH_CHECKS
}

/// Polls `check` every `interval` until it passes (true) or `timeout` elapses (false).
fn wait_for(timeout: Duration, interval: Duration, mut check: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if check() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(interval);
    }
}

/// Environment for the bundled sync-service sidecar.
fn sidecar_env(
    jwt_secret: &str,
    data_key: &str,
    db: &DbSecrets,
    bind_addrs: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("DATABASE_URL", database_url(&db.db_password)),
        ("REDIS_URL", redis_url(&db.redis_password)),
        ("JWT_SECRET", jwt_secret.to_string()),
        ("DATA_ENCRYPTION_KEY", data_key.to_string()),
        ("BIND_ADDR", bind_addrs.to_string()),
        ("PORT", BACKEND_PORT.to_string()),
        ("MINIO_ENDPOINT", format!("localhost:{MINIO_PORT}")),
        ("MINIO_ACCESS_KEY", MINIO_ACCESS_KEY.to_string()),
        ("MINIO_SECRET_KEY", MINIO_SECRET_KEY.to_string()),
        ("MINIO_BUCKET", MINIO_BUCKET.to_string()),
    ]
}

/// `docker` invocation that never flashes a console window (this is a GUI app).
fn docker() -> StdCommand {
    let mut cmd = StdCommand::new("docker");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// True once the Docker engine answers — Docker Desktop needs a while after it is launched.
fn docker_engine_ready() -> bool {
    docker()
        .arg("info")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Waits for a container's Docker healthcheck to report "healthy" — a TCP
/// connect alone doesn't mean Postgres/Redis are ready to accept queries yet.
fn container_healthy(container: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let status = docker()
            .args(["inspect", "--format", "{{.State.Health.Status}}", container])
            .output();
        if let Ok(output) = status {
            if String::from_utf8_lossy(&output.stdout).trim() == "healthy" {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

/// `docker compose` for the app's own project, with this install's passwords.
fn app_compose(resource_dir: &Path, db: &DbSecrets) -> StdCommand {
    let mut cmd = docker();
    cmd.args(["compose", "-p", APP_PROJECT, "-f"])
        .arg(resource_dir.join(APP_COMPOSE_FILE))
        .env("NEXUS_DB_PASSWORD", &db.db_password)
        .env("NEXUS_REDIS_PASSWORD", &db.redis_password);
    cmd
}

/// `docker compose` for the dev scripts' project (MinIO, and the legacy database).
fn legacy_compose(resource_dir: &Path) -> StdCommand {
    let mut cmd = docker();
    cmd.args(["compose", "-p", LEGACY_PROJECT, "-f"])
        .arg(resource_dir.join(LEGACY_COMPOSE_FILE));
    cmd
}

fn run_ok(cmd: &mut StdCommand, what: &str) -> bool {
    match cmd.status() {
        Ok(status) if status.success() => true,
        Ok(status) => {
            eprintln!("[backend] {what} exited with {status}");
            false
        }
        Err(err) => {
            eprintln!("[backend] could not run {what}: {err}");
            false
        }
    }
}

/// Runs SQL through psql inside a Postgres container. The official image trusts
/// connections over its local socket, so no password is needed (or exposed on a
/// command line): the statements go in on stdin.
fn psql_in(container: &str, database: &str, sql: &str) -> bool {
    let child = docker()
        .args([
            "exec", "-i", container, "psql", "-U", "nexus", "-d", database,
        ])
        .args(["-v", "ON_ERROR_STOP=1", "-q"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        eprintln!("[backend] could not run psql in {container}");
        return false;
    };
    let written = child
        .stdin
        .take()
        .is_some_and(|mut stdin| stdin.write_all(sql.as_bytes()).is_ok());
    let ok = child.wait().is_ok_and(|status| status.success());
    written && ok
}

/// Starts (or reuses) the app's Postgres/Redis, sets the database role to this
/// install's password, moves an older build's notes over once, then starts
/// MinIO (see `start_object_storage`). Returns true once the databases are ready
/// for the backend.
fn start_docker_infra(resource_dir: &Path, db: &DbSecrets, migrated_marker: &Path) -> bool {
    if !run_ok(
        app_compose(resource_dir, db).args(["up", "-d", "postgres", "redis"]),
        "docker compose",
    ) {
        return false;
    }
    if !(container_healthy(APP_POSTGRES, Duration::from_secs(60))
        && container_healthy(APP_REDIS, Duration::from_secs(30)))
    {
        return false;
    }
    let rekeyed =
        rekey_sql(&db.db_password).is_some_and(|sql| psql_in(APP_POSTGRES, "nexus_notes", &sql));
    if !rekeyed {
        eprintln!("[backend] could not set the database password");
        return false;
    }
    if !migrate_legacy_database(resource_dir, migrated_marker) {
        return false;
    }
    start_object_storage(resource_dir);
    true
}

fn legacy_volume_exists() -> Option<bool> {
    docker()
        .args(["volume", "inspect", LEGACY_VOLUME])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .map(|status| status.success())
}

/// Builds before #277 kept their notes in the dev scripts' database, under the
/// well-known dev password. Copies them into the app's own database once
/// (pg_dump piped into psql, both through `docker exec`), then stops the old
/// container so those credentials no longer reach the notes. The old volume is
/// left in place; docs/deployment.md says how to remove it.
///
/// Until the marker is written the backend is not started on the new database,
/// so a failed or interrupted copy is redone from scratch on the next attempt
/// without risking anything written since.
fn migrate_legacy_database(resource_dir: &Path, marker: &Path) -> bool {
    if marker.exists() {
        return true;
    }
    match legacy_volume_exists() {
        None => return false, // docker failed; try again later
        Some(false) => return mark_migrated(marker),
        Some(true) => {}
    }
    eprintln!("[backend] copying notes from the shared dev database (#277)…");
    if !run_ok(
        legacy_compose(resource_dir).args(["up", "-d", "postgres"]),
        "docker compose (legacy database)",
    ) || !container_healthy(LEGACY_POSTGRES, Duration::from_secs(60))
    {
        return false;
    }
    // Start from an empty database: an earlier attempt may have stopped halfway.
    if !psql_in(
        APP_POSTGRES,
        "postgres",
        "DROP DATABASE IF EXISTS nexus_notes WITH (FORCE);\nCREATE DATABASE nexus_notes OWNER nexus;\n",
    ) {
        eprintln!("[backend] could not reset the app database before the copy");
        return false;
    }
    if !copy_database(LEGACY_POSTGRES, APP_POSTGRES) {
        eprintln!("[backend] copying the notes failed; retrying later");
        return false;
    }
    if !mark_migrated(marker) {
        return false;
    }
    let _ = docker()
        .args(["stop", LEGACY_POSTGRES])
        .stdout(Stdio::null())
        .status();
    eprintln!("[backend] notes copied; the shared dev database is stopped");
    true
}

/// `pg_dump` in `from` piped into `psql` in `to`; true only if both succeed.
fn copy_database(from: &str, to: &str) -> bool {
    let dump = docker()
        .args(["exec", from, "pg_dump", "-U", "nexus", "-d", "nexus_notes"])
        .args(["--no-owner", "--no-privileges"])
        .stdout(Stdio::piped())
        .spawn();
    let Ok(mut dump) = dump else {
        return false;
    };
    let Some(dump_out) = dump.stdout.take() else {
        let _ = dump.kill();
        return false;
    };
    let restore = docker()
        .args(["exec", "-i", to, "psql", "-U", "nexus", "-d", "nexus_notes"])
        .args(["-v", "ON_ERROR_STOP=1", "-q"])
        .stdin(Stdio::from(dump_out))
        .stdout(Stdio::null())
        .status();
    let dumped = dump.wait().is_ok_and(|status| status.success());
    dumped && restore.is_ok_and(|status| status.success())
}

fn mark_migrated(marker: &Path) -> bool {
    match write_private(marker, "done\n") {
        Ok(()) => true,
        Err(err) => {
            eprintln!("[backend] cannot record the database migration ({err})");
            false
        }
    }
}

/// Starts MinIO in its own `docker compose` call so that a failure (its port
/// taken by another program, an image that cannot be pulled) can never keep
/// the databases or the backend from starting: without MinIO only attachments
/// are unavailable. Waits a bounded time because the backend checks object
/// storage once at startup.
fn start_object_storage(resource_dir: &Path) {
    let started = legacy_compose(resource_dir)
        .args(["up", "-d", "minio"])
        .status()
        .is_ok_and(|status| status.success());
    if !started {
        eprintln!("[backend] MinIO could not be started; attachments are unavailable");
        return;
    }
    if !wait_for(MINIO_READY_TIMEOUT, Duration::from_millis(500), || {
        object_storage_ready(MINIO_PORT)
    }) {
        eprintln!(
            "[backend] MinIO is not ready; attachments stay unavailable until the app restarts"
        );
    }
}

/// Keeps the backend available for as long as the app runs, without ever blocking
/// the UI: waits for Docker Desktop, brings up Postgres/Redis, reuses a backend
/// that is already healthy on the port (e.g. from the dev scripts) and otherwise
/// runs the bundled sidecar, restarting it with backoff if it exits.
fn supervise_backend(app: tauri::AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("[backend] cannot resolve resource dir: {err}");
            return;
        }
    };
    let jwt_secret = match backend_jwt_secret(&app) {
        Ok(secret) => secret,
        Err(err) => {
            // Only reachable when the OS has no working CSPRNG; never fall back to a fixed secret.
            eprintln!("[backend] cannot generate a JWT secret: {err}");
            return;
        }
    };
    let data_key = match backend_data_key(&app) {
        Ok(key) => key,
        Err(err) => {
            // Starting without the install's own key would write data that can
            // never be read back, so the backend stays down instead.
            eprintln!("[backend] cannot load the data encryption key: {err}");
            return;
        }
    };
    let db_secrets = match backend_db_secrets(&app) {
        Ok(secrets) => secrets,
        Err(err) => {
            eprintln!("[backend] cannot store the database passwords: {err}");
            return;
        }
    };
    let migrated_marker = match app.path().app_local_data_dir() {
        Ok(dir) => dir.join(LEGACY_MIGRATED_FILE),
        Err(err) => {
            eprintln!("[backend] cannot resolve the app data dir: {err}");
            return;
        }
    };
    let bind_addrs = loopback_bind_addrs(ipv6_loopback_available());
    let shutting_down = || app.state::<Shutdown>().0.load(Ordering::SeqCst);
    let mut failures: u32 = 0;

    while !shutting_down() {
        // An already running backend (dev script, previous run) is reused
        // without polling Docker (#330). One that is also reachable from the
        // network is not ours to trust: the app is told so it can warn (#336).
        if backend_healthy(BACKEND_PORT) {
            let exposed = backend_exposed(BACKEND_PORT);
            if exposed {
                eprintln!("[backend] the server on :{BACKEND_PORT} is reachable from the network; not treating it as the app's own");
            }
            let _ = app.emit("backend-exposed", exposed);
            std::thread::sleep(Duration::from_secs(5));
            failures = 0;
            continue;
        }
        let _ = app.emit("backend-exposed", false);

        if !docker_engine_ready() {
            eprintln!("[backend] waiting for the Docker engine…");
            std::thread::sleep(backoff(failures));
            failures = failures.saturating_add(1);
            continue;
        }
        if !start_docker_infra(&resource_dir, &db_secrets, &migrated_marker) {
            eprintln!("[backend] Postgres/Redis are not ready yet, retrying…");
            std::thread::sleep(backoff(failures));
            failures = failures.saturating_add(1);
            continue;
        }

        let spawned = app.shell().sidecar("sync-service").map(|cmd| {
            cmd.current_dir(&resource_dir)
                .envs(sidecar_env(&jwt_secret, &data_key, &db_secrets, bind_addrs))
                .spawn()
        });
        let (mut events, child) = match spawned {
            Ok(Ok(pair)) => pair,
            Ok(Err(err)) => {
                eprintln!("[backend] failed to start the sidecar: {err}");
                std::thread::sleep(backoff(failures));
                failures = failures.saturating_add(1);
                continue;
            }
            Err(err) => {
                eprintln!("[backend] sidecar binary not available: {err}");
                std::thread::sleep(backoff(failures));
                failures = failures.saturating_add(1);
                continue;
            }
        };
        app.state::<Backend>().0.lock().unwrap().replace(child);
        // Shutdown may have begun while the sidecar was starting (#330).
        if shutting_down() {
            if let Some(child) = app.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
            break;
        }

        let started = Instant::now();
        // Watchdog (#330): a sidecar that stops answering /health (hung, not
        // exited) is killed, so the loop below sees it end and restarts it.
        let alive = Arc::new(AtomicBool::new(true));
        {
            let alive = alive.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                let mut failed = 0u32;
                while alive.load(Ordering::SeqCst) {
                    std::thread::sleep(HEALTH_INTERVAL);
                    if !alive.load(Ordering::SeqCst) {
                        break;
                    }
                    failed = if backend_healthy(BACKEND_PORT) {
                        0
                    } else {
                        failed + 1
                    };
                    if should_restart(started.elapsed(), failed) {
                        eprintln!(
                            "[backend] failed {failed} health checks in a row; restarting it"
                        );
                        if let Some(child) = app.state::<Backend>().0.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                        break;
                    }
                }
            });
        }
        while let Some(event) = tauri::async_runtime::block_on(events.recv()) {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprint!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[backend] exited: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
        alive.store(false, Ordering::SeqCst);
        app.state::<Backend>().0.lock().unwrap().take();

        // A backend that ran for a while was healthy; restart it promptly, not with a long backoff.
        if started.elapsed() > Duration::from_secs(30) {
            failures = 0;
        }
        if !shutting_down() {
            std::thread::sleep(backoff(failures));
            failures = failures.saturating_add(1);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Backend(Mutex::new(None)))
        .manage(Shutdown(AtomicBool::new(false)))
        .setup(|app| {
            // Off the UI thread: the window opens immediately and the frontend shows
            // a "waiting for the server" state until /health answers.
            let handle = app.handle().clone();
            std::thread::spawn(move || supervise_backend(handle));
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Exit as well as ExitRequested: not every way out raises the latter (#330).
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app_handle
                    .state::<Shutdown>()
                    .0
                    .store(true, Ordering::SeqCst);
                if let Some(child) = app_handle.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_env_configures_object_storage() {
        let db = DbSecrets {
            db_password: "dbpw".into(),
            redis_password: "rpw".into(),
        };
        let env = sidecar_env("s3cret", "d4ta", &db, "127.0.0.1");
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| *key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("MINIO_ENDPOINT"), Some("localhost:9000"));
        assert_eq!(get("MINIO_ACCESS_KEY"), Some("nexus_minio"));
        assert_eq!(get("MINIO_SECRET_KEY"), Some("nexus_minio_dev"));
        assert_eq!(get("MINIO_BUCKET"), Some("attachments"));
        assert_eq!(get("JWT_SECRET"), Some("s3cret"));
        assert_eq!(get("DATA_ENCRYPTION_KEY"), Some("d4ta"));
        assert_eq!(get("BIND_ADDR"), Some("127.0.0.1"));
        assert_eq!(get("PORT"), Some("8080"));
        assert_eq!(
            get("DATABASE_URL"),
            Some("postgres://nexus:dbpw@localhost:5433/nexus_notes?sslmode=disable")
        );
        assert_eq!(get("REDIS_URL"), Some("redis://:rpw@localhost:6380"));
    }

    #[test]
    fn rekey_sql_only_accepts_generated_passwords() {
        let password = "ab".repeat(SECRET_BYTES);
        assert_eq!(
            rekey_sql(&password),
            Some(format!("ALTER ROLE nexus PASSWORD '{password}';\n"))
        );
        assert_eq!(rekey_sql("nexus_dev"), None);
        assert_eq!(
            rekey_sql(&format!("{password}'; DROP TABLE notes; --")),
            None
        );
    }

    #[test]
    fn app_compose_file_is_bundled_with_the_app() {
        let conf = include_str!("../tauri.conf.json");
        assert!(conf.contains(&format!("\"{APP_COMPOSE_FILE}\"")));
        assert!(conf.contains(&format!("\"{LEGACY_COMPOSE_FILE}\"")));
    }

    #[test]
    fn ok_status_needs_http_200() {
        assert!(is_ok_status("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"));
        assert!(!is_ok_status("HTTP/1.1 503 Service Unavailable\r\n\r\n"));
        assert!(!is_ok_status(""));
    }

    #[test]
    fn wait_for_returns_as_soon_as_the_check_passes() {
        let mut calls = 0;
        assert!(wait_for(
            Duration::from_secs(5),
            Duration::from_millis(1),
            || {
                calls += 1;
                calls == 3
            }
        ));
        assert_eq!(calls, 3);
        assert!(!wait_for(
            Duration::from_millis(20),
            Duration::from_millis(1),
            || false
        ));
    }

    #[test]
    fn backoff_doubles_then_caps_at_thirty_seconds() {
        let secs: Vec<u64> = (0..8).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(secs, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn backoff_survives_huge_attempt_counts() {
        assert_eq!(backoff(u32::MAX).as_secs(), 30);
    }

    #[test]
    fn health_response_needs_status_200_and_ok_body() {
        let ok = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\",\"version\":\"0.5.0\"}";
        assert!(is_healthy_response(ok));
        assert!(!is_healthy_response(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"status\":\"ok\"}"
        ));
        assert!(!is_healthy_response(
            "HTTP/1.1 200 OK\r\n\r\n<html>some other server</html>"
        ));
        assert!(!is_healthy_response(""));
    }

    #[test]
    fn backend_binds_to_loopback_addresses_only() {
        for ipv6 in [true, false] {
            let addrs = loopback_bind_addrs(ipv6);
            for addr in addrs.split(',') {
                let ip: std::net::IpAddr = addr.parse().unwrap();
                assert!(ip.is_loopback(), "{addr} is not a loopback address");
            }
            assert_eq!(addrs.contains("::1"), ipv6);
            assert!(addrs.contains("127.0.0.1"));
        }
    }

    /// A unique scratch directory under the system temp dir, removed on drop.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "nexusnotes-test-{name}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn to_hex_encodes_each_byte_as_two_lowercase_digits() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
        assert_eq!(to_hex(&[]), "");
    }

    #[test]
    fn generated_secrets_are_long_random_hex() {
        let first = generate_secret().unwrap();
        let second = generate_secret().unwrap();
        assert_eq!(first.len(), SECRET_BYTES * 2);
        assert!(is_valid_secret(&first));
        assert_ne!(first, second);
    }

    #[test]
    fn secret_validation_rejects_short_or_non_hex_values() {
        assert!(!is_valid_secret(""));
        assert!(!is_valid_secret("dev-secret"));
        assert!(!is_valid_secret(&"a".repeat(SECRET_BYTES * 2 - 1)));
        assert!(!is_valid_secret(&"z".repeat(SECRET_BYTES * 2)));
        assert!(is_valid_secret(&"A1".repeat(SECRET_BYTES)));
    }

    #[test]
    fn secret_is_created_on_first_run_with_its_directory() {
        let tmp = TempDir::new("create");
        let path = tmp.0.join("app").join(JWT_SECRET_FILE);

        let secret = load_or_create_secret(&path).unwrap();

        assert!(is_valid_secret(&secret));
        assert_eq!(fs::read_to_string(&path).unwrap(), secret);
        assert!(
            !path.with_extension("tmp").exists(),
            "temp file left behind"
        );
    }

    #[test]
    fn secret_is_reused_on_later_runs() {
        let tmp = TempDir::new("reuse");
        let path = tmp.0.join(JWT_SECRET_FILE);

        let first = load_or_create_secret(&path).unwrap();
        let second = load_or_create_secret(&path).unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn stored_secret_is_read_without_surrounding_whitespace() {
        let tmp = TempDir::new("trim");
        let path = tmp.0.join(JWT_SECRET_FILE);
        let secret = "ab".repeat(SECRET_BYTES);
        fs::write(&path, format!("{secret}\r\n")).unwrap();

        assert_eq!(load_or_create_secret(&path).unwrap(), secret);
    }

    #[test]
    fn invalid_stored_secret_is_replaced() {
        for stored in ["", "dev-secret", "0123abcd"] {
            let tmp = TempDir::new("invalid");
            let path = tmp.0.join(JWT_SECRET_FILE);
            fs::write(&path, stored).unwrap();

            let secret = load_or_create_secret(&path).unwrap();

            assert!(is_valid_secret(&secret), "kept {stored:?}");
            assert_eq!(fs::read_to_string(&path).unwrap(), secret);
        }
    }

    #[test]
    fn leftover_temp_file_does_not_block_creation() {
        let tmp = TempDir::new("leftover");
        let path = tmp.0.join(JWT_SECRET_FILE);
        fs::write(path.with_extension("tmp"), "half-writ").unwrap();

        let secret = load_or_create_secret(&path).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), secret);
    }

    #[test]
    fn unreadable_secret_path_is_an_error_not_an_overwrite() {
        let tmp = TempDir::new("unreadable");
        let path = tmp.0.join(JWT_SECRET_FILE);
        fs::create_dir(&path).unwrap(); // a directory where the file should be

        assert!(load_or_create_secret(&path).is_err());
        assert!(path.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn secret_file_is_readable_by_the_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new("mode");
        let path = tmp.0.join(JWT_SECRET_FILE);

        load_or_create_secret(&path).unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn data_key_is_created_once_and_reused() {
        let tmp = TempDir::new("datakey");
        let path = tmp.0.join("app").join(DATA_KEY_FILE);

        let first = load_or_create_data_key(&path).unwrap();
        let second = load_or_create_data_key(&path).unwrap();

        assert_eq!(first.len(), SECRET_BYTES * 2);
        assert!(is_valid_secret(&first));
        assert_eq!(first, second);
    }

    #[test]
    fn invalid_data_key_is_an_error_and_left_untouched() {
        for stored in ["", "dev-secret", "0123abcd", &"ab".repeat(SECRET_BYTES + 1)] {
            let tmp = TempDir::new("datakey-invalid");
            let path = tmp.0.join(DATA_KEY_FILE);
            fs::write(&path, stored).unwrap();

            assert!(
                load_or_create_data_key(&path).is_err(),
                "accepted {stored:?}"
            );
            assert_eq!(
                fs::read_to_string(&path).unwrap(),
                stored,
                "overwrote {stored:?}"
            );
        }
    }

    #[test]
    fn restart_needs_grace_and_repeated_failures() {
        let grace = HEALTH_GRACE;
        assert!(
            !should_restart(grace - Duration::from_secs(1), 99),
            "still starting up"
        );
        assert!(!should_restart(grace, MAX_FAILED_HEALTH_CHECKS - 1));
        assert!(should_restart(grace, MAX_FAILED_HEALTH_CHECKS));
    }

    #[test]
    fn exposure_is_detected_from_a_non_loopback_address() {
        let Some(ip) = non_loopback_local_ip() else {
            eprintln!("no non-loopback address on this machine; skipping");
            return;
        };
        let everywhere = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = everywhere.local_addr().unwrap().port();
        assert!(
            listens_on(ip, port),
            "a listener on all interfaces is reachable via {ip}"
        );

        let local_only = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = local_only.local_addr().unwrap().port();
        assert!(
            !listens_on(ip, port),
            "a loopback-only listener is not reachable via {ip}"
        );
    }
}
