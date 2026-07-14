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

### POST /api/auth/verify-email

Confirms an email address from a verification-link token: `{token}` → `204`. Tokens are single-use and expire in 24 hours. A verification email is sent on registration when SMTP is configured.

### POST /api/auth/forgot-password

Requests a password-reset email: `{email}` → always `204`, whether or not the address is registered (no account enumeration).

### POST /api/auth/reset-password

Sets a new password from a reset-link token: `{token, password}` → `204`. Tokens are single-use, expire in 1 hour, and a successful reset revokes all of the user's existing sessions.

### POST /api/auth/refresh

Rotates a refresh token: `{refresh_token, device_id}` → `{token, refresh_token}`. Refresh tokens are single-use and bound to the device that logged in; replaying an already-rotated token revokes the device's whole chain (theft signal). Access tokens live 1 hour; login/register responses include the first `refresh_token`.

### POST /api/auth/logout

Invalidates the presented refresh token (`{refresh_token}`); the token itself is the credential. Always `204`.

### GET /api/auth/export

Requires `Authorization: Bearer <token>`. Streams a zip containing all data
belonging to the user (GDPR data portability): each vault as a folder of
`.md` files (Obsidian-compatible) plus `account.json` with account metadata.

### DELETE /api/auth/account

Requires `Authorization: Bearer <token>`. Permanently erases the account and
all owned data (GDPR right to erasure): vaults, notes, versions, links, tags
and devices via database cascade, plus search-index entries; all live
WebSocket sessions are closed. The password must be re-supplied.

```json
{
  "password": "current password"
}
```

Responses: `204` on success, `401` for a wrong password, `400` when the
password is missing.

---

## Vaults

All vault endpoints require `Authorization: Bearer <token>`.

### GET /api/vaults

List all vaults for the authenticated user. Returns `Vault[]`.

### POST /api/vaults

```json
{ "name": "My Vault" }
```

For an end-to-end encrypted vault (see docs/encryption.md), the client also
sends the mode plus its opaque key-material blob:

```json
{ "name": "Private", "encryption": "e2ee", "encryption_meta": { "version": 1, "kdf": {}, "wrapped_key": {}, "recovery_wrapped_key": {} } }
```

Response (201): `Vault`. `encryption` defaults to `"none"`;
`encryption_meta` is required when `encryption` is `"e2ee"` and is never
interpreted by the server.

### PUT /api/vaults/:id/encryption

E2ee vaults only: replaces the opaque `encryption_meta` blob (passphrase
change / recovery-key rotation re-wraps the Vault Key client-side). Body:
`{ "encryption_meta": { ... } }`. Returns `204`; `404` when the vault does
not exist, is not owned by the caller, or is not encrypted.

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

For notes in an e2ee vault, `content` is the client-encrypted payload
(`base64(iv):base64(ciphertext)`) and the request additionally carries
`"checksum"` — the client-computed SHA-256 of the plaintext, stored verbatim
for conflict detection. The same `checksum` field applies to
`PUT /api/notes/:noteId`. For standard vaults client checksums are ignored.

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

### GET /api/notes/:noteId/backlinks

Returns notes that contain a `[[wiki-link]]` pointing to this note. Returns `BacklinkNote[]`.

### GET /api/notes/starred

Returns the ids (`string[]`) of every note the authenticated user has starred, across vaults, oldest star first.

### POST /api/notes/:noteId/star

Stars a note (favourite). Idempotent; `204` on success. The caller must own the note's vault.

### DELETE /api/notes/:noteId/star

Removes the star. Idempotent; `204` on success.

### GET /api/devices

Returns the caller's registered sync devices (`Device[]`: id, name, platform, last_seen, created_at), most recently seen first. Devices register themselves on WebSocket connect via the `device_id`, `device_name` and `platform` query parameters; inactive devices are cleaned up daily after 90 days.

### DELETE /api/devices/:deviceId

Revokes a device: forgets it and force-closes its live WebSocket connections after a best-effort `device:revoked` message, which the client honours by signing out. `404` for a device the caller does not own. Note: the JWT itself remains valid until expiry — full per-device token invalidation arrives with refresh-token rotation (#49).

### GET /api/admin/stats

Operator-only: returns instance-wide totals (`users`, `vaults`, `notes`), `uptime_seconds` and `started_at`. Authenticates with a static `ADMIN_TOKEN` bearer configured via environment — separate from user JWTs. Unauthorized or unconfigured requests get a `404`, indistinguishable from a missing route.

---

## Search

### GET /api/vaults/:vaultId/search?q=

Full-text search across all notes in a vault. Searches note title, content, inline `#tags`,
YAML front-matter tags, and front-matter aliases. Requires `?q=<query>`.

Response (200): `NoteSearchResult[]` ordered by `updated_at` descending, up to 50 results.

```json
[
  {
    "id": "...",
    "vault_id": "...",
    "path": "folder/my-note.md",
    "title": "My Note",
    "snippet": "First 300 characters of the note content...",
    "tags": ["work", "project"],
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

---

## Tags

### GET /api/vaults/:vaultId/tags

Returns all tags used in the vault with their note counts, ordered by count descending.

Response (200): `TagCount[]`
```json
[{ "tag": "work", "count": 5 }, { "tag": "project", "count": 3 }]
```

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

## Search

All search endpoints require authentication (`Authorization: Bearer <token>`).

### GET /api/search

Full-text search across notes in a vault.

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `vault` | Yes | Vault ID to search in |
| `q` | No | Search query string |
| `tag` | No | Filter by tag (exact match) |
| `date_from` | No | ISO 8601 date — notes updated on or after |
| `date_to` | No | ISO 8601 date — notes updated on or before |
| `limit` | No | Max results (default 20, max 100) |
| `offset` | No | Pagination offset (default 0) |

**Response (200):**

```json
[
  {
    "id": "note-uuid",
    "vault_id": "vault-uuid",
    "title": "My Note",
    "path": "folder/my-note.md",
    "tags": ["work", "project"],
    "updated_at": "2024-06-01T12:00:00Z",
    "snippet": "...highlighted <em>match</em> in content..."
  }
]
```

Returns `503 Service Unavailable` if Meilisearch is unreachable.

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
