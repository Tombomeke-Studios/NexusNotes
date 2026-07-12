---
name: verify
description: Build, launch and drive NexusNotes (web UI + Go backend) to verify a change end-to-end in the running app.
---

# Verifying NexusNotes changes in the running app

## Launch the stack

- Full stack: `./scripts/dev-web.sh` (Docker Postgres+Redis, migrations, Go backend on :8080, Vite web UI on :1420). Run it in the background; it keeps running.
- The backend MUST be started with cwd `services/sync-service` — its startup auto-migration reads the cwd-relative `migrations` dir (#201; `_stack.sh` handles this since the fix).
- Manual backend (when the script's trap has killed it):
  `cd services/sync-service && DATABASE_URL="postgres://nexus:nexus_dev@localhost:5432/nexus_notes?sslmode=disable" REDIS_URL="redis://localhost:6379" JWT_SECRET="dev-secret" PORT=8080 ./tmp/sync-service.exe`
- Health probes: `curl http://localhost:8080/health` and `http://localhost:1420`.

## Drive the UI

- Use Playwright via the desktop package: put the script INSIDE `desktop/` (e.g. `desktop/.verify.tmp.mjs`, delete afterwards) and `import { chromium } from "@playwright/test"` — scripts outside `desktop/` can't resolve the package.
- Register a fresh throwaway user through the UI (`No account? Sign up`; placeholders: Display name / Email / Password). First vault uses the first-run card (`.firstrun-input` / placeholder "Vault name (e.g. Personal)"); it is seeded with welcome notes.
- Editor textarea: `.editor-textarea`; autosave debounce is 1s — wait ~2.5s before asserting server state.
- API checks: read the JWT from `localStorage.nexus_token`, hit `http://localhost:8080/api/...` with `Authorization: Bearer`.

## Gotchas

- E2EE vaults: a locked vault auto-opens the unlock dialog on load — don't click the "Unlock with passphrase" empty-state button behind the overlay. Use `getByRole("button", { name: "Unlock", exact: true })` (two Unlock buttons exist).
- e2e selectors used by CI live in `desktop/e2e/helpers.ts`; keep placeholder "Vault name..." + Enter-to-create working in the new-vault dialog.
