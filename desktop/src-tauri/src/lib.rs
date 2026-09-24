use std::net::TcpStream;
use std::process::Command as StdCommand;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BACKEND_PORT: u16 = 8080;

/// Holds the backend sidecar child process so it can be killed on app exit.
struct Backend(Mutex<Option<CommandChild>>);

fn port_open(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Waits for a container's Docker healthcheck to report "healthy" — a TCP
/// connect alone doesn't mean Postgres/Redis are ready to accept queries yet.
fn container_healthy(container: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let status = StdCommand::new("docker")
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
/// set of containers. Assumes Docker Desktop is already running; a missing
/// Docker engine just leaves the backend unable to connect, which it reports
/// itself via its own logs.
fn start_docker_infra(compose_path: &std::path::Path) {
    let result = StdCommand::new("docker")
        .args(["compose", "-p", "nexusnotes", "-f"])
        .arg(compose_path)
        .args(["up", "-d", "postgres", "redis"])
        .status();

    match result {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("docker compose exited with {status}"),
        Err(err) => eprintln!(
            "could not run `docker compose` (is Docker Desktop installed and running?): {err}"
        ),
    }

    container_healthy("nexusnotes-postgres-1", Duration::from_secs(60));
    container_healthy("nexusnotes-redis-1", Duration::from_secs(30));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            start_docker_infra(&resource_dir.join("docker-compose.dev.yml"));

            let (mut events, child) = app
                .shell()
                .sidecar("sync-service")
                .expect("sync-service sidecar binary not found in bundle")
                .current_dir(resource_dir)
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
                .expect("failed to start backend sidecar");

            app.state::<Backend>().0.lock().unwrap().replace(child);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[backend] exited: {payload:?}");
                        }
                        _ => {}
                    }
                }
            });

            if !port_open(BACKEND_PORT, Duration::from_secs(20)) {
                eprintln!("backend did not come up on :{BACKEND_PORT} in time");
            }

            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(child) = app_handle.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
