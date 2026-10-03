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
- The limiter (and the login throttle) key on the client IP. Behind a reverse
  proxy that is the proxy's address for every request, so set
  `TRUSTED_PROXIES` (CIDRs/IPs) to the proxies in front of the service: only
  when the direct peer is in that list is the client taken from
  `X-Forwarded-For` (the rightmost hop that is not a trusted proxy) or
  `X-Real-IP`. From any other peer those headers are ignored, so a client
  cannot pick its own bucket (#373). The production compose trusts the compose
  network's private ranges, as the web UI's nginx is the only way in.
- Stale buckets are swept at most once a minute rather than on every request.

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
| Email, display name (encrypted at rest) | PostgreSQL `users` | Account identity |
| Password (Argon2id hash) | PostgreSQL `users` | Authentication |
| Note content, titles, paths, tags | PostgreSQL `notes` + related tables | The product |
| Note content (search copy) | Meilisearch `notes` index (encrypted disk, not backed up, rebuilt from the database) | Full-text search |
| Device names, last-seen | PostgreSQL `devices` | Sync/session management |
| Client IPs | Server logs + in-memory rate limiter | Abuse prevention, transient |

Redis holds only transient session/cache state; MinIO holds attachments once
that feature ships.

### Consent

Sign-up requires ticking agreement to the Terms of Service and Privacy Policy;
the server refuses a registration without it and stores the time and the
policy version (`CurrentTermsVersion`) with the user (#289). NexusNotes sets no
cookies and uses browser storage only for what it needs to work, so no consent
is needed for it; a one-time notice explains that and offers preferences per
category (Necessary always on; Analytics and Marketing off). Nothing optional
exists today; anything added later must check `hasConsent()` in
`desktop/src/lib/consent.ts`.

### Rights fulfilment

- **Erasure (Art. 17):** `DELETE /api/auth/account` (password re-confirmed)
  removes the user row; database cascades erase vaults, notes, versions,
  links, tags, devices and attachment records. Attachment files are removed
  from object storage, search-index entries are deleted by vault filter and
  live WebSocket sessions are closed. Deleting a single vault or note also
  removes its attachment files. File removal is best effort: it needs object
  storage to have been reachable when the server started, and a storage error
  is logged rather than retried. Files left behind that way (or by deletions
  from before this existed) are removed by a sweep at start-up and then daily:
  every stored file without an attachment row that is older than an hour is
  deleted, and nothing is deleted when the database cannot be asked (#316). Available self-service in the
  desktop Settings → Account tab.
- **Portability (Art. 20):** `GET /api/auth/export` streams all vaults as
  markdown in a zip plus `account.json`, also self-service in Settings.
- **Notes for self-hosters:** the instance operator is the data controller;
  publish a privacy notice covering the inventory above and log retention.
  E2EE vaults remove even operator access to content (see below).

## End-to-End Encrypted Vaults

New vaults use zero-knowledge E2EE by default; a user can turn it off at
creation time after a warning that the server could then read the vault, and
encrypt a standard vault later (#361; full design in
[encryption.md](encryption.md)):

- Note content is encrypted client-side with AES-256-GCM before upload; the
  server stores only `iv:ciphertext` plus opaque wrapped-key material and can
  never decrypt it. Note titles and folder paths are sealed the same way
  (#362); tags and aliases only exist inside the encrypted content.
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
  decrypted notes (the server index only carries the sealed title/path).
- Uploads fail closed: note content is only sent unencrypted for a vault the
  client knows to be unencrypted. A vault missing from the client's list
  (e.g. a save retry firing after sign-out cleared it) is refused rather
  than treated as a plain vault.

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

In end-to-end encrypted vaults the app encrypts attachment files on the device,
name and type included, before upload (#238; see
[encryption.md](encryption.md#attachments-238)); the server refuses a readable
file there. Attachment files are also encrypted at rest (#358): the sync service seals each file with
the data key before writing it to object storage, binding it to its object key, and
decrypts it on download, so the storage bucket only holds ciphertext. Files stored
before that are served as they are and sealed by a background pass on startup, which
also re-encrypts files after a key rotation; a file deleted or replaced while that
pass runs is left alone.

## Web UI Headers

The web UI's nginx (`desktop/nginx.conf`) sends the same Content Security Policy
as the desktop webview (#382), with `connect-src` limited to its own origin (the
`/api` and `/ws` proxies), plus `frame-ancestors 'none'` against clickjacking,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

## Vault Sharing and Authorization

Vaults can be shared with other users as viewer (read) or editor (read/write);
the owner keeps exclusive rights to rename, delete, re-key and manage members.
Every data endpoint authorizes through a single `AccessRole` check
(owner/editor/viewer/none) rather than ad-hoc ownership comparisons, which also
closed a pre-existing gap where note deletion performed no access check.
Endpoints addressed by a note, attachment or link id (including a note's
version history) first resolve the vault that owns the resource and check the
caller's role on *that* vault; routes that also name a vault in the path
additionally require the resource to belong to it. Missing resources answer
`404`, resources the caller cannot access answer `403`. E2EE
note: a shared e2ee vault's passphrase is out of band — the server never holds
the key, so collaborators must share the passphrase themselves.

## Linked-File URL Proxy

URL-linked files are fetched by the server on the user's behalf, so the proxy
must not become a way to reach the server's own network. Every outgoing
connection is checked after DNS resolution, at connect time, and refused
unless the address is publicly routable: loopback, private (RFC 1918 and
IPv6 unique-local), link-local (including cloud metadata endpoints),
unspecified, multicast, carrier-grade NAT, documentation/test networks and other
special-purpose ranges are blocked. IPv6 forms that embed an IPv4 address
(NAT64, 6to4, Teredo, IPv4-compatible and IPv4-translated) are blocked outright;
an IPv4-mapped address (`::ffff:a.b.c.d`) is judged by the IPv4 address it
carries, so it is reachable exactly when that address is (#337). Because the check sits in the dialer, it also applies to every
redirect hop and to hostnames that resolve differently between lookups.
Environment proxy settings are ignored for these fetches, redirects are capped
at 3, the whole fetch times out after 15 seconds, and sources larger than
5 MiB are refused. At most 2 fetches per user and 16 in total run at once;
more are refused with `429` rather than queued, so slow sources cannot tie up
the server's outbound connections. Self-hosters who want to link LAN resources can set
`LINKED_FILES_ALLOW_PRIVATE=true`, which lifts the address check only.

In an end-to-end encrypted vault the stored source is sealed (#364): the
client sends the URL in the body of `POST /api/links/{id}/content`, the same
checks apply, and the URL is neither stored nor logged (request logs carry the
path only).

## Secrets Management

- `JWT_SECRET` must be set via environment variable and be at least 32 characters;
  the service refuses to start otherwise. A short HMAC secret can be guessed offline
  from any token it signed. Generate one with `openssl rand -hex 32`.
- Access tokens are only accepted when signed with HS256, the algorithm the service
  signs with; tokens that name any other algorithm (another HMAC variant included)
  are rejected.
- `ADMIN_TOKEN` (optional) enables `/api/admin/*`. It must also be at least 32
  characters and is only accepted as `Authorization: Bearer <token>`, compared in
  constant time. Unset, the admin endpoints answer 404.
- `DATA_ENCRYPTION_KEY` (required) encrypts user data at rest; see
  [Encryption at Rest](#encryption-at-rest).
- `/metrics` has no authentication, so it is only served on a separate
  `METRICS_ADDR` listener, never on the API port (#327).
- The sync service container runs as an unprivileged user.
- Never committed to version control
- `.env` files are gitignored
- `.env.production.example` contains placeholders only; `.env.example` carries a
  shared development-only `DATA_ENCRYPTION_KEY`, which must never be used in production

## Encryption at Rest

User data the server stores is encrypted field by field before it reaches the
database (#352), so a stolen database dump or backup does not expose it. This
is independent of end-to-end encryption: content of an e2ee vault is already
ciphertext and is wrapped once more.

- **Algorithm.** AES-256-GCM with a random 96-bit nonce per value. The field
  name is authenticated as additional data, so a value copied into another
  column fails to decrypt. Encryption, the blind-index MAC and the public key id
  each use their own subkey, derived from the data key with HKDF-SHA256.
- **Key.** `DATA_ENCRYPTION_KEY`: 32 random bytes as 64 hex characters
  (`openssl rand -hex 32`). The service refuses to start without a valid one.
  Keep it out of the database and its backups, and back it up on its own:
  **data encrypted under a lost key cannot be recovered**, by anyone.
- **Rotation.** Move the current key to `DATA_ENCRYPTION_OLD_KEYS` (comma
  separated) and set a new `DATA_ENCRYPTION_KEY`. Every stored value names the
  key it was written under, so old values keep decrypting while new writes use
  the new key, and the startup backfill re-encrypts the rest. Once it has run
  (the log says `encryption backfill done`, and a later start rewrites
  nothing), the old key can be removed.
- **Lookups.** A field that must be searched for equality (an email address
  at login) is found through a blind index: an HMAC-SHA256 of the normalised
  value, which reveals nothing about it beyond equality with another indexed
  value.
- **Legacy rows and backfill (#357).** Values written before encryption at
  rest are read as they are until the startup backfill has encrypted them. On
  every start the service walks each encrypted column in the background, in
  batches, and rewrites any value not under the current key (plaintext, or a
  retired key), filling in the email blind index as it goes. A row changed
  while it runs is left to the writer, which encrypts it anyway; a value it
  cannot decrypt (a missing old key) is logged and left alone.
- **What it does not cover.** The server holds the key while it runs, so whoever
  controls the running server can read standard vaults; only end-to-end
  encrypted vaults keep content from the server itself.
- **Search index (#365).** Meilisearch keeps its own copy of standard-vault
  content (e2ee vaults: sealed titles and paths only) on its `meili_data` volume,
  outside the field-level encryption. That volume must sit on an encrypted
  disk and stay out of backups. It is derived data: when the service starts
  with an empty index it rebuilds it from the (encrypted) database, so a
  restore without it loses nothing.

The implementation is `internal/fieldcrypt`; repositories seal and open the
fields themselves (`internal/repository/crypt.go` names them), so handlers and
services only see plaintext. Encrypted so far:

- note content and every stored note version (#354);
- vault names, linked-file names, sources and annotations, user display names
  and device names (#355). Lists sorted by these names are sorted in the
  service after decryption;
- attachment files in object storage (#358, see [Attachments](#attachments));
- email addresses (#356). Sign-in, sign-up and invites find an account through
  the blind index of the address, lower-cased and trimmed (so addresses match
  regardless of case). Lookups try the index under every configured key, so
  accounts indexed before a key rotation still sign in.

Still readable in the database: note titles, folder
paths, tags and aliases, which the server queries; in e2ee vaults those move to
the client (#362).

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

**Webview lockdown (#329).** The webview runs under a strict Content Security
Policy (`app.security.csp` in `tauri.conf.json`): scripts only from the app
itself, no `eval`, no plugins, frames or form posts; network access only to the
app, the local sync service (`localhost:8080`, HTTP and WebSocket) and Tauri's
IPC. Images may also come from `blob:` (attachments, decrypted on the device),
`data:` and `https:` (remote images a note links to). Fonts are bundled, so no
third-party host is contacted. `devCsp` only adds the Vite dev server. The
webview holds no shell permission at all: only the Rust side starts the
bundled sync-service sidecar, so page script cannot spawn processes.

**Supervisor (#330, #336).** The app reuses a backend that already answers on
localhost:8080 (a dev script, a previous run) without polling Docker. It also
checks whether that backend accepts connections on this machine's network
address; if so it is not the app's own loopback-only server, and the UI shows
a warning banner instead of trusting it silently. A sidecar the app started
itself is restarted after failing three health checks in a row (after a
one-minute start-up grace), and it is stopped on every way the app exits,
including a shutdown that began while it was starting.

**Per-install data encryption key (#353).** The key that encrypts user data at
rest is created the same way, in a `data-encryption-key` file next to the JWT
secret. Unlike the JWT secret it is never replaced and never swapped for a
per-run value: if the file is malformed or cannot be written, the backend does
not start, because data written under a key that is not kept could never be
read again.

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
