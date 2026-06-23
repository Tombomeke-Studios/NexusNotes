# Architecture — NexusNotes

## System Overview

```
Clients (Desktop / Mobile / Clipper)
       │
       ▼
   [Nginx Reverse Proxy]
       │
       ├── Sync Service (Go :8080)
       │     ├── REST API (note/vault CRUD)
       │     ├── WebSocket (real-time sync)
       │     ├── PostgreSQL (primary store)
       │     ├── Redis (cache, sessions)
       │     └── MinIO (S3 attachments)
       │
       ├── Search Service (Meilisearch)
       │     └── PostgreSQL (read)
       │
       └── GitHub Service (Go/Node)
             └── PostgreSQL (read/write)
```

## Core Components

| Component | Technology | Role |
|---|---|---|
| Sync Service | Go 1.23 | Note storage, versioning, conflict resolution, real-time sync |
| Desktop App | Tauri + React + TypeScript | Primary editor with markdown preview, file tree, quick switcher |
| Database | PostgreSQL 16 | Structured data (users, vaults, notes, versions) |
| Cache | Redis 7 | Session state, sync cache (future) |
| Storage | MinIO | S3-compatible attachment storage |

## Data Flow

### Note Edit
1. User edits note in desktop app
2. Auto-save debounces (1 second) and sends `PUT /api/notes/:id`
3. Sync service validates checksum against stored version
4. On match: update note, create version, broadcast via WebSocket
5. On mismatch: return 409 Conflict with server/client content

### Authentication
1. User registers/logs in via `POST /api/auth/register|login`
2. Server returns JWT (24h expiry)
3. Client stores token in localStorage
4. All API requests include `Authorization: Bearer <token>`
5. WebSocket connects with `?token=<jwt>&device_id=<uuid>`

## Database Schema

See `services/sync-service/migrations/001_initial_schema.sql` for full schema.

Tables: `users`, `vaults`, `notes`, `note_versions`, `devices`, `attachments`

Key relationships:
- User → many Vaults → many Notes → many NoteVersions
- Notes → many Attachments
- User → many Devices
