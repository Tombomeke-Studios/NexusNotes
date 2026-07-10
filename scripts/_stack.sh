#!/usr/bin/env bash
# Shared dev-stack bring-up, sourced by dev-web.sh / dev-app.sh.
#
# Brings up the Docker infra (Postgres + Redis), applies migrations, and starts
# the Go backend. Infra is left running between sessions (fast restarts); only
# the backend this script starts is torn down on exit. A backend already healthy
# on :8080 is reused only when it runs the current build — otherwise it is
# replaced, so new endpoints never 404 after a pull (#189).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Dev environment (matches docker-compose.dev.yml + README) ---
export DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="dev-secret"
export PORT="8080"
export VITE_API_URL="http://localhost:8080"

log() { printf '\033[36m▶ %s\033[0m\n' "$1"; }

# PID of whatever listens on $1, or empty. Windows lacks lsof under git-bash.
port_pid() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      netstat -ano 2>/dev/null | awk -v p=":$1" '$1 == "TCP" && index($2, p) && $4 == "LISTENING" { print $5; exit }'
      ;;
    *)
      lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null | head -n 1
      ;;
  esac
}

# Plain `kill` cannot terminate processes outside git-bash's own tree on
# Windows; taskkill can.
kill_pid() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) taskkill //PID "$1" //F >/dev/null 2>&1 || true ;;
    *) kill "$1" 2>/dev/null || true ;;
  esac
}

start_stack() {
  log "Starting Docker infra (Postgres + Redis)…"
  docker compose -f "$ROOT/docker-compose.dev.yml" up -d postgres redis

  log "Waiting for Postgres…"
  for _ in $(seq 1 30); do
    status="$(docker inspect --format '{{.State.Health.Status}}' nexusnotes-postgres-1 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && break
    sleep 1
  done

  log "Applying database migrations…"
  ( cd "$ROOT/services/sync-service" && go run cmd/migrate/main.go )

  log "Building backend…"
  local bin="$ROOT/services/sync-service/tmp/sync-service"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) bin="$bin.exe" ;; esac
  ( cd "$ROOT/services/sync-service" && go build -o "$bin" ./cmd/server )

  # Reuse a healthy backend only when the build it runs matches the one we
  # just produced; the hash of the last-started binary is recorded below.
  local hashfile="$ROOT/services/sync-service/tmp/sync-service.hash"
  local newhash
  newhash="$(git hash-object "$bin")"
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
    if [ -f "$hashfile" ] && [ "$(cat "$hashfile")" = "$newhash" ]; then
      log "Backend already healthy on :$PORT and up to date — reusing it."
      return
    fi
    log "Backend on :$PORT runs an outdated build — replacing it…"
    local stale_pid
    stale_pid="$(port_pid "$PORT")"
    [ -n "$stale_pid" ] && kill_pid "$stale_pid"
    for _ in $(seq 1 20); do
      curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi

  log "Starting backend on :$PORT…"
  "$bin" &
  local backend_pid=$!
  echo "$newhash" > "$hashfile"
  trap 'log "Stopping backend…"; kill "'"$backend_pid"'" 2>/dev/null || true' EXIT

  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
  log "Backend healthy at http://localhost:$PORT"
}
