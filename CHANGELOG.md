# Changelog

All notable changes per release. NexusNotes follows [semantic versioning](https://semver.org);
before 1.0.0 a minor bump may change the API. See [docs/deployment.md](docs/deployment.md#versioning).

## [Unreleased]

### Added
- Files can be attached in end-to-end encrypted vaults: they are encrypted on your device,
  name and type included, before they are uploaded.
- Existing vaults can be end-to-end encrypted afterwards (Settings → Sync → Encrypt this
  vault). Every note is encrypted on your device and the server keeps no readable copy or
  history; other devices ask for the new passphrase.
- The search index is rebuilt from the database when the server starts with an empty
  one, so it can stay out of backups (keep its volume on an encrypted disk).
- Release versioning: a single `VERSION` file, `scripts/set-version.sh`, and the backend
  reporting its version in `GET /health`.
- The desktop app warns when its version and the server's major.minor differ.
- Settings shows the app version and the server version (was a hard-coded "0.1.0").
- A persistent banner (and a waiting screen on start-up) when the server cannot be reached.
- Motion throughout the desktop app: the command palette drops in on a spring, dialogs
  scale in and out, menus and popovers grow from where they open, the sign-in card
  cascades in, buttons lift and press, tag pills bounce, toggles spring, starred notes pop,
  the vault lock wobbles, and the file tree slides its hover, glides the active-note marker
  and folds folders. A Motion setting (System / Reduced / Full) follows Windows by default.
- Conflict resolution: when a note was changed on another device while you were editing
  it, a notice above the editor opens both versions side by side. Keep yours, take the
  other device's, or merge them by hand.

### Changed
- Keyboard users stay inside open dialogs (Tab cycles within them) and return to where they
  were when a dialog closes; a "Skip to editor" link is the first Tab stop.
- Each note keeps its 50 most recent versions; older ones are removed on the next save.
- New vaults are end-to-end encrypted by default. Turning it off shows a short warning
  that the server could then read the vault, with a plain explanation on request.
- Muted text and the keyboard focus ring meet WCAG AA contrast; text selection and
  scrollbars use the accent colour.

- The packaged app starts its backend on a background supervisor: it waits for Docker
  Desktop, retries until Postgres/Redis are healthy, reuses a backend that is already
  running, and restarts the bundled one if it exits.

### Fixed
- The web UI of the Docker stack talks to its own server again instead of to
  `localhost:8080` on the visitor's computer, so signing in works when it is not opened
  on the server itself.
- Search no longer silently misses a note when Meilisearch hiccups: index updates are
  queued, retried, and finished before the server shuts down.
- The command palette keeps the highlighted note when the list re-sorts while it is open,
  so Enter opens the note you picked.
- After a dropped connection (server restart, network blip) the app now catches up on
  changes made elsewhere in the meantime instead of silently missing them.
- A database hiccup is no longer reported as "note not found" (which could make the app
  drop the note from view); the server now says it failed instead.
- Downloads (attachments, account and vault exports) are no longer cancelled in the macOS
  and Linux app.
- Having the app open in two windows no longer signs you out when both renew the session
  at the same moment.
- Attachment files left in storage after their note, vault or account was deleted are now
  removed by a daily sweep.
- The desktop app restarts its built-in server when it stops responding, and warns when the
  server it finds on port 8080 is reachable from other computers on the network.
- Clicking the search bar at the top no longer slides it to the right.
- Typing three or more dashes in the editor no longer makes them invisible.
- Closing a note's tab while the graph is open clears its highlight in the graph.
- Long tag names are cut off instead of pushing their count out of the sidebar, and a
  long tag list scrolls instead of squeezing the file tree.
- In the dev container, the web UI reloads again when files are edited from a Windows host.
- Large exports and attachment transfers on slow connections are no longer cut off after
  15 seconds, and a server restart now tells connected apps it is going away instead of
  dropping them.
- Stars carried over from older versions are no longer lost when the server is
  unreachable during the upgrade, and stars no longer leak into the next session after
  signing out.
- The preview no longer crashes on a paragraph with a huge number of tags, links or embeds.
- Attachments now work in the packaged app and with the dev scripts: MinIO is started with
  the databases, the backend waits for it and receives its settings, and uploaded files live
  in a Docker volume instead of the container filesystem. Files uploaded to the dev MinIO
  before this change lived in the container and are not carried over. MinIO is optional:
  if it cannot start, everything else still works.
- Attachments are refused in end-to-end encrypted vaults (server and app) until attachment
  files are encrypted on the client; previously they were stored unencrypted.
- The app no longer signs you out when the server is merely unreachable at start-up; your
  session is kept and restored as soon as the server answers.
- A note that is open and saved now shows changes made to it on another device. Before,
  the editor kept the old text and your next edit was saved over those changes.

### Security
- The desktop app runs under a strict Content Security Policy.
- The editor font is bundled with the app instead of loaded from Google Fonts, so opening
  NexusNotes no longer sends your IP address to Google.
- The web UI sends a strict Content Security Policy and anti-clickjacking headers.
- The server requires a `DATA_ENCRYPTION_KEY` (64 hex characters) for encrypting user
  data at rest; it no longer starts without one. Dev scripts generate it into `.env`,
  the packaged app creates one per install. Back it up: data encrypted under a lost key
  cannot be recovered.
- Note content and its version history are stored encrypted in the database, as are
  vault names, linked files and their annotations, display names, device names and email
  addresses. Attachment files are encrypted before they reach object storage. Signing
  in no longer depends on the case of the email address. Existing data and files are
  encrypted automatically in the background after the upgrade.
- Loading linked files is limited to 2 at a time per user (16 overall), and the server
  also refuses documentation-range and IPv4-translated addresses for them.
- `/metrics` is no longer served on the API port; set `METRICS_ADDR` (the monitoring
  overlay does) to serve it on a separate internal listener. The server image runs as
  an unprivileged user and has a Docker health check on the new `GET /ready`.
- Behind the bundled web proxy, sign-in rate limits now apply per user instead of to
  everyone at once (`TRUSTED_PROXIES`); spoofed forwarding headers are ignored.
- The packaged app's backend no longer signs sessions with the shared `dev-secret`: each
  installation generates its own random JWT secret on first run and keeps it in the app's
  local data directory. After upgrading, the first request renews your session through
  its refresh token, so you normally stay signed in; you only have to sign in once more
  if you had not used the app for 30 days or more.
- The packaged app's backend and the development Postgres, Redis, MinIO and Meilisearch
  containers now listen on localhost only instead of every network interface. The next
  start recreates the Postgres and Redis containers with the new port bindings; your data
  volumes are kept.
- The production `docker-compose.yml` has no built-in passwords or secrets any more: it
  refuses to start until `JWT_SECRET`, `POSTGRES_PASSWORD`, `MEILI_MASTER_KEY` and
  `MINIO_ROOT_PASSWORD` are set (copy `.env.production.example`). Only the web UI is
  published; MinIO, Meilisearch and the monitoring UIs are no longer reachable from the
  network. Images are pinned and services have memory limits. Prometheus and Grafana
  moved to the optional `docker-compose.monitoring.yml`. **Upgrading:** an existing
  installation must set `POSTGRES_PASSWORD=nexus_pass` and
  `MINIO_ROOT_PASSWORD=nexus_minio_pass` (the old built-in values) to keep its data
  reachable; see docs/deployment.md for changing them afterwards. Run the first
  start after upgrading with `docker compose up -d --remove-orphans`, or the old
  Prometheus and Grafana containers keep running on their network-wide ports.
- The sync service refuses to start with a `JWT_SECRET` (or a set `ADMIN_TOKEN`) shorter
  than 32 characters, only accepts HS256-signed access tokens, and only accepts the admin
  token as `Authorization: Bearer <token>`. **Upgrading:** a self-hosted installation with
  a shorter secret must set a longer one (`openssl rand -hex 32`); users then sign in once
  more at most. The packaged app already uses a 64-character secret.
- The dev scripts no longer sign sessions with the fixed `dev-secret`: they generate a
  random secret on the first run and start the backend on localhost only. Dev sessions
  are renewed through their refresh token on the next request.

## [0.5.0] - 2026-09-26

First versioned release. Covers the work to date: markdown editor with live preview, vaults
and notes sync over WebSocket, search, tags and backlinks, graph view, end-to-end encrypted
vaults with recovery codes, vault sharing, linked files, attachments, templates and export.

[Unreleased]: https://github.com/Tombomeke-Studios/NexusNotes/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Tombomeke-Studios/NexusNotes/releases/tag/v0.5.0
