# API Reference — NexusNotes

Base URL: `http://localhost:8080`

## Authentication

### POST /api/auth/register

Create a new account.

```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "display_name": "Jane Doe"
}
```

Response (201):
```json
{
  "user": { "id": "...", "email": "...", "display_name": "..." },
  "token": "eyJ..."
}
```

### POST /api/auth/login

```json
{
  "email": "user@example.com",
  "password": "min8chars"
}
```

Response (200): same shape as register.

---

## Vaults

All vault endpoints require `Authorization: Bearer <token>`.

### GET /api/vaults

List all vaults for the authenticated user. Returns `Vault[]`.

### POST /api/vaults

```json
{ "name": "My Vault" }
```

Response (201): `Vault`

### GET /api/vaults/:id

Response (200): `Vault`

### PUT /api/vaults/:id

```json
{ "name": "Renamed Vault" }
```

### DELETE /api/vaults/:id

Response (204)

---

## Notes

### GET /api/vaults/:vaultId/notes

List all notes in a vault. Returns `Note[]`.

### POST /api/vaults/:vaultId/notes

```json
{
  "title": "My Note",
  "path": "folder/subfolder",
  "content": "# Hello\n\nWorld",
  "device_id": "uuid"
}
```

Response (201): `Note`

### GET /api/notes/:noteId

Response (200): `Note`

### PUT /api/notes/:noteId

```json
{
  "title": "Updated Title",
  "path": "folder/subfolder",
  "content": "# Updated\n\nContent",
  "prev_checksum": "sha256-of-previous-content",
  "device_id": "uuid"
}
```

Response (200): `Note` on success.
Response (409): `ConflictInfo` on checksum mismatch:
```json
{
  "note_id": "...",
  "server_content": "...",
  "server_checksum": "...",
  "client_content": "...",
  "client_checksum": "..."
}
```

### DELETE /api/vaults/:vaultId/notes/:noteId

Response (204)

### GET /api/notes/:noteId/versions

List version history. Returns `NoteVersion[]` (newest first).

---

## WebSocket

Connect: `ws://localhost:8080/ws?token=<jwt>&device_id=<uuid>`

### Server → Client Messages

```json
{ "type": "note:created", "payload": { ...Note } }
{ "type": "note:updated", "payload": { ...Note } }
{ "type": "note:deleted", "payload": { "note_id": "..." } }
```

---

## Health

### GET /health

Response (200): `{"status":"ok"}`

---

## Models

### Note
| Field | Type | Description |
|---|---|---|
| id | string | UUID |
| vault_id | string | Parent vault |
| path | string | Folder path (forward slashes) |
| title | string | Note title |
| content | string | Raw markdown |
| checksum | string | SHA-256 of content |
| created_at | string | ISO 8601 |
| updated_at | string | ISO 8601 |

### Vault
| Field | Type |
|---|---|
| id | string |
| user_id | string |
| name | string |
| created_at | string |
| updated_at | string |
