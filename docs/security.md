# Security — NexusNotes

## Authentication

- Passwords hashed with **Argon2id** (OWASP parameters: 19 MiB memory, t=2, p=1),
  stored as PHC strings so parameters can be raised without breaking old records
- Legacy **bcrypt** hashes still verify and are transparently rehashed to
  Argon2id on the next successful login
- Login performs a dummy Argon2id verification when the email is unknown, so
  response timing does not reveal whether an account exists
- JWT tokens with HS256 signing, 24-hour expiry
- Token passed via `Authorization: Bearer <token>` header
- WebSocket auth via query parameter `?token=<jwt>`

### Brute-force protection

- After 5 consecutive failed logins for an email, the account is locked with a
  progressive delay: 1 minute, doubling per further failure, capped at 15 minutes
- Locked logins return `429` regardless of whether the account exists, and the
  submitted email is throttled either way — no user-enumeration signal
- A successful login resets the failure counter
- State is in-memory (`internal/service/throttle.go`), matching the
  single-instance self-hosted deployment model

### Rate limiting

- `POST /api/auth/login` and `POST /api/auth/register` are rate limited per
  client IP with an in-memory token bucket (`internal/middleware/ratelimit.go`)
- Defaults: 10 requests/minute with a burst of 10; configurable via
  `AUTH_RATE_LIMIT_PER_MIN` and `AUTH_RATE_LIMIT_BURST`
- Exceeding the limit returns `429` with a `Retry-After` header (seconds)
- The limiter keys on `RemoteAddr`; when deploying behind a reverse proxy,
  ensure the proxy passes the real client IP as the connection source (or
  terminate rate limiting at the proxy instead)

## Authorization

- Users can only access their own vaults and notes
- Vault ownership checked on every note operation
- API returns 403 for cross-user access attempts

## Data Integrity

- Note checksums computed server-side using **SHA-256**
- Client-provided checksums are compared, never trusted
- All updates validate checksum before applying

## Known Gaps (Phase 1)

| Gap | Severity | Plan |
|---|---|---|
| No refresh token rotation | Medium | Add in Phase 2 |
| WebSocket token in URL query string | Low | Acceptable for self-hosted; add ticket-based auth later |
| No HTTPS in dev Docker stack | Low | Add Nginx with TLS for production compose |
| Passwords: no complexity beyond length | Low | Consider zxcvbn integration |

## GDPR

### Data inventory

| Personal data | Where | Why |
|---|---|---|
| Email, display name | PostgreSQL `users` | Account identity |
| Password (Argon2id hash) | PostgreSQL `users` | Authentication |
| Note content, titles, paths, tags | PostgreSQL `notes` + related tables | The product |
| Note content (search copy) | Meilisearch `notes` index | Full-text search |
| Device names, last-seen | PostgreSQL `devices` | Sync/session management |
| Client IPs | Server logs + in-memory rate limiter | Abuse prevention, transient |

Redis holds only transient session/cache state; MinIO holds attachments once
that feature ships.

### Rights fulfilment

- **Erasure (Art. 17):** `DELETE /api/auth/account` (password re-confirmed)
  removes the user row; database cascades erase vaults, notes, versions,
  links, tags and devices. Search-index entries are deleted by vault filter
  and live WebSocket sessions are closed. Available self-service in the
  desktop Settings → Account tab.
- **Portability (Art. 20):** `GET /api/auth/export` streams all vaults as
  markdown in a zip plus `account.json`, also self-service in Settings.
- **Notes for self-hosters:** the instance operator is the data controller;
  publish a privacy notice covering the inventory above and log retention.
  The planned E2EE vaults (see TODO) remove even operator access to content.

## Secrets Management

- `JWT_SECRET` must be set via environment variable
- Never committed to version control
- `.env` files are gitignored
- `.env.example` contains placeholder values only
