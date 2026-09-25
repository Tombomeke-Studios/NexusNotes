# Contributing to NexusNotes

Thanks for helping out. This page summarises the workflow. The full, binding
rules live in [CLAUDE.md](CLAUDE.md), and they apply to humans and AI agents
alike. If this page and CLAUDE.md ever disagree, CLAUDE.md wins.

**Security issues:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Language

Everything is written in English: code, comments, identifiers, log output,
UI text, documentation, commit messages, and PR titles and descriptions.

## Issues and tasks

- Every task is a GitHub issue. [TODO.md](TODO.md) is the working checklist and
  tracks progress, and each open item carries its issue number, e.g. `(#12)`.
- Found a bug? Open an issue labelled `type:bug` first, then fix it or leave it
  in the backlog.
- Issues use exactly one `type:*` label: `bug`, `feature`, `refactor`, `test`,
  `docs` or `ci`.

## Branches

```
feature/<topic>  →  dev  →  staging  →  main
```

- Work on a `feature/<topic>` branch with one logical topic per branch.
  Fix and docs branches (`fix/<topic>`, `docs/<topic>`) follow the same flow.
- Pull requests target **`dev`** (the default branch). Never open a PR against
  `staging` or `main`. Those only receive `dev → staging` and `staging → main`
  promotions once a milestone is complete.
- `dev` must stay green. If CI on `dev` is red, fix that before opening new PRs.

## Working loop

For every small, shippable unit of work (one function, feature, fix or refactor):

1. Read the relevant code and docs first. The codebase map is in
   [CLAUDE.md, section 7](CLAUDE.md#7-codebase-map--where-is-what).
2. Write the tests first (TDD). For a bug fix, first write a test that reproduces the bug, where feasible.
3. Implement, matching the surrounding style and reusing existing patterns.
4. Run the tests and linters (see below).
5. Update the docs the change affects. [CLAUDE.md, section 5](CLAUDE.md#5-documentation-rules--which-doc-owns-what)
   says which document owns what.
6. Commit the code, its tests and its docs together, then push.

## Commits

- Format: `type(scope): imperative summary`. Explain *why* in the body when
  it is not obvious.
  - Types: `feat` `fix` `docs` `chore` `refactor` `test` `ci`
  - Scopes: `sync` `search` `github` `desktop` `mobile` `clipper` `shared` `db` `infra` `docs`
  - Example: `feat(sync): add note CRUD endpoints`
- One logical change per commit. If the summary needs "and", split the commit.
- Never mix a refactor with a behaviour change, or a dependency bump with code changes.
- Tests must pass and lint must be clean before every commit.

## Tests and lint

Run from the repo root:

| What | Command |
|---|---|
| Go tests | `cd services/sync-service && go test ./...` |
| Go lint | `cd services/sync-service && golangci-lint run` |
| Desktop unit tests (Vitest) | `cd desktop && npm test` |
| Desktop lint | `cd desktop && npm run lint` |
| Desktop type check and build | `cd desktop && npm run build` |
| Desktop end-to-end tests (Playwright) | `cd desktop && npm run test:e2e` (needs the backend running) |

- New backend logic (handlers, validators, sync logic) needs unit tests in
  `*_test.go` files next to the source.
- Desktop tests are colocated `*.test.ts(x)` files.
- The CI workflow ([.github/workflows/validate.yml](.github/workflows/validate.yml))
  runs these checks on every pull request.

For setting up a local stack (dev container, `./scripts/dev-web.sh`,
`./scripts/dev-app.sh`), see the [README](README.md#local-development).

## Pull requests

- Keep PRs small and focused on one topic.
- In the description, list each issue the PR completes as its own
  `Closes #N` line. Never put several on one line: GitHub only links the first.
- A PR is done when CI passes. Red PRs are not merged.

## Documentation

- Docs must never contain database code: no SQL, migration snippets, index
  definitions or column-by-column schema listings. Describe what is stored,
  and why, in prose. The migrations directory is the schema's source of truth.
- API changes go in [docs/api.md](docs/api.md), security-relevant changes in
  [docs/security.md](docs/security.md), and deployment changes in
  [docs/deployment.md](docs/deployment.md).
