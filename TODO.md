# NexusNotes — TODO

> Single source of truth for progress. Each item links to a GitHub issue.
> Groups map to feature branches. Done items move to the bottom.

---

## `feature/bugfixes-p1` — Phase 1 bug fixes

- [ ] Fix null JSON arrays in note list and versions endpoints (#18)
- [ ] Add vault ownership check on note Get and Update endpoints (#19)
- [ ] Add auto-migration on server startup (#20)
- [ ] Fix editor cursor reset on autosave (#21)
- [ ] Fix autosave stale closure race condition (#22)
- [ ] Add 401 auto-logout and WebSocket reconnect guard (#23)
- [ ] Fetch real user profile on token restore (#24)

## `feature/startup-docs` — Startup documentation

- [x] Update README with complete startup instructions (#25)

## Backlog

_Empty — new discoveries go here._

---

## Done

### `feature/project-setup` — Project scaffolding (PR #13)

- [x] Set up project scaffolding and CI/CD (#1)

### `feature/core-backend` — Sync Service (Go) (PR #14)

- [x] Create PostgreSQL schema and migrations (#2)
- [x] Implement Go sync service with note CRUD (#3)
- [x] Add authentication middleware with JWT (#4)
- [x] Implement WebSocket real-time sync (#5)
- [x] Add checksum-based conflict detection and version history (#6)

### `feature/desktop-app` — Desktop App (Tauri + React) (PR #15)

- [x] Set up Tauri + React desktop app scaffold (#7)
- [x] Build markdown editor with live preview (#8)
- [x] Build file tree sidebar and vault navigation (#9)
- [x] Connect desktop app to sync service API (#10)

### `feature/docker-stack` — Infrastructure (PR #16)

- [x] Set up Docker Compose stack (#11)

### `feature/docs` — Documentation (PR #17)

- [x] Write project documentation (#12)
