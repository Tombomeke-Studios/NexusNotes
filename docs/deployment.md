# Deployment — NexusNotes

## Local Development

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Go | 1.23+ | Backend sync service |
| Node.js | 20+ | Desktop app development |
| Docker | Latest | PostgreSQL, Redis, MinIO |
| Docker Compose | v2+ | Infrastructure orchestration |

### Dev Container

`.devcontainer/` provides a reproducible Debian-based environment (Go, Node, Rust,
Postgres, Redis) so the app builds and runs the same on every machine. Open the repo
in VS Code and "Reopen in Container", or use the Dev Containers CLI.

The native Tauri window needs a display. On Windows 11 with WSL2, WSLg provides one
automatically and the container's `docker-compose.yml` forwards its X11/Wayland
sockets (`/tmp/.X11-unix`, `/mnt/wslg`) — no extra setup needed. On hosts without
WSLg (older Windows 10, or Docker Desktop without a WSLg-backed distro), those mounts
are absent and `npm run tauri dev` inside the container will fail to open a window;
in that case use `./scripts/dev-web.sh` and test in a browser, or run the desktop app
natively outside the container instead. Either way, `desktop/e2e/*.spec.ts`
(Playwright, headless Chromium) always work inside the container regardless of
display availability — that's the primary way to test UI behavior in CI-like
conditions.

### Step-by-Step Setup

#### 1. Clone and enter the repo

```bash
git clone https://github.com/Tombomeke-Studios/NexusNotes.git
cd NexusNotes
```

#### 2. Start infrastructure

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts:
- **PostgreSQL** on port 5432 (user: `nexus`, password: `nexus_dev`, db: `nexus_notes`)
- **Redis** on port 6379
- **MinIO** on port 9000 (console on 9001, user: `nexus_minio`, password: `nexus_minio_dev`)
- **Meilisearch** on port 7700 (only when started explicitly)

Every port is published on `127.0.0.1` only. The credentials above are fixed development
values, so the services must not be reachable from other machines; reach them from the
host via `localhost`. If you upgrade from a version that published on all interfaces,
the next `docker compose up` recreates the containers with the new bindings — the data
volumes are kept.

Verify everything is running:

```bash
docker compose -f docker-compose.dev.yml ps
```

#### 3. Start the Go backend

```bash
cd services/sync-service
```

**Linux / macOS:**
```bash
export DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
export JWT_SECRET="dev-secret-change-in-production"
go run cmd/server/main.go
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
$env:JWT_SECRET = "dev-secret-change-in-production"
go run cmd/server/main.go
```

You should see:
```
migration applied: 001_initial_schema.sql
sync service listening on :8080
```

The server auto-runs pending migrations on startup.

#### 4. Verify the backend

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

#### 5. Start the desktop app

Open a **new terminal**:

```bash
cd desktop
npm install    # first time only
npm run dev
```

Open `http://localhost:1420` in your browser.

#### 6. First use

1. Click "Create Account" on the login screen
2. Enter email, password (min 8 chars), and display name
3. After login, click **+** next to "Vaults" to create your first vault
4. Click **+** next to "Notes" to create your first note
5. Start writing markdown — preview updates live in split view

### Packaged app (.exe)

The installed desktop app is self-sufficient: it starts Postgres and Redis through
`docker compose` and runs a bundled copy of the sync service, so **Docker Desktop
is the only prerequisite**. A supervisor thread keeps this going in the background
and never blocks the window:

- It waits for the Docker engine (launching Docker Desktop right before the app is fine)
  and retries until Postgres and Redis report healthy.
- A backend that is already healthy on `:8080` (for example one started by
  `dev-app.sh`) is reused instead of starting a second one.
- If the bundled backend exits it is restarted with a capped backoff (1s → 30s).
- Until the server answers, the app shows a "Waiting for the server…" screen and keeps
  your session; it picks up automatically once `/health` responds.
- The bundled backend signs sessions with a random per-install JWT secret, generated on
  first run and kept in the `jwt-secret` file in the app's local data directory
  (`%LOCALAPPDATA%\com.tombomeke-studios.nexusnotes\` on Windows). Deleting the file
  rotates the secret on the next start; see [security.md](security.md#packaged-desktop-app).
- The bundled backend listens on localhost only (`BIND_ADDR=127.0.0.1,::1`), and the
  bundled compose file publishes Postgres and Redis on `127.0.0.1` only. The database
  still uses the fixed development password (#277), so the machine itself is the trust
  boundary.

Backend output is written to the app's stderr with a `[backend]` prefix. To watch it,
start the .exe from a terminal.

### Stopping

```bash
# Stop the desktop app: Ctrl+C in the desktop terminal
# Stop the backend: Ctrl+C in the backend terminal
# Stop infrastructure:
docker compose -f docker-compose.dev.yml down
```

To also wipe the database:
```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## Production (Docker Compose)

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set real values:
```env
DATABASE_URL=postgres://nexus:STRONG_PASSWORD@postgres:5432/nexus_notes?sslmode=disable
JWT_SECRET=GENERATE_A_RANDOM_64_CHAR_STRING
REDIS_URL=redis://redis:6379
```

`BIND_ADDR` (optional) limits the addresses the sync service listens on, as a
comma-separated list such as `127.0.0.1,::1`. Leave it unset inside Docker: the
container must listen on every interface or its published port cannot reach it.
Set it when you run the binary directly on a host and put a reverse proxy in front.

### 2. Start the stack

```bash
docker compose up -d
```

This starts the sync service, PostgreSQL, Redis, and MinIO. The sync service auto-runs migrations.

### 3. Verify

```bash
curl http://localhost:8080/health
# {"status":"ok","version":"0.5.0"}
```

### Services

| Service | Port | Description |
|---|---|---|
| sync-service | 8080 | Go backend API + WebSocket |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Cache and sessions |
| minio | 9000 | S3 attachment storage |
| minio console | 9001 | MinIO admin UI |

---

## Versioning

NexusNotes follows [semantic versioning](https://semver.org). It is pre-1.0, so
a **minor** bump (`0.5` → `0.6`) may change the API or sync protocol, and a patch
bump is always compatible. `1.0.0` marks the first stable release.

- The repo-root `VERSION` file is the single source of truth.
- `./scripts/set-version.sh 0.6.0` updates it and syncs `package.json`,
  `tauri.conf.json`, `Cargo.toml` and the lockfiles; a Vitest test fails if they drift.
- The backend gets the version at build time (the Dockerfile's `VERSION` build arg,
  fed from `NEXUS_VERSION`) or, for the packaged app, by `scripts/build-sidecar.js`,
  and reports it in `GET /health`. Local `go build`s report `dev`, which the app treats
  as compatible.
- The desktop app compares its own version with the server's and shows a banner
  when major.minor differs, so an old `.exe` never fails silently against a newer server.
- Release notes live in [CHANGELOG.md](../CHANGELOG.md). Tag releases `vX.Y.Z` on `main`
  (see the promotion flow in CLAUDE.md).

---

## CI/CD

GitHub Actions workflow (`.github/workflows/validate.yml`) runs automatically on:
- Every push to `dev`, `staging`, `main`
- Every pull request targeting those branches

### Jobs

| Job | Runs when | What it does |
|---|---|---|
| Detect changes | Always | Determines which jobs to run based on changed files |
| Backend (Go) | `services/sync-service/**` changes | Lint (golangci-lint), test (`go test -race`), build |
| Desktop (React) | `desktop/**` changes | Lint (ESLint), type check (tsc), test (Vitest) |

---

## Useful Commands

| Task | Command |
|---|---|
| Start dev infrastructure | `docker compose -f docker-compose.dev.yml up -d` |
| Stop dev infrastructure | `docker compose -f docker-compose.dev.yml down` |
| Wipe dev database | `docker compose -f docker-compose.dev.yml down -v` |
| Run backend | `cd services/sync-service && go run cmd/server/main.go` |
| Run backend tests | `cd services/sync-service && go test ./...` |
| Run desktop | `cd desktop && npm run dev` |
| Run desktop tests | `cd desktop && npm test` |
| Start full prod stack | `docker compose up -d` |
| View prod logs | `docker compose logs -f sync-service` |

## Monitoring

`docker compose up` includes Prometheus (`:9090`) and Grafana (`:3001`,
credentials via `GRAFANA_USER`/`GRAFANA_PASSWORD`, defaults must be changed
in production). Grafana auto-provisions the Prometheus datasource and the
NexusNotes dashboard from `infra/grafana/`. The operator stats endpoint
(`GET /api/admin/stats`) is enabled by an `ADMIN_TOKEN` in the sync service's
environment and disabled while it is unset. `docker-compose.yml` does not pass
`ADMIN_TOKEN` through to the sync service yet, so setting it in `.env` alone has
no effect: add `- ADMIN_TOKEN=${ADMIN_TOKEN:-}` to the sync-service
`environment:` list first.

## Email (optional)

Set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM` and `APP_BASE_URL` to enable transactional email. With SMTP
configured, registration sends a verification email and a verified address is
required before creating a vault; "forgot password" sends a reset link. Leave
`SMTP_HOST` empty to disable email entirely (messages are logged instead and
the verification requirement is not enforced).

## Allowed origins (CORS and WebSocket)

`CORS_ALLOWED_ORIGINS` is a comma-separated list of browser origins
(`scheme://host[:port]`, no path) that may call the API cross-origin and open
the sync WebSocket. The same list drives both checks. Unset or empty means the
defaults: the Vite dev servers (`http://localhost:1420`,
`http://localhost:5173`) and the packaged desktop app (`tauri://localhost`,
`http://tauri.localhost`). Setting the variable **replaces** the defaults, so
keep the Tauri origins in the list if desktop clients connect to that server.
Wildcards are rejected at startup.

The web UI in the compose stack needs no entry: nginx serves it and proxies
`/api/` and `/ws` on the same host, and the WebSocket check always accepts the
server's own origin. This relies on the proxy forwarding the browser's `Host`
header **with its port** (`proxy_set_header Host $http_host;`, as in
`desktop/nginx.conf`). A proxy that sends `$host` drops the port, so a UI on
`:3000` fails the same-origin check with `403`. If you put another reverse
proxy in front that rewrites `Host`, either forward it unchanged or add the
public origin (e.g. `https://notes.example.com`) to `CORS_ALLOWED_ORIGINS`.

## Attachments (optional)

Set `MINIO_ENDPOINT` (host:port), `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` and
optionally `MINIO_BUCKET` (default `attachments`) to enable note attachments
backed by MinIO or any S3-compatible store; the bucket is created on startup.
Leave `MINIO_ENDPOINT` empty to disable attachments (the endpoints return 503).
