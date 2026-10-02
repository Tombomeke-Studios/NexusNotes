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

The container also installs Claude Code (the `anthropics/devcontainer-features/claude-code`
feature plus the VS Code extension). `CLAUDE_CONFIG_DIR` points at `/home/vscode/.claude`,
which — like `/home/vscode/.config/gh` — is a named volume (`claude_config`, `gh_config`),
so the Claude Code and GitHub CLI logins survive rebuilding the container. Remove those
volumes to sign out completely.

The native Tauri window needs a display. On Windows 11 with WSL2, WSLg provides one
automatically and the container's `docker-compose.yml` forwards its X11/Wayland
sockets (`/tmp/.X11-unix`, `/mnt/wslg`) — no extra setup needed. On hosts without
WSLg (older Windows 10, or Docker Desktop without a WSLg-backed distro), those mounts
are absent and `npm run tauri dev` inside the container will fail to open a window;
in that case use `./scripts/dev-web.sh` and test in a browser, or run the desktop app
natively outside the container instead.

On a Windows host the repo is a bind mount where file-change events never reach
the container, so inside it (`NEXUS_DEVCONTAINER=1`) Vite polls the source tree
every 500 ms instead, skipping `node_modules`, `src-tauri` and build output (#367).
Without that, edits made from Windows would not show up until Vite restarts. Either way, `desktop/e2e/*.spec.ts`
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
export JWT_SECRET="$(openssl rand -hex 32)"   # at least 32 characters
export DATA_ENCRYPTION_KEY="..."              # 64 hex characters; keep the same one between runs
go run cmd/server/main.go
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
$env:JWT_SECRET = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })   # at least 32 characters
$env:DATA_ENCRYPTION_KEY = "..."   # 64 hex characters; keep the same one between runs
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

The installed desktop app is self-sufficient: it starts Postgres, Redis and MinIO
(attachment storage) through `docker compose` and runs a bundled copy of the sync
service, so **Docker Desktop is the only prerequisite**. A supervisor thread keeps this going in the background
and never blocks the window:

- It waits for the Docker engine (launching Docker Desktop right before the app is fine)
  and retries until Postgres and Redis report healthy. MinIO is then started on its own
  and given up to 30 seconds to become ready, because the backend checks object storage only
  once at startup. If MinIO cannot start (for example its port 9000 is taken) or never
  becomes ready, the app still runs, only without attachments until the app restarts.
- Attachments are stored in the `minio_dev_data` Docker volume, so they survive container
  recreation and Docker Desktop restarts.
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
cp .env.production.example .env
```

Fill in every value the file marks REQUIRED (`JWT_SECRET`, `DATA_ENCRYPTION_KEY`,
`POSTGRES_PASSWORD`, `MEILI_MASTER_KEY`, `MINIO_ROOT_PASSWORD`), each with its own random value, for
example from `openssl rand -hex 32` (letters and digits only: the database password
goes into a URL, where `@ : / ? # %` break it). There are no built-in defaults: `docker compose`
refuses to start while one of them is empty, and the sync service refuses a
`JWT_SECRET` shorter than 32 characters.

`DATA_ENCRYPTION_KEY` encrypts user data at rest and must be exactly 64 hex
characters (`openssl rand -hex 32`). **Back it up separately from the database
backups** (a password manager or secrets vault): without it, the stored data
cannot be read by anyone. To rotate it, move the current key into
`DATA_ENCRYPTION_OLD_KEYS` and set a new one; see
[docs/security.md](security.md#encryption-at-rest).

**Upgrading to encryption at rest:** existing data is encrypted automatically
after the first start with a `DATA_ENCRYPTION_KEY`; the service keeps serving
meanwhile. Data in database backups taken before that stays readable, so
replace those backups once the log shows `encryption backfill done`.

**Search data (`meili_data` volume):** Meilisearch stores a readable copy of
standard-vault notes, which the field-level encryption does not cover. Put the
Docker volume on an encrypted disk (for example a LUKS-encrypted data disk or an
encrypted cloud volume) and **leave it out of backups**: on startup the sync
service rebuilds an empty index from the database, so after a restore search
comes back by itself (the log says `search index rebuilt from the database`).
To force a rebuild, stop the stack, remove the `meili_data` volume and start it
again.

`TRUSTED_PROXIES` names the reverse proxies whose `X-Forwarded-For` / `X-Real-IP`
headers the sync service believes (comma-separated CIDRs or IPs). The production
compose defaults it to the private ranges, since only the web UI's nginx can reach
the service; if another proxy (a TLS terminator, say) sits in front of the web UI,
add its address too and make it append `X-Forwarded-For`. Without the right value
all users share one rate limit.

`BIND_ADDR` (optional) limits the addresses the sync service listens on, as a
comma-separated list such as `127.0.0.1,::1`. Leave it unset inside Docker: the
container must listen on every interface or its published port cannot reach it.
Set it when you run the binary directly on a host and put a reverse proxy in front.
A value that names no address at all (only commas or spaces) stops the service at
start-up rather than silently listening everywhere.

### 2. Start the stack

```bash
docker compose up -d
```

This builds and starts the web UI, the sync service, PostgreSQL, Redis, MinIO and
Meilisearch. The sync service applies database migrations on start-up.

### 3. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.5.0"}
```

### Services

Only the web UI is published. It serves the app and proxies `/api`, `/ws` and
`/health` to the sync service; everything else is reachable on the stack's internal
network only. Put TLS in front of port 3000 (a reverse proxy such as Caddy or
nginx) before exposing it beyond your own machine.

| Service | Published | Description |
|---|---|---|
| desktop (web UI) | `3000` (`NEXUS_HTTP_PORT`) | Static app + proxy to the sync service |
| sync-service | internal | Go backend API + WebSocket |
| postgres | internal | PostgreSQL database |
| redis | internal | Cache and WebSocket tickets |
| minio | internal | S3-compatible attachment storage |
| meilisearch | internal | Full-text search |

Every image is pinned to an explicit version, and each service has a memory limit
(512 MB for the sync service and MinIO, 1 GB for Postgres and Meilisearch, 256 MB
for the rest). Raise a limit in `docker-compose.yml` (or an override file) for a
large installation.

### Backup and restore

A complete backup is three things. Keep them apart: whoever has all three can
read every standard vault.

| What | Why | How |
|---|---|---|
| `.env`, above all `DATA_ENCRYPTION_KEY` | Without the key the stored data cannot be read by anyone | Copy it once, and after every change, into a password manager or secrets vault. Never next to the database backups |
| The database (`postgres_data`) | Accounts, vaults, notes (encrypted at rest) | `pg_dump`, below |
| Attachment files (`minio_data`) | Uploaded files (encrypted at rest) | Archive the volume, below |

Not needed: `meili_data` (the search index is rebuilt from the database on start,
and should stay out of backups because it holds readable copies; see Search data)
and `redis_data` (transient). End-to-end encrypted vaults stay unreadable even
with all of the above: their owners need their passphrase or recovery code.

**Back up** (run from the directory with `docker-compose.yml`):

```bash
# Database: a consistent dump while the stack runs.
docker compose exec -T postgres pg_dump -U nexus -Fc nexus_notes > nexus-db-$(date +%F).dump

# Attachment files: archive the MinIO volume (its name is prefixed with the
# compose project name; `docker volume ls | grep minio_data` shows it).
docker run --rm -v "$(docker volume ls -q | grep minio_data)":/data -v "$PWD":/backup \
  alpine tar czf /backup/nexus-files-$(date +%F).tgz -C /data .
```

**Restore** on a new host (or after losing the volumes):

1. Check out the same release, and restore `.env` with the **same**
   `DATA_ENCRYPTION_KEY` (and `DATA_ENCRYPTION_OLD_KEYS`, if any).
2. Start only the database and load the dump:
   ```bash
   docker compose up -d postgres
   docker compose exec -T postgres pg_restore -U nexus -d nexus_notes --clean --if-exists < nexus-db-2026-10-02.dump
   ```
3. Restore the files into the MinIO volume (create it by starting MinIO once,
   then stop it):
   ```bash
   docker compose up -d minio && docker compose stop minio
   docker run --rm -v "$(docker volume ls -q | grep minio_data)":/data -v "$PWD":/backup \
     alpine sh -c "cd /data && tar xzf /backup/nexus-files-2026-10-02.tgz"
   ```
4. Start everything: `docker compose up -d`. The search index rebuilds by itself
   (the log says `search index rebuilt from the database`).

Try a restore on a spare machine now and then: a backup that was never restored
is a hope, not a backup.

### Upgrading to a new release

1. Read the release's section in `CHANGELOG.md`, especially *Security* and
   anything about new required settings (a new release may refuse to start
   without one, such as `DATA_ENCRYPTION_KEY` for encryption at rest).
2. Back up (above).
3. Update and restart:
   ```bash
   git fetch --tags && git checkout vX.Y.Z
   export NEXUS_VERSION=$(cat VERSION)
   docker compose build && docker compose up -d --remove-orphans
   ```
   Database migrations run automatically when the sync service starts.
4. Check that it is healthy: `docker compose ps` shows the sync service as
   `healthy` once `/ready` passes, and `curl http://localhost:3000/health`
   reports the new version.

To roll back, check out the previous release and restore the backup from step 2:
migrations only move forward.

### Upgrading from an older installation (one-time notes)

Earlier versions had built-in passwords for the database (`nexus_pass`) and MinIO
(`nexus_minio_pass`). A database password is only applied when its volume is first
created, so an existing installation must keep using the password its database
already has: put `POSTGRES_PASSWORD=nexus_pass` and `MINIO_ROOT_PASSWORD=nexus_minio_pass`
in `.env` to start as before. To move to a new database password, connect to the
postgres container with `psql` as the `nexus` user, change that user's password, then
put the same value in `POSTGRES_PASSWORD` and run `docker compose up -d`. MinIO and
Meilisearch take new values from `.env` on their next start.

The first start after upgrading must remove the containers of services that left
`docker-compose.yml`, or Prometheus and Grafana keep running with their old,
network-wide ports (and Grafana with the password it was first given):

```bash
docker compose up -d --remove-orphans
```

To keep monitoring, start it from the overlay instead (see Monitoring) and set
`GRAFANA_PASSWORD`; change the Grafana admin password in Grafana itself if the old
default was still in use.

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
  When cutting a release, move the *Unreleased* entries under a new
  `## [X.Y.Z] - YYYY-MM-DD` heading and add its compare link at the bottom of
  the changelog (`[X.Y.Z]: …/compare/vPREV...vX.Y.Z`).

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
| Docker images | `services/sync-service/**`, `desktop/**` or `docker-compose.yml` changes | Builds the sync service and web UI production images (no push), so an unbuildable Dockerfile fails CI |

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

Prometheus and Grafana are optional and live in their own compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Set `GRAFANA_PASSWORD` in `.env` first (there is no default). Both UIs listen on
the host's loopback only (Prometheus on `127.0.0.1:9090`, Grafana on
`127.0.0.1:3001`); reach them from elsewhere through an SSH tunnel. Grafana
auto-provisions the Prometheus datasource and the NexusNotes dashboard from
`infra/grafana/`. The overlay turns on the sync service's metrics listener
(`METRICS_ADDR=:9091`); without it `/metrics` is not served at all, and it is never
served on the API port.

The sync service image runs as an unprivileged user (uid 10001) and declares a
Docker `HEALTHCHECK` on `GET /ready`, so `docker compose ps` shows it as healthy
only while it can reach Postgres. The operator stats endpoint (`GET /api/admin/stats`) is enabled
by `ADMIN_TOKEN` in `.env` and disabled while it is empty.

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

## Linked files (optional)

The linked-file URL proxy only connects to public internet addresses. To let
users link resources on your own network (a NAS, an intranet wiki), set
`LINKED_FILES_ALLOW_PRIVATE=true`; any authenticated user can then make the
server fetch internal URLs, so only enable it on a trusted, single-tenant
instance. See docs/security.md.
