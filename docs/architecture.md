# Architecture — NexusNotes

## System Overview

```mermaid
graph TB
    subgraph Clients
        DESK["Desktop App<br/><small>Tauri v2 + React</small>"]
        MOB["Mobile App<br/><small>Flutter</small>"]
        CLIP["Web Clipper<br/><small>Browser Extension</small>"]
        AI["AI Clients<br/><small>Claude Desktop · Cursor</small>"]
    end

    NGINX["Nginx<br/><small>Reverse Proxy · TLS</small>"]

    subgraph Services
        SYNC["Sync Service<br/><small>Go · REST · WebSocket</small>"]
        MCP["MCP Service<br/><small>Go · stdio · Streamable HTTP</small>"]
        SEARCH["Meilisearch<br/><small>Full-text search</small>"]
        GH["GitHub Service<br/><small>OAuth · Webhooks</small>"]
    end

    subgraph Storage
        PG[("PostgreSQL 16")]
        REDIS["Redis 7<br/><small>Cache · Sessions</small>"]
        MINIO["MinIO<br/><small>Attachments (S3)</small>"]
    end

    DESK & MOB & CLIP --> NGINX
    AI --> MCP
    NGINX --> SYNC & SEARCH & GH
    SYNC --> PG & REDIS & MINIO
    SYNC -.->|"async index"| SEARCH
    MCP --> SYNC
    GH --> PG

    style DESK fill:#ffc131,stroke:#ffc131,color:#000
    style MOB fill:#02569b,stroke:#02569b,color:#fff
    style CLIP fill:#374151,stroke:#374151,color:#fff
    style AI fill:#7c3aed,stroke:#7c3aed,color:#fff
    style SYNC fill:#7c3aed,stroke:#7c3aed,color:#fff
    style MCP fill:#7c3aed,stroke:#7c3aed,color:#fff
    style SEARCH fill:#7c3aed,stroke:#7c3aed,color:#fff
    style GH fill:#7c3aed,stroke:#7c3aed,color:#fff
    style NGINX fill:#374151,stroke:#374151,color:#fff
    style REDIS fill:#dc2626,stroke:#dc2626,color:#fff
```

## Core Components

| Component | Technology | Role |
|---|---|---|
| Sync Service | Go 1.23 | Note storage, versioning, conflict resolution, real-time sync |
| MCP Service | Go 1.23 | AI client access via Model Context Protocol (spec 2025-11-25) |
| Search Service | Meilisearch 1.x | Full-text search, fuzzy matching, tag and folder filters |
| GitHub Service | Go 1.23 | OAuth, repository import, webhook-driven sync |
| Desktop App | Tauri v2 + React + TypeScript | Primary editor — markdown preview, graph view, offline-first |
| Mobile App | Flutter | Mobile editor with simplified graph view |
| Web Clipper | Browser Extension (JS) | Save web pages and selections to a vault |
| Database | PostgreSQL 16 | Structured data (users, vaults, notes, versions) |
| Cache | Redis 7 | Session state, WebSocket sync state, rate limiting |
| Storage | MinIO | S3-compatible attachment storage |
| Proxy | Nginx | TLS termination, routing |

## Data Flows

### Note sync (real-time)

```mermaid
sequenceDiagram
    participant A as Device A
    participant S as Sync Service
    participant B as Device B

    A->>S: PUT /api/notes/:id {content, prev_checksum}
    S->>S: SHA-256(content) vs stored checksum
    alt Checksums match
        S->>S: Update note, create version record
        S->>B: WebSocket push {type: note:updated}
        S->>A: 200 OK {note}
    else Conflict (mismatch)
        S->>A: 409 Conflict {server_content, client_content}
        Note over A: User resolves in merge UI
        A->>S: PUT /api/notes/:id {resolved_content}
    end
```

### Search indexing

1. Note created or updated in Sync Service
2. Sync Service publishes an async index task to Meilisearch — does not block the save response
3. Meilisearch indexes title, content, tags, and path; skips content for encrypted vaults
4. Client sends `GET /search?q=&vault=&tag=&date_from=&date_to=` to the Sync Service
5. Sync Service proxies to Meilisearch and returns ranked results with context snippets

> Configure Meilisearch searchable attributes and filterable attributes **before** adding
> documents — changing them after indexing triggers a full reindex.

### Authentication

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Sync Service

    C->>S: POST /api/auth/login {email, password}
    S->>S: bcrypt.Compare(password, hash)
    S->>C: 200 {user, token (JWT 24h)}
    C->>C: Store token in localStorage
    C->>S: GET /api/vaults (Authorization: Bearer <token>)
    C->>S: WS /ws?token=<jwt>&device_id=<uuid>
```

### Search indexing

1. Note created or updated in Sync Service
2. Sync Service publishes an async index task to Meilisearch — does not block the save response
3. Meilisearch indexes title, content, tags, and path; skips content for encrypted vaults
4. Client sends `GET /search?q=&vault=&tag=&date_from=&date_to=` to the Sync Service
5. Sync Service proxies to Meilisearch and returns ranked results with context snippets

> Configure Meilisearch searchable attributes and filterable attributes **before** adding
> documents — changing them after indexing triggers a full reindex.

## Database Schema

See `services/sync-service/migrations/001_initial_schema.sql` for the full schema.

```mermaid
erDiagram
    users {
        uuid id PK
        text email
        text password_hash
        text display_name
        timestamptz created_at
    }
    vaults {
        uuid id PK
        uuid user_id FK
        text name
        text encryption
        timestamptz created_at
    }
    notes {
        uuid id PK
        uuid vault_id FK
        text path
        text title
        text content
        text checksum
        timestamptz created_at
        timestamptz updated_at
    }
    note_versions {
        uuid id PK
        uuid note_id FK
        text content
        text checksum
        uuid device_id FK
        timestamptz created_at
    }
    devices {
        uuid id PK
        uuid user_id FK
        text name
        text platform
        timestamptz last_seen
    }
    attachments {
        uuid id PK
        uuid vault_id FK
        uuid note_id FK
        text filename
        text mime_type
        int size_bytes
        text storage_path
        timestamptz created_at
    }

    users ||--o{ vaults : owns
    vaults ||--o{ notes : contains
    notes ||--o{ note_versions : tracks
    notes ||--o{ attachments : has
    users ||--o{ devices : registers
```
