# Security Policy

NexusNotes stores people's private notes, so we take security reports seriously
and we are grateful for them.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests or discussions.**

Report them privately through GitHub Security Advisories instead:

1. Open the [Security tab](https://github.com/Tombomeke-Studios/NexusNotes/security)
   of `Tombomeke-Studios/NexusNotes`.
2. Click **Report a vulnerability**
   ([direct link](https://github.com/Tombomeke-Studios/NexusNotes/security/advisories/new)).
3. Fill in the form. Only the maintainers can see it.

A useful report includes:

- the affected component (sync service, desktop app, Docker Compose stack, E2EE vaults, ...)
- the version or commit you tested
- steps to reproduce, or a proof of concept
- the impact you expect: what an attacker gains, and what access they need first

Please test against an instance you run yourself, and never access or change
other people's data.

## What to expect

NexusNotes is maintained by a small team, so these are goals, not guarantees:

- We aim to acknowledge your report within **7 days**.
- We aim to give a first assessment (confirmed or not, and how severe) within **14 days**.
- We will keep you informed while we work on a fix, and agree on a disclosure
  date with you before anything is published.
- If you want, we will credit you in the published advisory.

## Supported versions

NexusNotes follows semantic versioning and is still pre-1.0 (see
[Versioning](docs/deployment.md#versioning)). While it is pre-1.0, a minor
release (`0.5` → `0.6`) may change the API or the sync protocol, so only the
latest minor gets security fixes:

| Version | Security fixes |
|---|---|
| Latest `0.x` minor release | Yes, as a patch release on that minor |
| Older `0.x` minor releases | No. Please upgrade to the latest minor |
| `dev` branch | Fixes land here first |

Self-hosters should run the latest release. Until the first tagged release,
fixes go to `dev` and ship with the next release.

## Security design

For how the project handles authentication, sessions, authorization and
end-to-end encrypted vaults, see [docs/security.md](docs/security.md) and
[docs/encryption.md](docs/encryption.md).
