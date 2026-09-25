# Security — NexusNotes

## Authentication

- Passwords hashed with **Argon2id** (OWASP parameters: 19 MiB memory, t=2, p=1),
  stored as PHC strings so parameters can be raised without breaking old records
- Legacy **bcrypt** hashes still verify and are transparently rehashed to
  Argon2id on the next successful login
- Login performs a dummy Argon2id verification when the email is unknown, so
  response timing does not reveal whether an account exists
- JWT access tokens with HS256 signing, 1-hour expiry, renewed through rotating
  refresh tokens (see [Sessions and Token Rotation](#sessions-and-token-rotation))
- Token passed via `Authorization: Bearer <token>` header
- WebSocket auth via a short-lived, single-use ticket — the access token never
  appears in a URL (see [WebSocket Authentication](#websocket-authentication))

### Brute-force protection

- After 5 consecutive failed logins for an email **from the same IP**, that
  email+IP pair is locked with a progressive delay: 1 minute, doubling per
  further failure, capped at 15 minutes. Scoping the lock to the pair means an
  attacker cannot lock the real owner out of their account (griefing)
- Distributed guessing (15+ failures for one email across many IPs) escalates
  to a constant 1-second tarpit delay on every attempt for that email instead
  of a hard lock, so the owner can still sign in
- Locked logins return `429` regardless of whether the account exists, and the
  submitted email is throttled either way — no user-enumeration signal
- A successful login clears both the email+IP lock and the cross-IP counter
- State is in-memory (`internal/service/throttle.go`), matching the
  single-instance self-hosted deployment model

### Rate limiting

- `POST /api/auth/register`, `login`, `refresh`, `verify-email`,
  `forgot-password` and `reset-password` are rate limited per connecting
  address with an in-memory token bucket (`internal/middleware/ratelimit.go`)
- Defaults: 10 requests/minute with a burst of 10; configurable via
  `AUTH_RATE_LIMIT_PER_MIN` and `AUTH_RATE_LIMIT_BURST`
- Exceeding the limit returns `429` with a `Retry-After` header (seconds)
- The limiter keys on `RemoteAddr`; when deploying behind a reverse proxy,
  ensure the proxy passes the real client IP as the connection source (or
  terminate rate limiting at the proxy instead)

### Request body limits

Every JSON endpoint reads its body through `http.MaxBytesReader`: 64 KiB for the
authentication endpoints, 8 MiB elsewhere (`internal/handler/response.go`). Reading stops at the
cap and an oversized body is answered with `413`, so an authenticated (or, on
the auth endpoints, anonymous) client cannot exhaust memory or fill the database with a
single request. Attachment uploads are capped separately at 25 MiB.

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
  E2EE vaults remove even operator access to content (see below).

## End-to-End Encrypted Vaults

Vaults can opt in to zero-knowledge E2EE at creation time (full design in
[encryption.md](encryption.md)):

- Note content is encrypted client-side with AES-256-GCM before upload; the
  server stores only `iv:ciphertext` plus opaque wrapped-key material and can
  never decrypt it.
- The Master Key is derived from the vault passphrase with Argon2id and never
  leaves the client; the unlocked Vault Key lives in memory only and is
  dropped on lock, sign-out and 401 auto-logout.
- Conflict detection uses a client-computed SHA-256 of the plaintext, stored
  verbatim; the server never sees content.
- A one-time recovery code (single-use, rotated on every rewrap) is the only
  passphrase-loss escape hatch — losing both makes the vault unreadable by
  design.
- Plaintext never touches disk on the client: e2ee vaults skip the
  localStorage draft mirror, and search runs client-side over in-memory
  decrypted notes (the server index only carries title/path).

## Device Management

Each sync client registers itself (stable random device id, human-readable
name, platform) when its WebSocket connects; Settings lists the account's
devices with last-seen times. Revoking a device deletes its registration and
force-closes its connections; the client signs itself out on the
`device:revoked` message and its refresh-token chain is deleted, so it
cannot mint new access tokens — the current one dies within the hour.
Devices unseen for 90 days are removed by a daily cleanup job.

## Sessions and Token Rotation

Access tokens are 1-hour JWTs. Long-lived sessions come from opaque refresh
tokens: stored server-side as SHA-256 hashes, bound to the issuing device,
valid 30 days, and **single-use** — every refresh rotates the token. Replay
of an already-rotated token is treated as theft and revokes the device's
entire chain. Sign-out invalidates the presented refresh token server-side;
expired tokens are pruned daily.

## WebSocket Authentication

Browsers cannot attach an `Authorization` header to a WebSocket handshake, so
whatever authenticates it has to travel in the URL, where reverse proxies and
access logs can record it. The client therefore never puts its access token
there: before every (re)connect it exchanges the token for a ticket at the
authenticated `POST /api/ws/ticket` endpoint and dials `/ws?ticket=...`.

- Tickets are 256-bit random values, bound to the requesting user, valid for
  30 seconds and **single-use**: the first connect attempt consumes the ticket
  whether or not it succeeds, so a ticket that ends up in a log is worthless.
  The legacy `?token=<jwt>` parameter is rejected.
- Tickets are held in memory only (single-instance deployment model); expired
  tickets are swept on every issue, so ticket requests cannot grow memory
  without bound. Each user holds at most 5 live tickets: a sixth request
  evicts that user's oldest one, so a single account can never fill the store
  and lock other users out of sync, while a client that abandoned earlier
  fetches is never refused. A global cap on outstanding tickets remains as a
  backstop (`503` once reached).
- The handshake's `Origin` must be the server's own origin or one on the same
  allowlist the CORS middleware uses (`CORS_ALLOWED_ORIGINS`, see
  deployment.md; wildcards are refused at startup); anything else gets `403`
  before the ticket is even looked at. This blocks cross-site WebSocket hijacking by a
  malicious page. Non-browser clients that send no `Origin` are authenticated
  by the ticket alone.
- The device registration a connect triggers runs in the background with a
  5-second timeout, so a stalled database cannot pile up goroutines.

## Email Verification and Password Reset

Verification and reset tokens are opaque, stored only as SHA-256 hashes,
single-use, and short-lived (verification 24 h, reset 1 h). "Forgot password"
always responds identically whether or not the address exists, so it can't
enumerate accounts; a completed reset revokes every existing session. When
SMTP is configured, a verified email is required before an account can create
a vault; with SMTP unset, mail is logged and the requirement is not enforced,
so mail-less self-hosts keep working.

## Attachments

Attachments are user-supplied files that other vault members can open, so they are
treated as hostile content. Their content type comes from an allowlist of passive
formats rather than from the client's claim: PNG, JPEG, GIF, WebP and BMP images and
PDF and ZIP files are recognised from their own bytes, `text/plain`, `text/markdown`
and `text/csv` are kept when declared, and everything else is stored as
`application/octet-stream`. That includes SVG, HTML, XML and every `+xml` type,
JavaScript, and any image format not listed; an allowlist is used because the set of
types a browser will run script in is open-ended. The request body is capped at
25 MiB plus multipart framing.

On download the same allowlist is applied again, so attachments stored before it
existed (for example an SVG) are served as `application/octet-stream`. Every response
sends `nosniff` and a `Content-Security-Policy` that blocks all sources and sandboxes
the response; only the five raster image types are served inline and everything else
is an attachment. Combined with the fact that downloads need an `Authorization`
header, an uploaded HTML or SVG file cannot execute script with the API's origin,
which closes the stored-XSS path between members of a shared vault.

The desktop client does not rely on the server for this. It loads attachment bytes
into a blob URL, and a blob URL belongs to the app's own origin, where the session
tokens live; opened in a tab, an SVG or HTML blob would run its script there. The
client therefore rebuilds every attachment blob with its own type: the five raster
image types are kept and everything else becomes `application/octet-stream`, which a
browser only ever downloads. The preview likewise only renders raster images inline;
any other embedded attachment (an `![[drawing.svg]]`, say) is shown as a download link.

## Vault Sharing and Authorization

Vaults can be shared with other users as viewer (read) or editor (read/write);
the owner keeps exclusive rights to rename, delete, re-key and manage members.
Every data endpoint authorizes through a single `AccessRole` check
(owner/editor/viewer/none) rather than ad-hoc ownership comparisons, which also
closed a pre-existing gap where note deletion performed no access check. E2EE
note: a shared e2ee vault's passphrase is out of band — the server never holds
the key, so collaborators must share the passphrase themselves.

## Secrets Management

- `JWT_SECRET` must be set via environment variable
- Never committed to version control
- `.env` files are gitignored
- `.env.example` contains placeholder values only

## Packaged Desktop App

The installed app runs its own backend: the bundled sync service, talking to
Postgres and Redis from the bundled development compose file.

**Per-install JWT secret (#260).** On first run the app draws 32 bytes from the
operating system's CSPRNG, hex-encodes them and stores them in a `jwt-secret`
file in its local app data directory (on Windows
`%LOCALAPPDATA%\com.tombomeke-studios.nexusnotes\`). Every later start reuses
that file; an empty, truncated or otherwise malformed file is replaced. On macOS
and Linux the file is created readable by its owner only (mode 0600); on Windows
it inherits the ACL of the per-user profile, which admits only the user, SYSTEM
and administrators. The local (not roaming) directory keeps the secret on this
machine. If the file cannot be written, the app uses a secret for that run only;
it never falls back to a fixed value. Earlier versions signed every
installation's tokens with the shared constant `dev-secret`, so anyone who could
reach a backend could forge a token for any user on it.

To rotate the secret, quit the app, delete the file and start the app again.
Access tokens signed with the old secret are then rejected, but refresh tokens
are opaque values stored hashed in the database and do not depend on the JWT
secret, so the client renews its session silently on the next request. A
re-login is only needed when the refresh token itself has expired (30 days
unused) or is missing.

**Localhost only.** The bundled backend is started with `BIND_ADDR` set to the
loopback addresses (`127.0.0.1` and `::1`, or only `127.0.0.1` when IPv6 is
disabled), so it no longer listens on the network interfaces. The compose file
publishes Postgres, Redis, MinIO and Meilisearch on `127.0.0.1` only. Before
#260 all of them, and the backend, were reachable from the local network.

**Residual risk: fixed database credentials.** Postgres still uses the fixed
development password and Redis has no password at all. Both are now reachable
from the local machine only, but any process on that machine, under any user
account, can connect with the well-known credentials and read or change every
note. The password was left unchanged on purpose: the Postgres container and
its volume are shared with the dev scripts, and the password is fixed when the
volume is first initialised, so changing it without an in-place migration
would lock existing installations out of their data. A per-install database
password with a safe migration is tracked in #277.
