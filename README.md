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

For working on the code with hot-reload, use the dev compose (infra only) and run services locally:

```bash
# Start databases
docker compose -f docker-compose.dev.yml up -d

# Terminal 1: backend
cd services/sync-service
export DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
export JWT_SECRET="dev-secret"
go run cmd/server/main.go

# Terminal 2: frontend
cd desktop
npm install
npm run dev
```

Open `http://localhost:1420`. The frontend proxies API calls — set `VITE_API_URL=http://localhost:8080` if needed.

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
$env:JWT_SECRET = "dev-secret"
go run cmd/server/main.go
```

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
