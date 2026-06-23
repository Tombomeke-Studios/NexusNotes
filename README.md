# NexusNotes

A markdown-first note-taking platform with cross-device sync, full-text search, graph view, and native GitHub integration. Self-hostable via Docker.

## Quick Start (Local Development)

### Prerequisites

- [Go 1.23+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/)
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)

### 1. Start the database

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL (port 5432), Redis (port 6379), and MinIO (port 9000).

### 2. Start the backend

```bash
cd services/sync-service

# Set environment variables
export DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
export JWT_SECRET="dev-secret-change-in-production"

# Run the server (auto-runs migrations on first start)
go run cmd/server/main.go
```

The API is now running at `http://localhost:8080`. Verify with:

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

**Windows (PowerShell):**
```powershell
cd services/sync-service
$env:DATABASE_URL = "postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable"
$env:JWT_SECRET = "dev-secret-change-in-production"
go run cmd/server/main.go
```

### 3. Start the desktop app

Open a new terminal:

```bash
cd desktop
npm install
npm run dev
```

Open `http://localhost:1420` in your browser. Register a new account, create a vault, and start writing notes.

### 4. Test the full flow

1. Register at the login screen (email + password, min 8 characters)
2. Create a vault (click + next to "Vaults" in the sidebar)
3. Create a note (click + next to "Notes", or press `Ctrl+N`)
4. Write markdown in the editor — live preview updates in real-time
5. Notes auto-save after 1 second of inactivity, or press `Ctrl+S`
6. Press `Ctrl+P` to open the quick switcher and search notes

## Quick Start (Docker — Full Stack)

```bash
# Copy and edit environment variables
cp .env.example .env
# Edit .env — set a real JWT_SECRET

# Start everything
docker compose up -d

# Check health
curl http://localhost:8080/health
```

Then open `http://localhost:1420` (if running desktop dev) or connect your client to `http://localhost:8080`.

## Tech Stack

| Component | Technology |
|---|---|
| Sync Service | Go 1.23 |
| Desktop App | React + TypeScript + Vite |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Attachments | MinIO (S3-compatible) |

## Project Structure

```
NexusNotes/
├── services/sync-service/     # Go backend (REST + WebSocket)
│   ├── cmd/server/            # Server entry point
│   ├── cmd/migrate/           # Standalone migration runner
│   ├── internal/              # Application code
│   │   ├── handler/           # HTTP handlers
│   │   ├── service/           # Business logic
│   │   ├── repository/        # Database access
│   │   ├── middleware/        # Auth, logging
│   │   ├── model/             # Domain models
│   │   ├── ws/                # WebSocket hub
│   │   └── config/            # Environment config
│   └── migrations/            # SQL migration files
├── desktop/                   # React desktop app
│   └── src/
│       ├── components/        # Editor, Sidebar, Search, Auth
│       └── lib/               # API client, sync, types
├── docs/                      # Documentation
├── docker-compose.yml         # Production stack
├── docker-compose.dev.yml     # Dev infrastructure only
├── CLAUDE.md                  # AI agent workflow rules
└── TODO.md                    # Task tracking
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret key for JWT token signing |
| `PORT` | No | `8080` | Backend server port |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection |
| `VITE_API_URL` | No | `http://localhost:8080` | API URL for desktop app |
| `VITE_WS_URL` | No | `ws://localhost:8080` | WebSocket URL for desktop app |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick switcher (search notes) |
| `Ctrl+N` | Create new note |
| `Ctrl+S` | Save current note |
| `Ctrl+E` | Toggle edit / preview / split mode |

## API

See [docs/api.md](docs/api.md) for the full REST API and WebSocket protocol reference.

## Testing

```bash
# Backend
cd services/sync-service
go test ./...

# Desktop
cd desktop
npm test
```

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flows |
| [API](docs/api.md) | REST endpoints, WebSocket messages |
| [Deployment](docs/deployment.md) | Docker, environment setup |
| [Security](docs/security.md) | Auth, encryption, known gaps |

## Branch Strategy

```
feature/<topic>  →  dev  →  staging  →  main (production)
```

See [CLAUDE.md](CLAUDE.md) for full workflow rules.
