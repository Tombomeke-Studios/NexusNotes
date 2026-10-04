# NexusNotes

**Your notes, linked like your thoughts, and private by default.** NexusNotes is a
markdown-first note-taking app you host yourself: write in plain markdown, connect notes
with `[[links]]`, see how they relate in a graph, and keep every device in sync, with your
vaults end-to-end encrypted unless you choose otherwise.

![The NexusNotes editor: markdown source with syntax highlighting next to its rendered preview](docs/images/editor.png)

> **AI transparency notice:** This project was built with significant AI assistance (Claude Code). All generated code was reviewed and tested by the developer — AI produced the output, a human directed and verified it. The architecture, feature decisions, and final quality bar are human-owned.

## What it does

- **Write in markdown** with a live preview, syntax highlighting, callouts, tasks, tables and
  code blocks; switch between Edit, Split and Read.
- **Link notes** with `[[wikilinks]]` and see them connect: backlinks, hover previews and
  an interactive graph (with a list view for keyboards and screen readers).
- **Find anything**: quick open, a command palette and full-text search with tag filters.
- **Never lose text**: autosave, version history with diffs and restore, conflict
  resolution when two devices edit the same note.
- **Stay private**: vaults are end-to-end encrypted by default (titles, folders, files and
  linked files included); everything else is encrypted at rest on the server.
- **Organise** with folders, nested tags, stars, daily, weekly and monthly notes, and
  templates; attach files; import a folder of markdown (an Obsidian vault works).
- **Share a vault** with others as viewer or editor; export everything as markdown.
- **Desktop app** (Tauri) for Windows, macOS and Linux, or the web UI from the Docker stack.

| Graph view | Command palette |
|---|---|
| ![Graph view with link arrows and a hover card](docs/images/graph.png) | ![Command palette running a command](docs/images/palette.png) |

## Quick Start

### Prerequisites

- [Docker & Docker Compose](https://docs.docker.com/get-docker/)

### Start everything

```bash
cp .env.production.example .env   # then fill in the REQUIRED secrets
docker compose up -d
```

Open `http://localhost:3000` in your browser. The stack has no built-in passwords:
see [docs/deployment.md](docs/deployment.md#production-docker-compose) for the
settings, upgrading an existing installation and optional monitoring. Before others sign up,
complete the policy pages in `desktop/public/legal/`
([why](docs/deployment.md#legal-pages-required-before-opening-a-server-to-others)).

### First use

1. **Create an account** (email and a password of at least 8 characters).
2. **Name your first vault.** It is end-to-end encrypted unless you untick that; keep the
   recovery code it shows you somewhere safe.
3. Your vault starts with a short **Getting Started** guide and a few linked example notes;
   the checklist in the sidebar walks you through the first steps.
4. Press `Ctrl+N` for a new note, `Ctrl+G` for the graph and `?` for every shortcut.
5. Notes save themselves a second after you stop typing.

### Stop

```bash
docker compose down       # stop everything
docker compose down -v    # stop + wipe database
```

## Local Development

### Dev container (recommended for a reproducible setup)

Open the repo in VS Code and choose **Reopen in Container** (needs Docker Desktop
and the Dev Containers extension). It provides Go 1.25, Node 20, Rust, Postgres and
Redis, so no machine-specific toolchain is needed. Claude Code (CLI + VS Code extension)
is installed automatically; its login and the `gh` login live in named volumes, so you
only sign in once (`claude`, `gh auth login`) and it survives a rebuild. Run `./scripts/dev-web.sh` inside
the container and open http://localhost:1420 for UI work, or `npm run tauri dev` /
`desktop/e2e` (Playwright) for a native/native-like window — on Windows hosts with
WSLg (the default on Windows 11), the container forwards its display so the Tauri
window renders; without WSLg, that window can't render and you should stick to
`dev-web.sh` or test on the host instead. Either way, **the Windows `.exe`
installer** is a cross-compile target the container can't produce — build that on
a Windows host (below).

**Windows host, native app:** use the **MSVC** Rust toolchain
(`rustup default stable-x86_64-pc-windows-msvc`) with the Visual Studio C++ build
tools. The GNU toolchain (e.g. Rust from Chocolatey) fails with
`dlltool.exe: program not found`.

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

The backend they start listens on localhost only and signs sessions with a random
secret generated on the first run (kept in `services/sync-service/tmp/jwt-secret`,
which git ignores; a damaged file is replaced). Delete that file to sign every dev
session out. It also listens on `::1` when the machine has an IPv6 loopback.

The manual steps below are the same thing spelled out, for when you want to run
a single piece on its own.

### Even easier: a standalone `.exe` (no terminal, no scripts)

For just *using* the app day to day (not developing it), build a packaged
installer once:

```bash
cd desktop
npm install
npm run tauri build          # first run only; rebuild after backend/frontend changes
```

This produces an installer under `desktop/src-tauri/target/release/bundle/`.
Install it and launch **NexusNotes** like any other app — double-click, no
terminal. On startup it automatically:

1. Runs `docker compose up -d postgres redis` (Docker Desktop must already be
   running — the app doesn't start Docker itself).
2. Starts the Go backend, bundled inside the app as a "sidecar" binary, and
   waits for it to become healthy.
3. Opens the native window once the backend is ready.

Closing the app stops the bundled backend process; the Docker containers are
left running so the next launch is fast (same behaviour as the dev scripts).
This is **not** a dev workflow — code changes require rebuilding the
installer — use `./scripts/dev-app.sh` + `npm run tauri dev` (below) while
actively developing.

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
$env:JWT_SECRET   = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })   # at least 32 characters
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
export JWT_SECRET="$(openssl rand -hex 32)" PORT="8080"
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
| MCP Service | Go — Model Context Protocol (planned, after 1.0) |
| Search | Meilisearch 1.x |
| Desktop App | Tauri v2 + React + TypeScript |
| Mobile App | Flutter (planned, after 1.0) |
| Database | PostgreSQL 16 |
| Cache | Redis 7 (part of the stack; not used by the sync service yet) |
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

Press `?` in the app for the full list. The most used:

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick open a note |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+N` | New note |
| `Ctrl+E` | Cycle edit / split / read |
| `Ctrl+G` | Graph view |
| `Ctrl+D` | Today's daily note |
| `Ctrl+T` | Insert a template |
| `Ctrl+Shift+F` | Search across the vault |
| `Ctrl+Shift+H` | Version history of the open note |
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
| [Deployment](docs/deployment.md) | Docker, environment setup, [backup and restore](docs/deployment.md#backup-and-restore), [upgrading](docs/deployment.md#upgrading-to-a-new-release) |
| [Security](docs/security.md) | Auth, encryption, known gaps |
| [Security policy](SECURITY.md) | How to report a vulnerability privately; supported versions |
| [Contributing](CONTRIBUTING.md) | Branches, commit format, TDD, test and lint commands |
| [Encryption](docs/encryption.md) | E2EE design, key hierarchy, threat model |
| [MCP Server](docs/mcp.md) | AI client access via Model Context Protocol (planned) |
| [Brand](docs/brand.md) | Name, tagline, colours and logo rules |
| [Changelog](CHANGELOG.md) | What changed in each release |
| [MCP Server](docs/mcp.md) | AI client access via Model Context Protocol |
| [Resilience](docs/resilience.md) | Chaos experiments: what users see when Postgres, the backend or Redis fails |

## Concept Design

The original design documents and functional analysis live in the
[CONCEPTS repository](https://github.com/Tombomeke-Studios/CONCEPTS/tree/main/nexus-notes-platform).
NexusNotes is part of the Tombomeke Studios product ecosystem alongside FinVault and NexusInfra.

## Branch Strategy

```
feature/<topic>  →  dev  →  staging  →  main (production)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor workflow and
[CLAUDE.md](CLAUDE.md) for the full rules.

## License

NexusNotes is **source-available** under the [PolyForm Shield License 1.0.0](LICENSE).
In short: you may use, modify and share it (personally or inside a company), but you may
not use it to offer a product that competes with NexusNotes, whether sold or free. The
[LICENSE](LICENSE) text is what counts; this summary is not legal advice.
