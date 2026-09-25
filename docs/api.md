# API Reference — NexusNotes

Base URL: `http://localhost:8080`

## Request size limits

JSON request bodies are capped: 64 KiB on the authentication endpoints and 8 MiB on
all other JSON endpoints (note content included). Reading stops at the cap and a larger body
is rejected with `413 Request Entity Too Large` and `{"error":"request body too large"}`. Attachment uploads have their own 25 MiB limit.

## Authentication

### POST /api/auth/register

Create a new account.

```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "display_name": "Jane Doe",
  "device_id": "uuid"
}
```

`device_id` is the client's stable device id; the first refresh token is bound
to it (see `POST /api/auth/refresh`).

Response (201):
```json
{
  "user": { "id": "...", "email": "...", "display_name": "...", "email_verified": false, "created_at": "...", "updated_at": "..." },
  "token": "eyJ...",
  "refresh_token": "..."
}
```

`user` is a [`User`](#user); `token` is a 1-hour access JWT. Errors: `400` when
email or password is missing or the password is shorter than 8 characters,
`409` when the email is already taken.

### POST /api/auth/login

```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "device_id": "uuid"
}
```

Response (200): same shape as register. Errors: `400` when email or password is
missing, `401` for wrong credentials, `429` while the email+IP pair is locked
out after repeated failures (see [security.md](security.md#brute-force-protection)).

Register, login, refresh, verify-email, forgot-password and reset-password are
rate limited per client IP; over the limit they answer `429` with a
`Retry-After` header.

### POST /api/auth/verify-email

Confirms an email address from a verification-link token: `{token}` → `204`. Tokens are single-use and expire in 24 hours; a missing, invalid or expired token is a `400`. A verification email is sent on registration when SMTP is configured.

### POST /api/auth/forgot-password

Requests a password-reset email: `{email}` → always `204`, whether or not the address is registered (no account enumeration). Only a missing `email` is a `400`.

### POST /api/auth/reset-password

Sets a new password from a reset-link token: `{token, password}` → `204`. Tokens are single-use, expire in 1 hour, and a successful reset revokes all of the user's existing sessions. `400` for an invalid or expired token or a password shorter than 8 characters.

### POST /api/auth/refresh

Rotates a refresh token: `{refresh_token, device_id}` → `{token, refresh_token}`. Refresh tokens are single-use and bound to the device that logged in; replaying an already-rotated token revokes the device's whole chain (theft signal). Access tokens live 1 hour; login/register responses include the first `refresh_token`. `400` when `refresh_token` is missing, `401` when it is invalid, expired or already used.

Errors: `401` when the token is rejected (unknown, expired, reused, other device) — the client signs out; `503` when the refresh could not be performed (e.g. the database is unavailable) — the client keeps its session and retries later.

### POST /api/auth/logout

Invalidates the presented refresh token (`{refresh_token}`); the token itself is the credential. Always `204`.

### GET /api/auth/me

Requires `Authorization: Bearer <token>`. Returns the authenticated user as a
`User` (see [Models](#user)); the desktop app calls it on startup to restore
the signed-in session. `404` when the account behind the token no longer exists.

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

## Devices

Both endpoints require `Authorization: Bearer <token>` and only ever see the
caller's own devices.

### GET /api/devices

Returns the caller's registered sync devices (`Device[]`: id, name, platform, last_seen, created_at), most recently seen first. Devices register themselves on WebSocket connect via the `device_id`, `device_name` and `platform` query parameters; inactive devices are cleaned up daily after 90 days.

### DELETE /api/devices/:deviceId

Revokes a device: forgets it and force-closes its live WebSocket connections after a best-effort `device:revoked` message, which the client honours by signing out. `404` for a device the caller does not own. Note: the JWT itself remains valid until expiry — full per-device token invalidation arrives with refresh-token rotation (#49).

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

---

## Starred Notes

Stars are per user: starring a note in a shared vault does not star it for the
other members.

### GET /api/notes/starred

Returns the ids (`string[]`) of every note the authenticated user has starred, across vaults, oldest star first.

### POST /api/notes/:noteId/star

Stars a note (favourite). Idempotent; `204` on success. The caller must own the note's vault.

### DELETE /api/notes/:noteId/star

Removes the star. Idempotent; `204` on success.

---

## Vault Sharing

### GET /api/vaults/:id/members

Lists the vault's members (`VaultMember[]`). Any member or the owner may view.

### POST /api/vaults/:id/members

Invites a registered user by email as `viewer` or `editor`: `{email, role}` → `204`. Owner only. Membership is auto-accepted, so the vault appears for the invitee immediately.

### PATCH /api/vaults/:id/members/:userId

Changes a member's role: `{role}` → `204`. Owner only.

### DELETE /api/vaults/:id/members/:userId

Removes a member (owner) or leaves the vault (a member removing themselves) → `204`.

Shared vaults also appear in `GET /api/vaults`, each stamped with the caller's `role` (`owner`/`editor`/`viewer`). Note create/update/delete broadcast over WebSocket to the owner and all members.

## Attachments

Attachments are stored in S3-compatible object storage (MinIO); endpoints return `503` when it isn't configured.

### POST /api/notes/:noteId/attachments

Multipart upload (field `file`, max 25 MiB; anything larger is cut off with `413`) → the created `Attachment`. Write access required.

The client-declared `Content-Type` is not trusted. The stored `mime_type` is always one of this allowlist:

| Stored type | When |
|---|---|
| `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp` | The file's bytes are that image format, whatever was declared |
| `application/pdf`, `application/zip` | The file's bytes are that format, whatever was declared |
| `text/plain`, `text/markdown`, `text/csv` | Declared by the client (plain text has no magic bytes to check) |
| `application/octet-stream` | Everything else |

So an image, PDF or ZIP claim the bytes do not back up, and every other type (SVG, HTML, XML and every `+xml` type, JavaScript, AVIF, JSON, ...), is stored as `application/octet-stream`. Parameters such as `charset` are dropped.

### GET /api/notes/:noteId/attachments

Lists a note's attachments (`Attachment[]`). Read access required. Each `mime_type` is the type the file is served as (see below), so an attachment stored before the allowlist with a type outside it is reported as `application/octet-stream`.

### GET /api/attachments/:id

Streams the file bytes (read access). Authenticated, so inline images are loaded by the client as a blob URL rather than a bare `<img src>`.

The `Content-Type` is the stored type if it is on the allowlist above and `application/octet-stream` otherwise, which also covers attachments stored before the allowlist existed (for example an SVG). Every response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Only the five raster image types are sent `Content-Disposition: inline`; everything else is sent as `attachment`.

### DELETE /api/attachments/:id

Removes the attachment (metadata + object). Write access required.

## Linked Files

Linked files reference an external file *by reference* — NexusNotes never copies
or modifies the original. A link records a display name, a `source_type` (`url`,
`local_path`, or `github_path`) and a `source_ref`. URL sources are fetched fresh
on open through a server-side proxy (avoids browser CORS); `local_path`/`github_path`
are read by the native desktop app. Each user keeps their own annotations, stored
separately from the source so re-syncing never overwrites them (#64).

### GET /api/vaults/:id/links

Lists a vault's linked files (`LinkedFile[]`). Read access required.

### POST /api/vaults/:id/links

Registers a link from `{ display_name?, source_type, source_ref }` → the created
`LinkedFile`. An unknown `source_type` or empty `source_ref` returns `400`. Write access required.

### DELETE /api/vaults/:id/links/:linkId

Removes a link (and its annotations). Write access required.

### GET /api/links/:linkId/content

Fetches the current content of a `url` link `{ content, content_type, fetched_at }`
(capped at 5 MiB). Returns `422` for non-URL links, `502` when the source can't be
reached. Read access required.

### GET /api/links/:linkId/annotation

Returns the caller's annotation `{ content }` (empty string when none). Read access required.

### PUT /api/links/:linkId/annotation

Upserts the caller's annotation from `{ content }` → `204`. Read access required
(each member keeps their own notes).

## Search

Both search endpoints require `Authorization: Bearer <token>` and read access
to the vault. Notes in e2ee vaults are ciphertext to the server, so the desktop
app searches those vaults client-side instead (see [encryption.md](encryption.md)).

### GET /api/search

Full-text search across notes in a vault, served by Meilisearch (typo-tolerant,
ranked, with highlighted snippets). This is the endpoint the desktop app uses.

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

When Meilisearch is not configured, unreachable or returns an error, the
endpoint does **not** fail: it falls back to the database search behind
`GET /api/vaults/:vaultId/search` (using `q`, or `tag` as a plain search term
when `q` is empty). Fallback results are capped at 50, ordered by `updated_at`
descending, carry an unhighlighted snippet, and ignore `date_from`, `date_to`,
`limit` and `offset`.

Errors: `400` when `vault` is missing, `404` when the vault does not exist or
the caller cannot read it.

### GET /api/vaults/:vaultId/search?q=

Database-backed search across all notes in a vault, independent of Meilisearch.
Case-insensitive substring match on note title, content, inline `#tags`,
YAML front-matter tags, and front-matter aliases. Requires `?q=<query>`
(`400` without it); `403` without read access to the vault.

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

Browsers cannot set an `Authorization` header on a WebSocket handshake, so the
client first exchanges its access token for a short-lived ticket and connects
with that. The access token never appears in a URL, and so never in proxy or
access logs.

### POST /api/ws/ticket

Requires `Authorization: Bearer <token>`. Issues a single-use ticket bound to
the caller:

Response (200):
```json
{ "ticket": "k3J...", "expires_in": 30 }
```

The ticket is valid for `expires_in` seconds and is consumed by the first
connect attempt that presents it, whether or not that attempt succeeds; fetch a
fresh ticket for every (re)connect. A user holds at most 5 unredeemed tickets;
requesting another evicts that user's oldest one. `401` without a valid access
token; `503` with a `Retry-After` header when the server-wide cap on
outstanding tickets is reached.

### GET /ws

Connect: `ws://localhost:8080/ws?ticket=<ticket>&device_id=<uuid>&device_name=<name>&platform=<platform>`

- `ticket` is required. The legacy `?token=<jwt>` parameter is no longer
  accepted.
- `device_id`, `device_name` and `platform` register or refresh the device
  (see `GET /api/devices`).

| Status | Meaning |
|---|---|
| `101` | Upgraded |
| `401` | Missing, unknown, expired or already-used ticket |
| `403` | The `Origin` header is neither the server's own origin nor on the allowlist shared with CORS (`CORS_ALLOWED_ORIGINS`; defaults `http://localhost:1420`, `http://localhost:5173`, `tauri://localhost`, `http://tauri.localhost`). Checked before the ticket, so a rejected origin does not consume it |

Clients that send no `Origin` header (non-browser clients) are authenticated by
the ticket alone.

### Server → Client Messages

```json
{ "type": "note:created", "payload": { ...Note } }
{ "type": "note:updated", "payload": { ...Note } }
{ "type": "note:deleted", "payload": { "note_id": "..." } }
```

---

## Health

### GET /health

Response (200): `{"status":"ok","version":"0.5.0"}`

`version` is the NexusNotes release the server was built from (`dev` for a plain
local `go build`). Clients compare it with their own version and warn when the
major.minor differs (see [Versioning](deployment.md#versioning)).

---

## Admin

### GET /api/admin/stats

Operator-only: returns instance-wide totals (`users`, `vaults`, `notes`), `uptime_seconds` and `started_at`. Authenticates with a static `ADMIN_TOKEN` bearer configured via environment — separate from user JWTs. Unauthorized or unconfigured requests get a `404`, indistinguishable from a missing route.

---

## Models

### User
| Field | Type | Description |
|---|---|---|
| id | string | UUID |
| email | string | Sign-in address |
| display_name | string | Name shown in the UI |
| email_verified | boolean | Whether the address has been confirmed |
| created_at | string | ISO 8601 |
| updated_at | string | ISO 8601 |

The password hash is never serialised.

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
