# Changelog

All notable changes per release. NexusNotes follows [semantic versioning](https://semver.org);
before 1.0.0 a minor bump may change the API. See [docs/deployment.md](docs/deployment.md#versioning).

## [Unreleased]

### Added
- Release versioning: a single `VERSION` file, `scripts/set-version.sh`, and the backend
  reporting its version in `GET /health`.
- The desktop app warns when its version and the server's major.minor differ.
- Settings shows the app version and the server version (was a hard-coded "0.1.0").
- A persistent banner (and a waiting screen on start-up) when the server cannot be reached.

- The packaged app starts its backend on a background supervisor: it waits for Docker
  Desktop, retries until Postgres/Redis are healthy, reuses a backend that is already
  running, and restarts the bundled one if it exits.

### Fixed
- The app no longer signs you out when the server is merely unreachable at start-up; your
  session is kept and restored as soon as the server answers.

## [0.5.0] - baseline

First versioned release. Covers the work to date: markdown editor with live preview, vaults
and notes sync over WebSocket, search, tags and backlinks, graph view, end-to-end encrypted
vaults with recovery codes, vault sharing, linked files, attachments, templates and export.
