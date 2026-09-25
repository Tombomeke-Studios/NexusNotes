# Changelog

All notable changes per release. NexusNotes follows [semantic versioning](https://semver.org);
before 1.0.0 a minor bump may change the API. See [docs/deployment.md](docs/deployment.md#versioning).

## [Unreleased]

### Added
- Release versioning: a single `VERSION` file, `scripts/set-version.sh`, and the backend
  reporting its version in `GET /health`.

## [0.5.0] - baseline

First versioned release. Covers the work to date: markdown editor with live preview, vaults
and notes sync over WebSocket, search, tags and backlinks, graph view, end-to-end encrypted
vaults with recovery codes, vault sharing, linked files, attachments, templates and export.
