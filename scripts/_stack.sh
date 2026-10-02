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
# A random JWT secret per checkout, kept between runs so sessions survive a
# restart (never a fixed, guessable value; #334). tmp/ is gitignored.
JWT_SECRET_FILE="$ROOT/services/sync-service/tmp/jwt-secret"
# Anything but the 64 hex characters written below (empty, cut short, edited
# by hand) is replaced, rather than stopping the backend on a short secret.
if ! grep -Eqx '[0-9a-f]{64}' "$JWT_SECRET_FILE" 2>/dev/null; then
  mkdir -p "$(dirname "$JWT_SECRET_FILE")"
  (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$JWT_SECRET_FILE")
fi
JWT_SECRET="$(cat "$JWT_SECRET_FILE")"
export JWT_SECRET
# User data is encrypted at rest with DATA_ENCRYPTION_KEY (#353). It lives in
# the repo-root .env (gitignored); the first run generates one and appends it.
# Unlike the JWT secret it is never replaced: rows encrypted under a lost key
# cannot be read again, so a bad value stops the script instead.
ENV_FILE="$ROOT/.env"
if [ -z "${DATA_ENCRYPTION_KEY:-}" ]; then
  DATA_ENCRYPTION_KEY="$(sed -n 's/^DATA_ENCRYPTION_KEY=//p' "$ENV_FILE" 2>/dev/null | tail -n1 | tr -d '\r"'"'"' ')"
fi
if [ -z "$DATA_ENCRYPTION_KEY" ]; then
  DATA_ENCRYPTION_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ] && echo >> "$ENV_FILE"
  printf '%s\n' "# Dev-only key for encrypting user data at rest (#353). Keep it: data" \
    "# written under it is unreadable without it." "DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY" >> "$ENV_FILE"
fi
if ! printf '%s' "$DATA_ENCRYPTION_KEY" | grep -Eqx '[0-9a-fA-F]{64}'; then
  echo "DATA_ENCRYPTION_KEY in $ENV_FILE must be 64 hex characters; fix it rather than replacing it (data encrypted under the old key would be lost)." >&2
  exit 1
fi
export DATA_ENCRYPTION_KEY
export PORT="8080"
# The dev backend is for this machine only, like the packaged app's. It also
# binds ::1 when the host has an IPv6 loopback (dev containers, WSL and some
# Linux hosts don't, and binding it there would stop the backend).
has_ipv6_loopback() {
  case "$(uname -s)" in
    Linux*) grep -qs ' lo$' /proc/net/if_inet6 ;;
    Darwin*) ifconfig lo0 2>/dev/null | grep -q 'inet6 ::1' ;;
    MINGW*|MSYS*|CYGWIN*) ping -6 -n 1 -w 1000 ::1 >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}
if has_ipv6_loopback; then
  export BIND_ADDR="127.0.0.1,::1"
else
  export BIND_ADDR="127.0.0.1"
fi
export VITE_API_URL="http://localhost:8080"
# Object storage for attachments (MinIO from docker-compose.dev.yml).
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="nexus_minio"
export MINIO_SECRET_KEY="nexus_minio_dev"
export MINIO_BUCKET="attachments"

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
  if [ "${NEXUS_DEVCONTAINER:-}" = "1" ]; then
    # Postgres/Redis are sibling containers of the dev container (see .devcontainer/).
    log "Waiting for Postgres…"
    for _ in $(seq 1 30); do
      (exec 3<>/dev/tcp/localhost/5432) 2>/dev/null && break
      sleep 1
    done
  else
    log "Starting Docker infra (Postgres + Redis)…"
    docker compose -f "$ROOT/docker-compose.dev.yml" up -d postgres redis

    log "Waiting for Postgres…"
    for _ in $(seq 1 30); do
      status="$(docker inspect --format '{{.State.Health.Status}}' nexusnotes-postgres-1 2>/dev/null || echo starting)"
      [ "$status" = "healthy" ] && break
      sleep 1
    done

    # MinIO is optional and started on its own: if its port is taken or the
    # image cannot be pulled, only attachments are unavailable. The backend
    # checks object storage once at startup, so wait (bounded) for it.
    log "Starting MinIO (attachments)…"
    if docker compose -f "$ROOT/docker-compose.dev.yml" up -d minio; then
      for _ in $(seq 1 30); do
        curl -sf "http://localhost:9000/minio/health/ready" >/dev/null 2>&1 && break
        sleep 1
      done
    else
      log "MinIO could not start; attachments are unavailable this session."
    fi
  fi

  log "Applying database migrations…"
  ( cd "$ROOT/services/sync-service" && go run cmd/migrate/main.go )

  log "Building backend…"
  local bin="$ROOT/services/sync-service/tmp/sync-service"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) bin="$bin.exe" ;; esac
  ( cd "$ROOT/services/sync-service" && go build -o "$bin" ./cmd/server )

  # Reuse a healthy backend only when the build it runs and its settings
  # (bind address, secrets) match; their hash is recorded below.
  local hashfile="$ROOT/services/sync-service/tmp/sync-service.hash"
  local newhash
  newhash="$(git hash-object "$bin")-$(printf '%s|%s|%s' "$BIND_ADDR" "$JWT_SECRET" "$DATA_ENCRYPTION_KEY" | git hash-object --stdin)"
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
    if [ -f "$hashfile" ] && [ "$(cat "$hashfile")" = "$newhash" ]; then
      log "Backend already healthy on :$PORT and up to date — reusing it."
      return
    fi
    log "Backend on :$PORT runs an outdated build or settings — replacing it…"
    local stale_pid
    stale_pid="$(port_pid "$PORT")"
    [ -n "$stale_pid" ] && kill_pid "$stale_pid"
    for _ in $(seq 1 20); do
      curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi

  log "Starting backend on :$PORT…"
  # Run from the service dir: startup auto-migration reads the cwd-relative
  # "migrations" directory and dies instantly from anywhere else (#201).
  ( cd "$ROOT/services/sync-service" && exec "$bin" ) &
  local backend_pid=$!
  echo "$newhash" > "$hashfile"
  trap 'log "Stopping backend…"; kill "'"$backend_pid"'" 2>/dev/null || true' EXIT

  local healthy=""
  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && { healthy=1; break; }
    sleep 0.5
  done
  if [ -z "$healthy" ]; then
    log "Backend failed to become healthy on :$PORT — see its output above."
    exit 1
  fi
  log "Backend healthy at http://localhost:$PORT"
}
