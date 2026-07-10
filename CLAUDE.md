# NexusNotes — CLAUDE.md

Markdown-first note-taking platform: Go backend services + Tauri/React desktop + Docker self-hosted stack.
This file is **context + rules only** — all tasks and progress live in [TODO.md](TODO.md).

---

## 1. Language policy

**Everything is written in English** so the project is uniform end to end:

- UI copy, labels, toasts, error messages
- Code comments, identifiers, log output
- Documentation (`docs/`, README, this file), commit messages, PR titles/bodies, test names

## 2. Branch strategy — three tiers

```
feature/<topic>  →  dev  →  staging  →  main
```

| Branch | Purpose | Who merges into it |
|---|---|---|
| `feature/<topic>` | Active development — one logical topic per branch | You, via PR |
| `dev` | Integration — always CI-green, shared ground truth | PRs from feature branches |
| `staging` | Production preparation — smoke tests, env hardening | PR from `dev` once a milestone is complete |
| `main` | Production — only ever updated from `staging` | PR from `staging` after sign-off |

**Rules:**
- A feature branch **never** targets `main` or `staging` directly.
- `staging` only receives merges from `dev` — never individual feature branches.
- `main` only receives merges from `staging` — never from `dev` or feature branches.
- **`main` and `staging` are permanent branches — never delete them.**
- A red CI on `dev` is everyone's problem — fix it before opening new PRs.
- The GitHub **default branch is `dev`**: new PRs target it by default.

## 2a. GitHub issues — every task is a trackable issue

Tasks live in two places that must stay in sync:

- **TODO.md** — the working checklist, grouped per branch (single source of truth for *progress*)
- **GitHub issues** — the trackable mirror of every open TODO item (single source of truth for *linking*: PRs, commits, discussion)

**Trigger table — when X happens, the agent does Y, immediately and unprompted:**

| Moment | Action |
|---|---|
| You add an actionable item to TODO.md | Create its GitHub issue and put the `(#N)` ref on the TODO line |
| You promote a backlog group to `feature/<topic>` | Verify every item in it has an issue; create any missing ones first |
| You discover a bug while working | Issue immediately (`type:bug`), then decide: fix now or backlog |
| You open a PR | One `Closes #N` line **per completed issue, each on its own line** in the PR body |
| The PR merges | Verify the issues auto-closed; move the group to Done in TODO.md |

**Rules:**

1. **Every actionable TODO item gets a GitHub issue** — at the latest when its backlog
   group is promoted to an active `feature/<topic>` group; bugs get one immediately.
   Create with `gh issue create --title "..." --body "..." --label type:<y>`.
2. **Title** = the TODO line, imperative. **Body** = context, acceptance criteria, affected files.
3. **Labels:** one `type:*` label (bug/feature/refactor/test/docs/ci).
4. **TODO.md items carry their issue ref:** `- [ ] Fix X (#12)`.
5. **PR bodies close their issues:** each completed issue must appear as its own `Closes #N` line — never comma-separated on one line (`Closes #1, #2` only auto-links the first in GitHub's Development panel).
6. An issue is only ever closed by a merged PR — or manually with a comment.
7. Open issues are the **backlog**, not a failure signal.

## 2b. The iteration loop (follow for every unit of work)

A "unit" = one function, feature, fix, or refactor — the smallest shippable slice.

1. **Pick** the next unticked item from the active branch group in TODO.md.
2. **Read context** before touching code: the codebase map below + the matching doc.
3. **Write tests first** (TDD): write or outline tests for the expected behavior before implementing.
4. **Implement** the slice. Match surrounding style; reuse existing patterns.
5. **Run tests** and verify they pass.
6. **Document it**: update the affected doc(s); new files also update the codebase map in this file.
7. **Tick TODO.md** for the item (add follow-up items you discovered to the backlog).
8. **Commit** — one small commit containing the code + tests + docs + TODO tick.
9. **Push** — `git push` after every commit.
10. Repeat 1–9 until the branch group is fully ticked.

**Branch finish protocol** (after the last item on a feature branch):
1. Run CI locally: `make test && make lint` — both must pass.
2. Push the final state and open a PR **targeting `dev`**.
3. **Wait for CI to pass on the PR** — a red PR is not done.
4. After merge: move the branch group in TODO.md to the Done section.

**Promoting `dev` → `staging` → `main`:**
1. Open a PR `dev → staging` only when a full milestone is complete. Wait for CI.
2. After merge to `staging`, verify CI passes on staging push.
3. Open a PR `staging → main` only after step 2 is signed off. Wait for CI.
4. After merge to `main`: tag the release (`git tag vX.Y.Z`) and push the tag.

## 3. Commit rules

- **One logical change per commit.** If the message needs "and", split it.
  Code + its tests + its docs + its TODO tick belong *together* in that commit.
- Never mix refactoring with behavior changes; never mix dependency bumps with code.
- Format: `type(scope): imperative summary` — body explains *why* when non-obvious.
  - **Types:** `feat` `fix` `docs` `chore` `refactor` `test` `ci`
  - **Scopes:** `sync` `search` `github` `desktop` `mobile` `clipper` `shared` `db` `infra` `docs`
  - Examples: `feat(sync): add note CRUD endpoints`, `ci(infra): add GitHub Actions workflow`.
- Before every commit: verify tests pass and linting is clean.

## 4. Testing rules

- **Go backend:** standard `go test ./...`, files named `*_test.go` next to source.
- **Desktop (React):** Vitest for unit tests, colocated `*.test.ts(x)` files.
- **New backend logic => unit tests required** (handlers, validators, sync logic).
- **Bug fixes:** when feasible, write the test that catches the bug first (TDD).
- **Integration tests:** Docker Compose test target for database-dependent tests.

## 5. Documentation rules — which doc owns what

| You changed... | Update |
|---|---|
| Services, endpoints, sync protocol, infra topology | [docs/architecture.md](docs/architecture.md) |
| Auth, sessions, secrets, security concerns | [docs/security.md](docs/security.md) |
| Docker, CI/CD, deployment | [docs/deployment.md](docs/deployment.md) |
| API endpoints, request/response formats | [docs/api.md](docs/api.md) |
| New/moved/renamed files, new commands, new gotchas | **This file** (map in section 7) |
| Setup / how-to-run instructions | README.md |
| Tasks, progress, follow-ups | [TODO.md](TODO.md) — and *only* there |

## 6. Commands

| What | Command (repo root) |
|---|---|
| Dev: full stack + web UI (browser) | `./scripts/dev-web.sh` |
| Dev: full stack + native app (Tauri) | `./scripts/dev-app.sh` |
| Start all services (Docker) | `docker compose up` |
| Start all services (dev) | `docker compose -f docker-compose.dev.yml up` |
| Run Go tests | `cd services/sync-service && go test ./...` |
| Run desktop dev | `cd desktop && npm run dev` |
| Run desktop tests | `cd desktop && npm test` |
| Lint Go | `cd services/sync-service && golangci-lint run` |
| Lint desktop | `cd desktop && npm run lint` |
| Build desktop | `cd desktop && npm run build` |
| DB migrations | `cd services/sync-service && go run cmd/migrate/main.go` |

## 7. Codebase map — where is what

### services/sync-service (Go)
| Path | Contents |
|---|---|
| `cmd/server/main.go` | Entry point: HTTP server, WebSocket upgrade, graceful shutdown |
| `cmd/migrate/main.go` | Database migration runner |
| `internal/config/` | Environment-based configuration |
| `internal/handler/` | HTTP handlers (notes, vaults, auth, sync) |
| `internal/model/` | Domain models (Note, Vault, Device, Version) |
| `internal/repository/` | PostgreSQL data access layer |
| `internal/service/` | Business logic (sync, conflict detection, versioning) |
| `internal/middleware/` | Auth, logging, CORS middleware |
| `internal/ws/` | WebSocket hub and client management |
| `migrations/` | SQL migration files |

### desktop (Tauri + React)
| Path | Contents |
|---|---|
| `src-tauri/` | Tauri backend (Rust config, commands) |
| `src/` | React frontend |
| `src/App.tsx` | Root component, workspace layout, keyboard shortcuts |
| `src/components/Auth.tsx` + `AuthBackground.tsx` | Login/signup screen; animated mouse-reactive node-graph background |
| `src/components/Workspace/` | Shell chrome: top bar (breadcrumb, window controls), activity rail, panel styles |
| `src/components/Workspace/WindowControls.tsx` | Native minimize/maximize/close controls (reused by top bar + login screen) |
| `src/components/Editor/` | Markdown editor with live preview |
| `src/components/Sidebar/` | Left panel: file tree, filters, tag chips, in-vault search |
| `src/components/RightPanel/` | Right panel: outline, backlinks, note info |
| `src/components/CommandPalette.tsx` | Unified palette: quick-open notes + `>` command mode |
| `src/lib/api.ts` | API client for sync service |
| `src/lib/sync.ts` | WebSocket sync client |
| `src/lib/prefs.ts` | Persisted workspace preferences (panels, view mode, font size) |
| `src/lib/stats.ts` | Word count, reading time, cursor position, relative time |
| `src/lib/platform.ts` | Runtime environment check (`isTauriWindow`) |
| `src/lib/folders.ts` | Per-vault empty-folder persistence (localStorage) for the file tree |
| `src/lib/recent.ts` | Per-vault recently-opened notes (localStorage) for the sidebar Recent section |
| `src/lib/welcome.ts` | Sample notes seeded into a new account's first vault (onboarding) |
| `src-tauri/capabilities/` | Tauri v2 permission capabilities (window controls) |

### Infrastructure
| Path | Contents |
|---|---|
| `scripts/dev-web.sh` / `scripts/dev-app.sh` | One-command dev startup (infra + backend + web/native UI); share `scripts/_stack.sh` |
| `docker-compose.yml` | Production stack (all services) |
| `docker-compose.dev.yml` | Development stack with hot reload |
| `.github/workflows/validate.yml` | CI pipeline: lint, test, build |
| `db/migrations/` | Shared SQL migrations |

## 8. Conventions & gotchas

- Go services follow standard project layout: `cmd/` for entry points, `internal/` for private packages.
- PostgreSQL is the primary data store; Redis for caching and WebSocket session state.
- MinIO provides S3-compatible attachment storage — accessed via standard AWS SDK.
- Checksums are SHA-256, computed server-side — never trust client-provided checksums.
- WebSocket connections are authenticated via JWT token in query parameter.
- All timestamps are UTC, stored as `TIMESTAMPTZ` in PostgreSQL.
- Note content is stored as raw markdown text in PostgreSQL, not as files on disk.
- Vault paths use forward slashes regardless of client OS.
