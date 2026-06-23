# Deployment — NexusNotes

## Local Development

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Go | 1.23+ | Backend sync service |
| Node.js | 20+ | Desktop app development |
| Docker | Latest | PostgreSQL, Redis, MinIO |
| Docker Compose | v2+ | Infrastructure orchestration |

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

### 2. Start the stack

```bash
docker compose up -d
```

This starts the sync service, PostgreSQL, Redis, and MinIO. The sync service auto-runs migrations.

### 3. Verify

```bash
curl http://localhost:8080/health
# {"status":"ok"}
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
