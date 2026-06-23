# Deployment — NexusNotes

## Development Setup

### Prerequisites
- Docker & Docker Compose
- Go 1.23+ (for backend development)
- Node.js 20+ (for desktop development)
- Rust (for Tauri desktop builds)

### Quick Start

1. Start infrastructure:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Run migrations:
   ```bash
   cd services/sync-service
   DATABASE_URL=postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable go run cmd/migrate/main.go
   ```

3. Start the sync service:
   ```bash
   cd services/sync-service
   DATABASE_URL=postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable \
   JWT_SECRET=dev-secret \
   go run cmd/server/main.go
   ```

4. Start the desktop app:
   ```bash
   cd desktop
   npm install
   npm run dev
   ```

5. Open http://localhost:1420

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| DATABASE_URL | Yes | — | PostgreSQL connection string |
| JWT_SECRET | Yes | — | Secret for JWT signing |
| PORT | No | 8080 | Sync service listen port |
| REDIS_URL | No | redis://localhost:6379 | Redis connection string |
| VITE_API_URL | No | http://localhost:8080 | API base URL for desktop |
| VITE_WS_URL | No | ws://localhost:8080 | WebSocket URL for desktop |

## Production (Docker Compose)

1. Copy `.env.example` to `.env` and set real values:
   ```bash
   cp .env.example .env
   # Edit .env — especially JWT_SECRET
   ```

2. Start the full stack:
   ```bash
   docker compose up -d
   ```

3. Run migrations:
   ```bash
   docker compose exec sync-service ./sync-service migrate
   ```

### Services

| Service | Port | Description |
|---|---|---|
| sync-service | 8080 | Go backend API + WebSocket |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Cache and sessions |
| minio | 9000/9001 | S3 storage / console |

## CI/CD

GitHub Actions workflow (`.github/workflows/validate.yml`) runs on every PR and push to dev/staging/main:

- **Backend job:** Go lint (golangci-lint), tests with PostgreSQL service, build check
- **Desktop job:** ESLint, TypeScript type check, Vitest tests

Jobs only run when their respective directories have changes (path filtering).
