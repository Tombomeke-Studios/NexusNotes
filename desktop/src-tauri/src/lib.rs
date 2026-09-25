use std::fs;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BACKEND_PORT: u16 = 8080;

/// Fixed development credentials: the Postgres container is shared with the dev
/// scripts and its volume was initialised with them, so they cannot change without
/// a migration. The port is published on 127.0.0.1 only (see docs/security.md).
const DATABASE_URL: &str = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable";

/// File in the app's local data dir holding this install's JWT signing secret.
const JWT_SECRET_FILE: &str = "jwt-secret";

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

/// Holds the backend sidecar child process so it can be killed on app exit.
struct Backend(Mutex<Option<CommandChild>>);

/// Set once the app is exiting so the supervisor thread stops restarting the backend.
struct Shutdown(AtomicBool);

/// Wait before retry number `attempt` (0-based): 1s, 2s, 4s … capped at 30s.
fn backoff(attempt: u32) -> Duration {
    Duration::from_secs((1u64 << attempt.min(5)).min(30))
}

/// True for a 200 answer from the backend's `/health` endpoint.
fn is_healthy_response(response: &str) -> bool {
    response.starts_with("HTTP/1.1 200") && response.contains("\"status\":\"ok\"")
}

/// Asks `/health` on localhost; a plain TCP listener that is not our backend does not count.
fn backend_healthy(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let request = b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    is_healthy_response(&response)
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

/// Starts (or reuses) the Postgres/Redis containers via `docker compose`,
/// pinned to the same project name the dev scripts use so both share one
/// set of containers. Returns true once both report healthy.
fn start_docker_infra(compose_path: &std::path::Path) -> bool {
    let started = docker()
        .args(["compose", "-p", "nexusnotes", "-f"])
        .arg(compose_path)
        .args(["up", "-d", "postgres", "redis"])
        .status();

    match started {
        Ok(status) if status.success() => {}
        Ok(status) => {
            eprintln!("docker compose exited with {status}");
            return false;
        }
        Err(err) => {
            eprintln!("could not run `docker compose`: {err}");
            return false;
        }
    }

    container_healthy("nexusnotes-postgres-1", Duration::from_secs(60))
        && container_healthy("nexusnotes-redis-1", Duration::from_secs(30))
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
    let shutting_down = || app.state::<Shutdown>().0.load(Ordering::SeqCst);
    let mut failures: u32 = 0;

    while !shutting_down() {
        if !docker_engine_ready() {
            eprintln!("[backend] waiting for the Docker engine…");
            std::thread::sleep(backoff(failures));
            failures = failures.saturating_add(1);
            continue;
        }
        if !start_docker_infra(&resource_dir.join("docker-compose.dev.yml")) {
            eprintln!("[backend] Postgres/Redis are not ready yet, retrying…");
            std::thread::sleep(backoff(failures));
            failures = failures.saturating_add(1);
            continue;
        }

        if backend_healthy(BACKEND_PORT) {
            // Someone else's backend (dev script, previous run) already serves the port.
            std::thread::sleep(Duration::from_secs(5));
            failures = 0;
            continue;
        }

        let spawned = app.shell().sidecar("sync-service").map(|cmd| {
            cmd.current_dir(&resource_dir)
                .envs([
                    ("DATABASE_URL", DATABASE_URL),
                    ("REDIS_URL", "redis://localhost:6379"),
                    ("JWT_SECRET", jwt_secret.as_str()),
                    ("PORT", &BACKEND_PORT.to_string()),
                ])
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

        let started = Instant::now();
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
            if let RunEvent::ExitRequested { .. } = event {
                app_handle.state::<Shutdown>().0.store(true, Ordering::SeqCst);
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
        assert!(!is_healthy_response("HTTP/1.1 200 OK\r\n\r\n<html>some other server</html>"));
        assert!(!is_healthy_response(""));
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
}
