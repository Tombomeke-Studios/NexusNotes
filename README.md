# NexusNotes

A markdown-first note-taking platform with cross-device sync, full-text search, graph view, and native GitHub integration. Self-hostable via Docker.

> **AI transparency notice:** This project was built with significant AI assistance (Claude Code). All generated code was reviewed and tested by the developer — AI produced the output, a human directed and verified it. The architecture, feature decisions, and final quality bar are human-owned.

## Quick Start

### Prerequisites

- [Docker & Docker Compose](https://docs.docker.com/get-docker/)

### Start everything

```bash
docker compose up -d
```

That's it. Open `http://localhost:3000` in your browser.

### First use

1. Click **Create Account** (email + password, min 8 characters)
2. Click **+** next to "Vaults" to create a vault
3. Click **+** next to "Notes" to create a note (or press `Ctrl+N`)
4. Write markdown — live preview updates in split view
5. Notes auto-save after 1 second, or press `Ctrl+S`

### Stop

```bash
docker compose down       # stop everything
docker compose down -v    # stop + wipe database
```

## Local Development

NexusNotes ships as a **native desktop app** (Tauri v2). All three pieces below
must be running; the backend and infra are the same whichever way you view the
UI.

| Piece | Port | Purpose |
|---|---|---|
| Docker infra (Postgres + Redis) | 5432 / 6379 | Data + cache/sessions |
| Backend (Go sync-service) | 8080 | REST + WebSocket API |
| Desktop app (Tauri, or Vite in a browser) | 1420 | The UI |

**Prerequisites:** Docker, Go 1.23+, Node 20+. The native desktop app also needs
the [Rust toolchain](https://www.rust-lang.org/tools/install) and, on Windows,
[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled
on Windows 10/11).

### Easiest: one command (recommended)

Two scripts wrap the whole stack — Docker infra, migrations, backend, and the
UI — so you never have to juggle terminals. Run from the repo root (Git Bash on
Windows):

```bash
./scripts/dev-web.sh   # backend + web UI in the browser (fast, no Rust) — quick UI testing
./scripts/dev-app.sh   # backend + native Tauri window — full app testing
```

Each script brings Postgres + Redis up (leaving them running between sessions),
applies migrations, starts the Go backend (reusing one already on `:8080` if
healthy), then launches the UI in the foreground. Press `Ctrl+C` to stop the UI
and backend; the Docker infra keeps running. Stop it with
`docker compose -f docker-compose.dev.yml down`.

The manual steps below are the same thing spelled out, for when you want to run
a single piece on its own.

### 1. Infra + backend (always required)

Run from the repo root, each in its own terminal (leave them running).

**Windows (PowerShell):**
```powershell
# Infra — Docker (detached)
docker compose -f docker-compose.dev.yml up -d

# Backend — Terminal 1
cd services\sync-service
$env:DATABASE_URL = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
$env:REDIS_URL    = "redis://localhost:6379"
$env:JWT_SECRET   = "dev-secret"
$env:PORT         = "8080"
go run cmd/migrate/main.go   # first run only, or after new migrations
go run cmd/server/main.go    # leave running
```

**macOS / Linux (bash):**
```bash
docker compose -f docker-compose.dev.yml up -d

cd services/sync-service
export DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="dev-secret" PORT="8080"
go run cmd/migrate/main.go
go run cmd/server/main.go
```

### 2a. Launch the desktop app (Tauri native window) — the real thing

In a second terminal:

```powershell
# Windows (PowerShell)
cd desktop
npm install                          # first run only
$env:VITE_API_URL = "http://localhost:8080"
npm run tauri dev
```
```bash
# macOS / Linux
cd desktop
npm install
VITE_API_URL=http://localhost:8080 npm run tauri dev
```

This starts Vite and opens the native window automatically. **The first launch
compiles the Rust shell and takes a few minutes**; later launches are fast. The
custom title bar's minimize / maximize / close buttons work here (the app runs
with the OS frame disabled, `decorations: false`).

> `VITE_API_URL` must be set in the terminal *before* `npm run tauri dev`, so the
> Vite dev server it spawns knows where the backend is.

### 2b. Or run the UI in a browser (lightweight, no Rust) — for quick UI work

```powershell
# Windows (PowerShell)
cd desktop
npm install
$env:VITE_API_URL = "http://localhost:8080"
npm run dev
```

Open **http://localhost:1420**. Hot-reload; everything works — editor, tabs,
command palette, graph, daily notes, right panel, settings, global search. The
**only** difference from the native window: the title-bar window buttons
(minimize / maximize / close) are inert in a browser, because they call native
Tauri APIs. Harmless — use this when you don't want to wait on Rust compiles.

Either way, register an account on the first screen, create a vault, and start
testing.

### Keyboard shortcuts to try

`Ctrl+P` quick-open · `Ctrl+Shift+P` command palette · `Ctrl+Shift+F` global
search · `Ctrl+N` new note · `Ctrl+G` graph · `Ctrl+D` daily note · `Ctrl+E`
cycle view · `Ctrl+B` toggle sidebar · `Ctrl+.` toggle right panel · `Ctrl+,`
settings.

### Stop everything

```powershell
# Stop backend / frontend: Ctrl+C in each terminal
docker compose -f docker-compose.dev.yml down      # stop infra
docker compose -f docker-compose.dev.yml down -v   # stop infra + wipe the database
```

Optional: search (`Ctrl+Shift+F`) is powered by Meilisearch. The backend runs
fine without it (search just returns "unavailable"); to enable it locally add
the `meilisearch` service: `docker compose -f docker-compose.dev.yml up -d meilisearch`.

## Tech Stack

| Component | Technology |
|---|---|
| Sync Service | Go 1.23 |
| MCP Service | Go 1.23 — Model Context Protocol (spec 2025-11-25) |
| Search | Meilisearch 1.x |
| Desktop App | Tauri v2 + React + TypeScript |
| Mobile App | Flutter (planned) |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Attachments | MinIO (S3-compatible) |

## Project Structure

```
NexusNotes/
├── services/sync-service/     # Go backend (REST + WebSocket)
├── desktop/                   # React app (served via nginx in Docker)
├── docs/                      # Documentation
├── docker-compose.yml         # Full production stack
├── docker-compose.dev.yml     # Dev: databases only
├── CLAUDE.md                  # AI agent workflow rules
└── TODO.md                    # Task tracking
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick switcher (search notes) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+N` | Create new note |
| `Ctrl+S` | Save current note |
| `Ctrl+E` | Toggle edit / preview / split mode |
| `Ctrl+G` | Open graph view |
| `Ctrl+D` | Open or create today's daily note |
| `Ctrl+F` | Search in current note |
| `Ctrl+Shift+F` | Global search across vault |
| `Ctrl+Shift+L` | Link existing file into vault |
| `Ctrl+,` | Settings |

## Testing

```bash
# Backend
cd services/sync-service && go test ./...

# Desktop
cd desktop && npm test
```

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flows, ER diagram |
| [API](docs/api.md) | REST endpoints, WebSocket messages |
| [Deployment](docs/deployment.md) | Docker, environment setup |
| [Security](docs/security.md) | Auth, encryption, known gaps |
| [Encryption](docs/encryption.md) | E2EE design, key hierarchy, threat model |
| [MCP Server](docs/mcp.md) | AI client access via Model Context Protocol |

## Concept Design

The original design documents and functional analysis live in the
[CONCEPTS repository](https://github.com/Tombomeke-Studios/CONCEPTS/tree/main/nexus-notes-platform).
NexusNotes is part of the Tombomeke Studios product ecosystem alongside FinVault and NexusInfra.

## Branch Strategy

```
feature/<topic>  →  dev  →  staging  →  main (production)
```

See [CLAUDE.md](CLAUDE.md) for full workflow rules.
