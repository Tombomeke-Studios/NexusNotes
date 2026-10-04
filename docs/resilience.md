# Resilience — chaos experiments

What happens to a user who is typing when a part of the stack fails. Each
experiment was run against the dev stack (`./scripts/dev-web.sh`) with a
Playwright script that signs up, opens a note in a standard vault, types, breaks
one component, keeps typing and records the save status and the connection
banner every 100 ms. Re-run them after changes to saving, syncing or the
connection banner (#333).

## Summary

| Experiment | What the user sees | Data lost | Recovery |
|---|---|---|---|
| A. Postgres drops every connection mid-typing | Nothing, or a brief "Unsaved" | None | About 1 s: the pool reconnects and the next save succeeds |
| B. Backend process killed for 20 s | "Unsaved · Offline, retrying" at once, the connection banner within about 1 s | None | Saved within 1 s of the backend answering `/health` again |
| C. Redis unreachable | Nothing | None | Not applicable — the sync service does not use Redis yet |

## A. Postgres connections terminated

Every backend connection was terminated with `pg_terminate_backend` while a
save was in flight. pgx drops the broken connections and opens new ones on the
next query, so at most one save fails; it is retried as a network error and goes
through on the next attempt. The note on the server ends with exactly the
typed text.

## B. Backend crash (the sidecar case)

The backend process was killed and restarted 20 s later. This is what a crash of
the packaged app's sidecar looks like to the UI, except that the packaged app's
watchdog restarts the sidecar itself after three failed health checks.

- The first failed save sets the status to "Unsaved · Offline, retrying". The
  text stays in the editor and in the local draft mirror, so closing the app
  does not lose it either.
- The failed save also asks the health poll to check right away. Before this
  the poll ran every 30 s while healthy, so a short outage could pass without
  the banner ever appearing.
- While the server is down the poll runs every 4 s. The first healthy answer
  announces that the server is back, and waiting saves are retried immediately
  instead of after their exponential backoff. Measured: saved 0.6 s after the
  backend became healthy; before this change it took 8–11 s.
- The WebSocket reconnect triggers the same immediate retry, as does the
  browser's `online` event.

## C. Redis loss

Redis was made unreachable for the whole run. The sync service reads
`REDIS_URL` into its configuration but never connects to Redis, so there is no
effect. Once Redis carries WebSocket session state (CLAUDE.md, conventions),
this experiment must be repeated.
