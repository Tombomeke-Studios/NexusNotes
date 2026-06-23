# Security — NexusNotes

## Authentication

- Passwords hashed with **bcrypt** (default cost)
- JWT tokens with HS256 signing, 24-hour expiry
- Token passed via `Authorization: Bearer <token>` header
- WebSocket auth via query parameter `?token=<jwt>`

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
| No refresh token rotation | Medium | Add in Phase 2 |
| No rate limiting on auth endpoints | Medium | Add before production |
| WebSocket token in URL query string | Low | Acceptable for self-hosted; add ticket-based auth later |
| No HTTPS in dev Docker stack | Low | Add Nginx with TLS for production compose |
| Passwords: no complexity beyond length | Low | Consider zxcvbn integration |
| No account lockout after failed attempts | Medium | Add brute-force protection |

## Secrets Management

- `JWT_SECRET` must be set via environment variable
- Never committed to version control
- `.env` files are gitignored
- `.env.example` contains placeholder values only
