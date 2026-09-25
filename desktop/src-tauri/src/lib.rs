use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BACKEND_PORT: u16 = 8080;

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
                    (
                        "DATABASE_URL",
                        "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable",
                    ),
                    ("REDIS_URL", "redis://localhost:6379"),
                    ("JWT_SECRET", "dev-secret"),
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
}
