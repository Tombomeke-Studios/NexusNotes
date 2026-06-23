# NexusNotes

A markdown-first note-taking platform with cross-device sync, full-text search, graph view, and native GitHub integration. Self-hostable via Docker.

## Tech Stack

| Component | Technology |
|---|---|
| Sync Service | Go |
| Desktop App | Tauri + React + TypeScript |
| Database | PostgreSQL |
| Cache / Sessions | Redis |
| Attachments | MinIO (S3-compatible) |
| Reverse Proxy | Nginx |

## Getting Started

### Prerequisites

- [Go 1.23+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/)
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Rust](https://rustup.rs/) (for Tauri desktop builds)

### Development

```bash
# Start infrastructure (PostgreSQL, Redis, MinIO)
docker compose -f docker-compose.dev.yml up -d

# Run the sync service
cd services/sync-service
go run cmd/server/main.go

# Run the desktop app
cd desktop
npm install
npm run dev
```

### Testing

```bash
# Backend tests
cd services/sync-service
go test ./...

# Desktop tests
cd desktop
npm test
```

### Docker (Full Stack)

```bash
docker compose up
```

## Project Structure

```
NexusNotes/
├── services/
│   └── sync-service/          # Go backend (REST + WebSocket)
├── desktop/                   # Tauri + React desktop app
├── db/migrations/             # SQL migration files
├── docs/                      # Project documentation
├── .github/workflows/         # CI/CD pipelines
├── docker-compose.yml         # Production stack
├── docker-compose.dev.yml     # Development stack
├── CLAUDE.md                  # AI agent workflow rules
└── TODO.md                    # Task tracking
```

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flows, component overview |
| [API](docs/api.md) | REST endpoints, WebSocket protocol |
| [Deployment](docs/deployment.md) | Docker setup, environment variables |
| [Security](docs/security.md) | Auth, encryption, secret management |

## Branch Strategy

```
feature/<topic>  →  dev  →  staging  →  main (production)
```

See [CLAUDE.md](CLAUDE.md) for full workflow rules.
