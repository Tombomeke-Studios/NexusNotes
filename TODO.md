# NexusNotes - TODO

Single source of truth for all planned work. Each item should link to a GitHub issue.
Feature groups map to Git branches. Completed items are moved to the Done section at the bottom.

Primary focus: desktop application (Tauri + React) and its backend (Go sync service).

---

## `feature/desktop-redesign` - Workspace redesign (NexusNotes Redesign.dc.html)

> Full desktop UI overhaul implementing the approved Claude Design mockup
> (`NexusNotes Redesign.dc.html`): darker shell, activity rail, tabbed editing,
> right-hand context panel, unified command palette, daily notes, and settings.

- [x] Add design tokens and global shell styles for desktop redesign (#93)
- [x] Redesign authentication screen (#94)
- [x] Build workspace shell: top bar, activity rail, resizable side panels (#95)
- [x] Rebuild left panel: file tree, tag chips, filter and sort popover, vault search (#96)
- [x] Add note tab bar with multiple open notes and graph tab (#97)
- [x] Redesign editor: mode switcher, draggable split view, restyled preview (#98)
- [x] Add right panel with Outline, Links, and Info tabs (#99)
- [x] Unify command palette and quick switcher with command mode (#100)
- [x] Add daily notes calendar popover and Ctrl+D shortcut (#101)
- [x] Add vault switcher menu and note context menu (#102)
- [x] Add settings modal with appearance, sync, and shortcuts tabs (#103)
- [x] Convert graph view to a workspace tab with redesigned styling (#104)

---

## Reported issues (triage) - not yet started

> Raised during use. Each has a GitHub issue; promote into a feature branch when picked up.

- [ ] WebSocket sync fails: handshake 500 'response does not implement http.Hijacker' (#122)

> Already tracked elsewhere: a "Getting Started" example vault on first run lives in
> `feature/onboarding`; inline images (`![[image.png]]`) and drag-drop image upload
> live in `feature/attachments` and `feature/editor-enhancements`.

---

## `feature/graph-view` - Graph view (2D and 3D interactive knowledge map)

> Notes are rendered as nodes, wiki-links as directed edges. The graph view is one of
> the most differentiating features of the application and must perform well at scale.
> Both a 2D force-directed layout and a 3D orbit view are in scope.

### Library and rendering strategy

- [ ] Install `react-force-graph` (wraps D3-force for 2D) and `react-force-graph-3d` (wraps Three.js/WebGL for 3D); both share the same API and allow mode toggling
- [ ] Use WebGL rendering for all graph modes; SVG is not acceptable above 500 nodes
- [ ] Wrap `graphData` in `useMemo` to prevent unnecessary simulation restarts on re-render
- [ ] Offload D3 force simulation to a Web Worker for graphs exceeding 1000 nodes to keep the UI thread responsive
- [ ] Pre-compute graph node and edge data server-side via `GET /vaults/:id/graph`; the client renders only, it does not compute

### 2D force-directed view

- [ ] Render each note as a circular node and each `[[link]]` as a directed edge
- [ ] Scale node size by connection count so hub notes are visually prominent
- [ ] Assign node colour by folder using a curated, distinct colour palette
- [ ] Support zoom via scroll wheel, pan via drag, and view reset via double-click
- [ ] Allow individual node dragging; pin nodes in place after manual repositioning
- [ ] On node click, open the corresponding note in the editor with a slide transition
- [ ] On node hover, display a floating tooltip showing title, tags, last updated, and link count
- [ ] On node hover, highlight connected nodes and edges; dim all others
- [ ] Render orphan nodes (no inbound or outbound links) in a visually distinct colour
- [ ] Add a search field inside the graph panel; on match, highlight the node and fly the camera to it

### 3D orbit view

- [ ] Provide a 2D/3D toggle button with an animated transition between modes
- [ ] Support orbit by drag, zoom by scroll, and an optional slow auto-rotate
- [ ] Render nodes as spheres with glow intensity proportional to connection count
- [ ] Render edges as curved tubes with a particle flow animation
- [ ] Apply a bloom post-processing effect using Three.js `UnrealBloomPass`
- [ ] Apply a depth-of-field effect so nodes distant from the focal point are softly blurred
- [ ] Render node labels as floating HTML overlays visible only above a zoom threshold

### Local graph view (per-note)

- [ ] Add a collapsible Local Graph panel in the editor sidebar
- [ ] Show the current note and all notes it links to or is linked from (1 hop by default)
- [ ] Add a depth slider (1 to 4 hops) to expand the local graph outward
- [ ] Update the local graph in real time as wiki-links are edited in the note
- [ ] Navigate to a note by clicking its node in the local graph

### Global graph - filters and controls

- [ ] Add a filter panel supporting multiselect by tag, filter by folder, and filter by date range
- [ ] Add a colour-mode toggle: colour by folder, by tag, or by last-modified date (heat map)
- [ ] Add a physics settings panel for link distance, repulsion strength, and collision radius
- [ ] Add a minimap showing the full graph extent and the current viewport position
- [ ] Add a toggle to show or hide orphan nodes
- [ ] Add cluster detection with a subtle convex hull overlay for tightly connected groups

### Performance

- [ ] Implement level-of-detail rendering: dots at low zoom, coloured circles at mid zoom, labels at high zoom
- [ ] Lazy-load node labels; render text only for nodes within the current viewport
- [ ] Benchmark target: render 5000 nodes at 60 fps on a mid-range machine
- [ ] Write snapshot tests for graph data computation including nodes, edges, and orphan detection

---

## `feature/animations-and-ux` - Animations, transitions, and micro-interactions

> The application must feel responsive and intentional. Every state change should be
> accompanied by a purposeful motion. Use Framer Motion for React-state-driven animations
> and vanilla CSS for simple hover and static effects. Animate only `transform` and
> `opacity` — never layout properties such as `width` or `height` directly.

### Setup

- [ ] Install `framer-motion` as the primary animation library
- [ ] Add `AnimatePresence` with `mode="popLayout"` at the router level for page transitions
- [ ] Add a `prefers-reduced-motion` media query check; disable all animations when the preference is set
- [ ] Create `src/lib/motion-tokens.ts` with shared spring configurations (`snappy`, `smooth`, `bounce`) used consistently across the codebase

### Page and view transitions

- [ ] Animate sidebar collapse and expand using a spring-physics width transition
- [ ] Animate note open with a right-to-left slide combined with an opacity fade-in
- [ ] Animate note switch with a crossfade between the outgoing and incoming note
- [ ] Animate graph panel open with a scale-up combined with a blur-to-clear effect
- [ ] Animate command palette open with a backdrop blur and a downward spring drop
- [ ] Animate the settings panel as a right-side sheet overlay
- [ ] Animate modal dialogs with a scale from 0.95 to 1.0 plus opacity on open, reversed on close
- [ ] Animate the authentication screen by staggering the logo and form elements on mount

### Sidebar and file tree

- [ ] Animate folder expand and collapse with smooth height transitions using Framer Motion `layout`
- [ ] Animate new notes appearing in the file tree with a slide-down fade-in
- [ ] Animate note deletion by sliding the item out and collapsing its height before DOM removal
- [ ] Implement a sliding background on sidebar item hover using a `::before` CSS pseudo-element
- [ ] Animate the active note indicator (left border) sliding to the new position on note switch
- [ ] Animate drag-and-drop reordering with Framer Motion `layout` so items shift smoothly

### Editor

- [ ] Animate the editor border with a subtle inner glow when the editor receives focus (CSS `box-shadow`)
- [ ] Animate the autosave indicator with a pulse followed by a fade-out
- [ ] Animate the word count in the status bar with a smooth tick on change
- [ ] Animate the markdown preview toggle with a crossfade between edit and preview
- [ ] Animate `[[link]]` hover previews with a fade-in and a slight upward drift
- [ ] Use `scroll-behavior: smooth` for heading anchor navigation
- [ ] Animate callout block borders sliding in on mount with a colour-coded glow

### Graph view animations

- [ ] Fade nodes in with a staggered delay on initial graph load; start the physics simulation from the centre
- [ ] Animate node hover with a spring scale from 1.0 to 1.2 and a connected-edge glow
- [ ] Fly the camera smoothly to a clicked node before opening the note
- [ ] Animate the 2D-to-3D toggle by scattering nodes into z-space
- [ ] Render edge particle flow using animated dashed lines or moving dot particles
- [ ] Apply a slow continuous pulse to orphan nodes to draw attention
- [ ] Fade in the cluster convex hull with a gentle boundary pulse

### Toasts and notifications

- [ ] Animate toast notifications sliding in from the bottom-right with auto-dismiss and a shrink exit
- [ ] Flash a brief colour highlight on the note title after a successful save
- [ ] Animate the sync status indicator in the status bar with a spinner during sync and a pop checkmark on completion
- [ ] Drop the conflict alert banner from the top of the screen with an amber background

### Loading and skeleton states

- [ ] Show animated shimmer placeholders in the sidebar while the vault is loading
- [ ] Show 3 to 4 lines of shimmer text in the note area before content loads
- [ ] Show pulsing placeholder circles in the graph panel before data arrives
- [ ] Implement skeleton shimmer using CSS `@keyframes` only; no additional library needed

### Micro-interactions

- [ ] Lift buttons by 1px on hover and deepen the shadow (CSS transition)
- [ ] Push buttons down by 1px on press
- [ ] Animate toggle switch thumbs with spring physics
- [ ] Draw in custom checkbox checkmarks on check with a path animation
- [ ] Lift tag pills on hover with a shadow; trigger a brief scale bounce on click
- [ ] Animate the star button fill with a pop effect
- [ ] Wobble the vault lock icon briefly on lock and unlock events
- [ ] Animate the encrypted vault icon with a key-turn effect when the passphrase is entered

### CSS design system additions

- [ ] Define CSS custom properties: `--transition-snappy`, `--transition-smooth`, `--easing-spring`
- [ ] Structure CSS using `@layer` with layers: `reset`, `tokens`, `base`, `components`, `utilities`, `animations`
- [ ] Style `::selection` to match the vault accent colour
- [ ] Style the scrollbar to be thin, rounded, and accent-coloured
- [ ] Implement dark/light mode by swapping CSS variables with a 200ms transition
- [ ] Write tests for animation token exports and reduced-motion conditional logic

---

## `feature/onboarding` - First-run experience and discoverability

> New users should understand the application immediately without external documentation.
> The first-run experience must guide a user to their first meaningful action within
> seconds of logging in.

- [ ] Auto-create a "Getting Started" welcome vault on first login; populate it with sample notes, example wiki-links, a working graph, and a daily note template
- [ ] Include `Welcome.md`, `My First Note.md` (with editor tips), and `Project Ideas.md` (linked to `Welcome.md`) in the welcome vault so the graph is populated from the start
- [ ] Add a first-launch checklist in the sidebar: create a note, link two notes, open the graph view, open the command palette; dismiss the checklist on completion
- [ ] Add contextual tooltips for the graph view, command palette, backlink panel, and tag filter; show each tooltip once and store the dismissed state in localStorage
- [ ] Include a pinned quick-start guide note in the welcome vault that can be read in under two minutes
- [ ] Add empty-state illustrations for: no notes in vault, no links in graph, no search results
- [ ] Add an "Import your existing notes" call-to-action on the welcome screen linking to the import wizard
- [ ] Add a keyboard shortcut reference panel accessible via the `?` key or the Help menu
- [ ] Write tests for welcome vault creation and checklist state persistence

---

## `feature/startup-performance` - Sub-second startup and runtime performance

> The application must start quickly and remain responsive as vaults grow. Tauri provides
> a significant advantage over Electron-based alternatives, but deliberate optimisation
> is required to maintain that advantage at scale.

- [ ] Benchmark startup time with 1k, 5k, and 10k notes; target is under 1 second to interactive
- [ ] Implement lazy sidebar loading: render the first 50 notes immediately and load the remainder on scroll
- [ ] Defer graph data fetch until the graph view is opened for the first time
- [ ] Defer backlink computation until a note is opened; do not precompute for all notes on startup
- [ ] Code-split heavy components (Graph, Canvas, PDF viewer) using `React.lazy` and `Suspense`
- [ ] Use `requestIdleCallback` for non-critical startup work such as search index warm-up and statistics calculation
- [ ] Profile and eliminate unnecessary React re-renders; all component props must be stable references
- [ ] Log time-to-first-note-list and time-to-interactive in development mode
- [ ] Target memory usage below 150 MB with 5000 notes loaded
- [ ] Add performance regression tests; CI must fail if the startup benchmark exceeds 2 seconds

---

## `feature/db-performance` - Database performance and indexing

> All queries must remain fast as vaults grow to tens of thousands of notes.
> The target for common read operations is under 10 ms.

### Indexing

- [ ] Add composite index `notes(vault_id, updated_at DESC)` for note listing sorted by recency
- [ ] Add composite index `notes(vault_id, path)` for path lookups and file tree rendering
- [ ] Add partial index `notes(vault_id) WHERE deleted_at IS NULL` to support the soft-delete pattern
- [ ] Add index `note_tags(tag, vault_id)` for tag filtering
- [ ] Add indexes on `note_links(source_note_id)` and `note_links(target_note_id)` for backlink queries
- [ ] Add GIN index on `notes(content)` using `to_tsvector` as a full-text fallback before Meilisearch is available
- [ ] Add index `note_versions(note_id, created_at DESC)` for version history listing
- [ ] Use `CREATE INDEX CONCURRENTLY` for all production index creation to avoid table locks
- [ ] Write `docs/indexes.md` documenting every index and its rationale

### Query patterns

- [ ] Remove all `SELECT *` statements; fetch only the columns required per endpoint
- [ ] List endpoints such as `GET /vaults/:id/notes` must never load `content`; return title, path, updated_at, and tags only
- [ ] Replace all `LIMIT/OFFSET` pagination with keyset (cursor) pagination using `WHERE updated_at < :cursor ORDER BY updated_at DESC LIMIT 50`
- [ ] Apply cursor-based pagination to: note list, version history, search results, and tag list
- [ ] Audit all N+1 query patterns and replace with JOINs or batch queries

### Connection and caching

- [ ] Configure `pgxpool` with appropriate values for `MaxConns`, `MinConns`, and `MaxConnLifetime`
- [ ] Add a Redis caching layer for vault metadata, the note list per vault, and tag counts
- [ ] Invalidate the Redis cache on WebSocket sync events (note create, update, delete)
- [ ] Add `Cache-Control` headers to all read endpoints

### Version history - storage management

- [ ] Store diffs in unified diff format in `note_versions` instead of full content snapshots
- [ ] Add a `version_retention_policy` column to the vaults table with `keep_count` (default 50) and `keep_days` (default 30)
- [ ] Add a daily background cleanup job to delete versions outside the retention policy
- [ ] Partition `note_versions` by `created_at` monthly using `pg_partman` once the row count exceeds 500k
- [ ] Add a `GET /vaults/:id/storage-stats` endpoint returning note count, total content size, and version count

### Tests

- [ ] Test keyset pagination correctness including ordering and cursor edge cases
- [ ] Test the version retention cleanup job
- [ ] Benchmark the note list endpoint; it must handle 10,000 notes per vault in under 50 ms

---

## `feature/vault-file-linking` - Link existing files and documentation into a vault

> Users can reference existing local files, URLs, and GitHub files from within a vault
> without copying or rewriting their content. The original files remain in place — the
> vault stores a reference only.

- [ ] Add `linked_files` table with columns: `id`, `vault_id`, `display_name`, `source_type` (`local_path`, `url`, `github_path`), `source_ref`, `read_only`, `created_at`
- [ ] Add `POST /vaults/:id/links` to register a linked file reference
- [ ] Add `GET /vaults/:id/links` to list linked files in a vault
- [ ] Add `DELETE /vaults/:id/links/:link_id` to remove a link
- [ ] Render linked files in the sidebar file tree with a distinct chain-link icon
- [ ] Open linked files in the editor as read-only with a "Linked - original not modified" notice
- [ ] Add a "Link existing file" dialog to the sidebar context menu accessible via `Ctrl+Shift+L`
- [ ] Support linking local filesystem paths using the Tauri `fs` API; read the file on open
- [ ] Support linking an entire local directory: scan recursively for `.md` files, display as a virtual folder in the sidebar, and update automatically when files are added or removed (#60)
- [ ] Watch linked local paths with Tauri `fs.watch`; refresh the sidebar entry and editor content when the file changes on disk without requiring a manual refresh (#61)
- [ ] Add a "last synced" timestamp and a manual "Sync now" button on each linked file entry in the sidebar (#62)
- [ ] Show a visual indicator (badge or colour) when the on-disk content has changed since the last read (#63)
- [ ] Support linking raw URLs; fetch on open, cache locally, and refresh on demand
- [ ] Support linking GitHub file paths using the existing GitHub connection when available
- [ ] Allow personal annotations to be added on top of a linked read-only file; store annotations separately from the linked content so syncing the source does not overwrite them (#64)
- [ ] Write unit tests for the linked_files repository and handler

---

## `feature/e2ee-encryption` - End-to-end encryption (zero-knowledge vaults)

> The server must never be able to read note content. All encryption and decryption
> happens on the client before data is transmitted. See `docs/encryption.md` for the
> full technical design.

- [ ] Write `docs/encryption.md` covering key derivation, the encryption algorithm, the sync protocol, and trade-offs
- [ ] Add a `vault_encryption` column to the vaults table (`none` or `e2ee`) with a migration
- [ ] Implement client-side key derivation: `Argon2id(password + salt)` produces a 256-bit Master Key
- [ ] Implement key wrapping: generate a random Vault Key and encrypt it with the Master Key; this allows passphrase changes without re-encrypting all notes
- [ ] Encrypt note content with `AES-256-GCM` before upload using a unique IV per save
- [ ] Store `encrypted_content`, `content_iv`, and `content_tag` in the database instead of plaintext for encrypted vaults
- [ ] Compute a plaintext `SHA-256` checksum client-side before encryption; the server uses this for conflict detection without reading content
- [ ] Add an encryption toggle when creating a vault with a passphrase prompt
- [ ] Add a passphrase unlock dialog when opening an encrypted vault; hold the derived key in memory only, never persist it
- [ ] Add a change-passphrase flow: re-wrap the Vault Key with the new Master Key without re-encrypting notes
- [ ] Display a lock icon on encrypted vaults in the sidebar
- [ ] Implement a client-side search index (MiniSearch or FlexSearch) for encrypted vaults; server-side search is not possible in zero-knowledge mode
- [ ] Write unit tests for key derivation, encryption, and decryption
- [ ] Write an integration test verifying that an encrypted note survives a full round-trip: encrypt, upload, download, decrypt

---

## `feature/mcp-server` - NexusNotes MCP server

> A first-class Model Context Protocol server that lets Claude, Codex, Cursor, and any
> MCP-compatible AI client read, search, create, and update notes — just like the
> Obsidian MCP, but built natively into NexusNotes. See `docs/mcp.md` for the full design.

### Core server (Go - new service `services/mcp-service/`)

- [ ] Write `docs/mcp.md` covering architecture, the tools list, the auth model, and the E2EE interaction model
- [ ] Scaffold `services/mcp-service/` as a standalone Go service supporting JSON-RPC 2.0 over stdio and Streamable HTTP (MCP spec 2025-11-25) using `modelcontextprotocol/go-sdk`
- [ ] Add `mcp-service` to `docker-compose.yml` and `docker-compose.dev.yml`
- [ ] Implement the MCP handshake: `initialize`, capability negotiation, `initialized`

### Authentication and security

- [ ] Add `mcp_tokens` table with columns: `id`, `user_id`, `token_hash`, `name`, `scopes`, `last_used_at`, `created_at`
- [ ] Add `POST /settings/mcp-tokens` to generate named API tokens scoped to read-only or read-write
- [ ] Add `DELETE /settings/mcp-tokens/:id` to revoke a token
- [ ] Add a token management page in the desktop settings
- [ ] Authenticate every MCP request via Bearer token in the Authorization header
- [ ] Add `mcp_audit_log` table with columns: `token_id`, `tool`, `args_summary`, `timestamp`; log every AI action
- [ ] Rate limit MCP endpoints to 60 tool calls per minute per token

### MCP tools

- [ ] `list_vaults` - list all vaults accessible to the token (name, id, encryption status)
- [ ] `list_notes` - list notes in a vault or folder returning title, path, updated_at, and tags; never returns content
- [ ] `read_note` - read the full content of a note by path or ID; encrypted vaults return metadata and the encrypted blob only
- [ ] `search_notes` - full-text search across a vault; delegates to Meilisearch for standard vaults
- [ ] `create_note` - create a new note with title, path, content, and optional tags
- [ ] `update_note` - update note content using append, prepend, or full replace mode
- [ ] `delete_note` - soft-delete a note; requires an explicit `confirm: true` parameter as a safety guard
- [ ] `get_backlinks` - return all notes that link to a given note via wiki-links
- [ ] `get_graph` - return graph nodes and edges for a vault
- [ ] `list_tags` - return all tags in a vault with note counts
- [ ] `get_daily_note` - get or create the daily note for today
- [ ] `append_to_note` - append a text block to an existing note; non-destructive write

### MCP resources

- [ ] Expose vault structure as MCP Resources using the URI scheme `nexusnotes://vault/:id/note/:path`
- [ ] Implement `resources/list` so AI clients can browse the vault file tree
- [ ] Implement `resources/read` so AI clients can read a note by URI

### MCP prompts

- [ ] Implement MCP Prompts (`prompts/list`, `prompts/get`): expose reusable prompt templates — `summarize_note`, `extract_tasks`, `daily_reflection` — that AI clients can invoke with vault context
- [ ] Each prompt accepts typed arguments (e.g., `vault_id`, `note_id`) and returns a rendered messages array ready to send to the LLM

### Desktop integration

- [ ] Add an "AI Access" section in settings showing active tokens and the audit log
- [ ] Add a "Copy MCP config" button that generates the JSON snippet for `claude_desktop_config.json`, Cursor settings, and similar clients
- [ ] Add an in-app indicator showing when a token was last used
- [ ] Write unit tests for all MCP tool handlers
- [ ] Write an integration test covering the full flow: connect via config, `list_vaults`, `read_note`

---

## `feature/tauri-native` - Tauri native desktop wrapper

- [ ] Add Tauri wrapper for native desktop app (#31)
- [ ] Implement system tray icon with a quick-capture shortcut opening a lightweight input window in under 500 ms
- [ ] Add native OS notifications for sync events and conflicts
- [ ] Add deep-link support via the `nexusnotes://` protocol handler
- [ ] Add an auto-update mechanism using the Tauri updater plugin

---

## `feature/editor-enhancements` - Editor quality of life

- [ ] Add Vim keybinding mode (toggle in settings)
- [ ] Add `Ctrl+F` in-note search and replace
- [ ] Add `Ctrl+,` settings panel with options for theme, font size, Vim mode, and sync interval
- [ ] Add `![[image.png]]` embed syntax rendering inline images from attachments
- [ ] Add `[[Note name#Section]]` section anchor navigation
- [ ] Add callout blocks (`> [!NOTE]`, `> [!WARNING]`, etc.)
- [ ] Add KaTeX math rendering for inline (`$...$`) and block (`$$...$$`) expressions
- [ ] Add footnote support using `[^1]` syntax
- [ ] Implement a table-of-contents panel generated from `##` headings
- [ ] Add a `[[` autocomplete popup with fuzzy search over existing notes while typing a wiki-link
- [ ] Add focus mode: hide the sidebar and status bar, centre content
- [ ] Add split-pane view to open two notes side by side
- [ ] Add word-wrap and line-length ruler settings
- [ ] Add sandboxed metadata query blocks (equivalent to `dataview`-style queries)
- [ ] Write tests for all markdown parser extensions

---

## `feature/daily-notes-and-templates` - Daily notes and note templates

- [ ] Add a daily note feature: `Ctrl+D` creates or opens a date-stamped note in `YYYY-MM-DD.md` format
- [ ] Add a configurable daily note template in settings
- [ ] Add a template picker; templates are defined as files in a `/templates` folder in the vault
- [ ] Add a `Ctrl+T` "Insert template" command in the command palette
- [ ] Support template variables: `{{date}}`, `{{time}}`, `{{title}}`
- [ ] Add periodic notes: weekly (`YYYY-Www`) and monthly (`YYYY-MM`) with separate templates
- [ ] Write tests for template variable substitution

---

## `feature/full-text-search` - Full-text search (Meilisearch)

- [x] Add Meilisearch to `docker-compose.yml` and `docker-compose.dev.yml` (#81)
- [x] Index note title, content, tags, and path asynchronously on create, update, and delete; do not block the save response (#82)
- [x] Skip content indexing for encrypted vaults; index title and path only (#86)
- [x] Implement `GET /search?q=&vault=&tag=&date_from=&date_to=` (#83)
- [x] Return ranked results with context snippets per hit (#83)
- [x] Connect the `Ctrl+Shift+F` global search UI to the search endpoint (#84)
- [x] Configure fuzzy matching and typo tolerance via Meilisearch settings (#85)
- [x] Add tag-based, folder-based, and date-range filters to the search UI (#84)
- [x] Index backlinks so that searching a note title surfaces its inbound references (#88)
- [x] Write integration tests for the search indexer and search handler (#89)

---

## `feature/canvas` - Canvas (infinite visual workspace)

> An infinite 2D board where notes, images, and free-form text cards can be placed and
> connected with arrows — analogous to Obsidian Canvas.

- [ ] Design the canvas data model: `canvases` table, `canvas_nodes`, `canvas_edges`
- [ ] Add CRUD endpoints for canvases, nodes, and edges
- [ ] Build the Canvas view component in React using `react-flow` or a native SVG/canvas approach
- [ ] Add an "Open as Canvas" entry in the sidebar context menu
- [ ] Support placing existing notes as linked cards on the canvas
- [ ] Support free-form text cards and image cards
- [ ] Support drawing directional arrows between cards
- [ ] Persist canvas layout to the backend on change
- [ ] Write tests for the canvas repository

---

## `feature/graph-view-enhancements` - Merged into `feature/graph-view`

All graph work is tracked in the `feature/graph-view` branch above.
This entry is retained so that existing issue references remain valid.

---

## `feature/conflict-resolution-ui` - Conflict resolution merge UI

- [ ] Design and build a split-pane diff/merge UI component
- [ ] Wire the `type: conflict` WebSocket event to open the merge modal
- [ ] Highlight conflicting hunks with colour coding (local vs. remote)
- [ ] Add "Accept Mine", "Accept Theirs", and manual edit options
- [ ] POST the resolved content back to the server on completion and close the modal
- [ ] Write tests for conflict detection logic in the sync service

---

## `feature/attachments` - Attachment upload and management

- [ ] Add `POST /notes/:id/attachments` for multipart upload to MinIO
- [ ] Add `GET /notes/:id/attachments` to list attachments
- [ ] Add `DELETE /attachments/:id` to remove an attachment
- [ ] For encrypted vaults, encrypt attachment bytes client-side before upload
- [ ] Build drag-and-drop file upload into the editor
- [ ] Render uploaded images inline using `![[filename]]` embed syntax
- [ ] Add an attachment panel in the editor sidebar
- [ ] Write tests for the attachment handler and MinIO storage layer

---

## `feature/version-history-ui` - Version history viewer

- [ ] Build a version history panel listing saved versions per note
- [ ] Render a diff between any two selected versions (side-by-side or inline)
- [ ] Add a "Restore this version" action
- [ ] Add a version retention policy setting (keep last N versions or keep for X days)
- [ ] Write tests for the version repository and restore handler

---

## `feature/offline-support` - Offline queue and deferred sync

- [ ] Implement a local IndexedDB queue for edits made while offline
- [ ] Detect WebSocket disconnect and enqueue saves locally
- [ ] Replay queued edits in order against the sync service on reconnect
- [ ] Show an offline indicator in the status bar
- [ ] Write tests for offline queue flush logic

---

## `feature/github-integration` - GitHub OAuth and repository import

- [ ] Add a GitHub OAuth flow (PKCE) with a backend callback and token exchange
- [ ] Store the encrypted `access_token` in a `github_connections` table
- [ ] Build a "Connect GitHub" settings page in the desktop app
- [ ] Add `POST /github/repos/import` to start a repository import job
- [ ] Create `repo_imports` and `repo_files` tables with migrations
- [ ] Implement the initial full import: fetch `.md` files and create read-only notes
- [ ] Implement a webhook receiver at `POST /github/webhook` for push events
- [ ] Implement a configurable periodic re-sync scheduler (default interval: 1 hour)
- [ ] Show import status (active, syncing, error, paused) in the sidebar
- [ ] Add a personal annotation layer on top of read-only imported files
- [ ] Write unit tests for OAuth token exchange, the import job, and the webhook handler

---

## `feature/starred-and-recent` - Starred notes and recent files

- [ ] Add `starred_notes` table with columns `user_id`, `note_id`, `starred_at`
- [ ] Add `GET /notes/starred` and `POST`/`DELETE /notes/:id/star` endpoints
- [ ] Show a starred notes section at the top of the sidebar
- [ ] Track recently opened notes in localStorage (last 10, no backend required)
- [ ] Add a collapsible "Recent files" section in the sidebar
- [ ] Write tests for the star repository

---

## `feature/note-export` - Note export (PDF, HTML, plain markdown)

- [ ] Add "Export as PDF" using the Tauri print/PDF API
- [ ] Add "Export as HTML" to render markdown to a standalone HTML file
- [ ] Add "Export as plain Markdown" to strip front-matter and write to a file or clipboard
- [ ] Add "Export vault" to zip all notes as `.md` files in an Obsidian-compatible format
- [ ] Write tests for export transformations

---

## `feature/ai-intelligence` - AI and semantic intelligence

> All AI features are opt-in. Users supply their own API key (OpenAI, Anthropic, Gemini)
> or run a local Ollama model. For encrypted vaults, AI features are disabled by default
> and content never leaves the device without explicit user consent.

### Semantic and vector search (pgvector)

- [ ] Add the `pgvector` extension to the PostgreSQL Docker image
- [ ] Add `note_embeddings` table with columns: `note_id`, `embedding vector(1536)`, `model`, `updated_at`
- [ ] Build an embedding pipeline: on note save, generate an embedding via the configured model and upsert into `note_embeddings`
- [ ] Add `GET /search/semantic?q=&vault=&limit=` using cosine similarity search via pgvector
- [ ] Implement hybrid search combining Meilisearch keyword results with pgvector semantic results using rank fusion
- [ ] Support local embedding via an Ollama sidecar using `nomic-embed-text`; no API key required
- [ ] Support OpenAI `text-embedding-3-small` for cloud mode
- [ ] Write integration tests for the embedding pipeline and semantic search endpoint

### AI chat over the vault (RAG)

- [ ] Build a RAG pipeline: embed the user query, retrieve the top-K relevant note chunks, send to the LLM with context
- [ ] Add a "Chat with your vault" panel in the desktop app as a collapsible sidebar or floating window
- [ ] Stream LLM responses using Server-Sent Events from the Go backend
- [ ] Display source citations showing which notes contributed to each answer, as clickable links
- [ ] Make the AI provider configurable in settings: Ollama (local), OpenAI, Anthropic, or Gemini
- [ ] Add a per-vault AI enable/disable toggle; encrypted vaults default to disabled
- [ ] Write tests for the RAG retrieval pipeline

### Smart suggestions and auto-tagging

- [ ] Add a "Related notes" panel in the editor sidebar showing the top 5 semantically similar notes
- [ ] Add a "Find similar notes" action to the note context menu
- [ ] Suggest 1 to 3 tags on save; require user confirmation before applying
- [ ] Add an "Auto-summarise" command palette action that generates a summary callout at the top of the note
- [ ] Write tests for the suggestion and tagging logic

---

## `feature/task-management` - Task management and GTD

- [ ] Parse due dates from `- [ ] Task text` lines using the `date:YYYY-MM-DD` front-matter syntax or a configurable inline marker
- [ ] Parse priority levels (`high`, `medium`, `low`) from inline markers or front-matter
- [ ] Store tasks in a `note_tasks` table with columns: `note_id`, `text`, `done`, `due_date`, `priority`, `line_number`
- [ ] Add `GET /vaults/:id/tasks?done=false&due_before=` to query tasks
- [ ] Build a "Task inbox" sidebar panel listing all open tasks across the vault sorted by due date
- [ ] Add a Kanban board view: notes with a `status` front-matter property rendered as columns (To Do, In Progress, Done)
- [ ] Add a Calendar view: notes with a `date` front-matter property shown on a monthly calendar grid
- [ ] Highlight overdue tasks in the task panel and in the editor
- [ ] Add `Ctrl+Enter` shortcut to toggle the checkbox on the current line
- [ ] Write tests for the task parser and task repository

---

## `feature/publishing` - Publish notes as public URLs

> Notes can be published as publicly accessible, server-rendered HTML pages — no client
> application required to view them. Publishing is opt-in per note and supports optional
> password protection and expiry.

- [ ] Add `published_notes` table with columns: `note_id`, `slug`, `password_hash` (nullable), `expires_at` (nullable), `view_count`, `published_at`
- [ ] Add `POST /notes/:id/publish` to generate a unique slug and publish the note
- [ ] Add `DELETE /notes/:id/publish` to unpublish a note
- [ ] Build a server-side markdown-to-HTML renderer in Go using `goldmark`
- [ ] Serve published notes at `/p/:slug` with clean CSS and no application chrome
- [ ] Support optional password protection using a bcrypt hash checked on each view
- [ ] Support configurable expiry times (1 hour, 24 hours, 7 days, or no expiry)
- [ ] Show a "Published" badge on notes in the sidebar with a copy-link button
- [ ] Add a "Publish folder as static site" option that exports a folder as interlinked HTML pages
- [ ] Track and display the view count per published note in settings
- [ ] Write tests for the publish endpoint, slug generation, and HTML renderer

---

## `feature/pdf-and-media` - PDF viewer and media handling

- [ ] Integrate `pdf.js` for inline PDF rendering; open `.pdf` attachments inside the editor
- [ ] Support PDF annotation: highlight text in a PDF and save the annotation as a linked note block
- [ ] Add audio recording via the Tauri microphone API; save as a `.webm` attachment and display a waveform inline
- [ ] Auto-render YouTube and Vimeo URLs as embedded players in preview mode
- [ ] Support `![[drawing.excalidraw]]` embed syntax rendering an Excalidraw drawing canvas
- [ ] Add an OCR action for attached images using Tesseract.js; append extracted text as a note block
- [ ] Write tests for PDF annotation storage and media attachment handling

---

## `feature/spaced-repetition` - Flashcards and spaced repetition

- [ ] Parse the `#flashcard` tag on a note block and register it in the review queue
- [ ] Add `flashcard_reviews` table with columns: `note_id`, `block_ref`, `due_date`, `ease_factor`, `interval`, `repetitions`
- [ ] Implement the SM-2 spaced repetition algorithm for scheduling reviews
- [ ] Build a full-screen review session UI with card flip animation and rating buttons (Again, Hard, Good, Easy)
- [ ] Show a "Cards due today" count in the sidebar
- [ ] Display retention statistics: cards reviewed, pass rate, and review streak
- [ ] Export flashcards as an Anki-compatible `.apkg` file
- [ ] Write tests for the SM-2 scheduler and review session logic

---

## `feature/writing-experience` - Writing quality of life

- [ ] Show a reading time estimate in the status bar based on word count at 200 words per minute
- [ ] Add typewriter mode: keep the active line vertically centred in the viewport using CSS `scroll-margin`
- [ ] Add sentence/paragraph focus mode: reduce opacity of all text except the current sentence
- [ ] Add reading mode: full-screen rendered preview with no sidebar, configurable font, and adjustable line width
- [ ] Add a writing statistics dashboard showing words written today, this week, and this month with a streak counter
- [ ] Add a configurable daily word count goal with a progress indicator in the status bar
- [ ] Add a custom font selector per vault (Google Fonts and system fonts)
- [ ] Add line spacing presets: compact, normal, and relaxed
- [ ] Write tests for word count calculation and streak logic

---

## `feature/structured-data` - Note properties and database views

- [ ] Build a note properties panel in the editor sidebar that renders YAML front-matter as an editable key-value interface rather than raw YAML
- [ ] Support property types: text, number, date, checkbox, select, multi-select, and relation
- [ ] Implement a `relation` property type that links to another note bidirectionally and stores the edge in `note_links`
- [ ] Add a table/database view showing all notes in a folder as sortable and filterable rows with columns derived from front-matter properties
- [ ] Add saved views: allow users to save a filter and sort combination as a named view pinned in the sidebar
- [ ] Write tests for the property parser and table view query logic

---

## `feature/themes-and-customization` - Themes and visual customisation

- [ ] Add an accent colour picker in settings applied to links, graph nodes, tag pills, and focus borders via a CSS variable
- [ ] Add a font size slider in settings (12 to 20 px) remembered per vault
- [ ] Add a UI density toggle: compact, comfortable, or spacious
- [ ] Support a `custom.css` file in the vault root that is automatically loaded and applied on top of the base theme
- [ ] Add custom keyboard shortcut rebinding stored in settings JSON and applied at startup
- [ ] Build a theme registry for community CSS themes installable from a curated list
- [ ] Write tests for CSS variable injection and shortcut binding logic

---

## `feature/import-and-migration` - Import from other applications

- [ ] Build an import wizard UI supporting drag-and-drop of a folder, ZIP archive, or export file
- [ ] Implement Obsidian vault import: read `.md` files, preserve folder structure and wiki-links
- [ ] Implement bulk markdown import: accept a folder or ZIP of `.md` files and import into a selected vault
- [ ] Implement Notion import: parse a Notion HTML/markdown export ZIP and map database properties to front-matter
- [ ] Implement Logseq import: parse Logseq markdown export and handle block references using `((block-id))` syntax
- [ ] Implement Evernote import: parse `.enex` files and convert to markdown notes
- [ ] Implement Bear import: parse the `.bearbak` export format
- [ ] Write tests for each import format parser

---

## `feature/device-management` - Device management

- [ ] Add `GET /api/devices` endpoint returning all devices registered to the authenticated user with name, platform, and last-seen timestamp (#44)
- [ ] Add `DELETE /api/devices/:id` to revoke a specific device session and invalidate its WebSocket connection (#45)
- [ ] Show a device list in Settings with name, platform, last seen, and a "Revoke" button (#44)
- [ ] Auto-expire devices that have been inactive for 90 days via a daily background cleanup job (#46)
- [ ] Write unit tests for the device repository and revocation handler

---

## `feature/email-auth` - Email verification and password reset

> Phase 1 ships without email verification. This feature closes that gap before a public
> release so accounts are tied to verified addresses and recoverable on passphrase loss.

- [ ] Add `email_verifications` table: `id`, `user_id`, `token_hash`, `expires_at`, `used_at` (#47)
- [ ] Add `password_reset_tokens` table: `id`, `user_id`, `token_hash`, `expires_at`, `used_at` (#48)
- [ ] Send a verification email on registration; require verification before creating a vault (#47)
- [ ] Add `POST /api/auth/forgot-password` — generates a signed reset link and emails it (#48)
- [ ] Add `POST /api/auth/reset-password` — validates the token and updates the password hash (#48)
- [ ] Add refresh token rotation: issue a long-lived refresh token alongside the access token; exchange for a new access token on each use; revoke both on logout (#49)
- [ ] Add a `refresh_tokens` table and `POST /api/auth/refresh` endpoint (#49)
- [ ] Configure SMTP via environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) (#50)
- [ ] Write unit tests for token generation, validation, and expiry logic

---

## `feature/vault-sharing` - Collaborative vault sharing

> Users can invite others to a vault with viewer or editor access. Shared vaults
> appear in the sidebar for all members and sync in real time via WebSocket.

- [ ] Add `vault_members` table: `vault_id`, `user_id`, `role` (`viewer` or `editor`), `invited_by`, `accepted_at`, `created_at` (#51)
- [ ] Add `POST /vaults/:id/members` to invite a user by email address (#51)
- [ ] Add `PATCH /vaults/:id/members/:userId` to change a member's role (#52)
- [ ] Add `DELETE /vaults/:id/members/:userId` to remove a member or leave a vault (#52)
- [ ] Extend the authorization middleware to allow vault access for all members, enforcing role-based write checks (#53)
- [ ] Show shared vaults in the sidebar with a "shared" icon and member count tooltip (#55)
- [ ] Add a Sharing panel in the vault context menu listing members and invite form (#55)
- [ ] Broadcast WebSocket note updates to all connected members of the vault, not just the owner (#54)
- [ ] Write unit tests for the membership repository and authorization middleware changes

---

## `feature/observability` - Structured logging, metrics, and health

> Visibility into what the running application is doing is essential before production.
> This feature makes the sync service observable without external infrastructure changes.

- [ ] Replace all `fmt.Println` / `log.Println` calls with structured JSON logging using `slog` (Go standard library, no external dependency) (#56)
- [ ] Add a request-scoped correlation ID middleware; include the ID in every log line for that request (#56)
- [ ] Add a Prometheus metrics endpoint at `/metrics` exposing: HTTP request count and latency by route, active WebSocket connections, note create/update/delete counters, and Go runtime metrics (#57)
- [ ] Add Prometheus and Grafana services to `docker-compose.yml` with a pre-built NexusNotes dashboard JSON provisioned at startup (#58)
- [ ] Add `GET /api/admin/stats` (admin token only) returning: vault count, note count, user count, and uptime (#59)
- [ ] Write tests for the metrics middleware and the correlation ID propagation

---

## Backlog

Lower priority items not focused on the desktop application.

- [ ] Phase 4 - Mobile Flutter app (file browser, editor, search, graph, share sheet, camera-to-note, speech-to-text, home widget)
- [ ] Phase 6 - Browser extension / web clipper (Manifest V3, full-page markdown capture, selection capture, quick-capture popup)
- [ ] Custom domain support for published notes (CNAME record pointing to the NexusNotes server; SSL via Let's Encrypt ACME)
- [ ] Obsidian Sync protocol compatibility layer (optional, for users migrating from Obsidian Sync to NexusNotes self-hosted)

---

## Done

### `feature/breadcrumb-folder-path` - Show folder path in the breadcrumb (PR #127)

- [x] Render the active note's folder path between the vault and the title (#126)

### `feature/folders` - Folder organization (PR #125)

- [x] Create folders (header button, workspace right-click, folder right-click for subfolders), nested folders, drag notes into folders/root, delete folder (#109)

### `feature/logout-in-settings` - Discoverable sign out (PR #124)

- [x] Add a Sign out button to Settings (was only in the vault dropdown) (#123)

### `feature/app-context-menu` - Custom right-click menu (PR #121)

- [x] Suppress the native context menu; add a workspace menu (New note, daily note, search, refresh) (#120)

### `feature/auth-animated-background` - Auth screen polish (PR #119)

- [x] Animated, mouse-reactive background on the login/signup screen (#117)
- [x] Keep the submit button label while loading; calm error when the server is unreachable (#118)

### `feature/animated-login-logo` - Animate the login screen logo (PR #116)

- [x] Animate the auth card logo in place, reusing the float/pulse/shimmer keyframes (#108)

### `feature/auth-error-typing` - Stop masking DB errors as auth failures (PR #115)

- [x] Distinguish unique-violation and not-found from infra errors; propagate infra failures as 500 (#113)

### `feature/login-window-controls-and-maximized` - Login controls, maximized startup, dev scripts (PR #114)

- [x] Login screen: draggable title bar with minimize/maximize/close (#110)
- [x] Open the desktop window maximized on launch (#111)
- [x] Add one-command dev startup scripts: `dev-web.sh` + `dev-app.sh` (#112)

### `feature/tags-and-metadata` - Inline tags and YAML front-matter (PR #80)

- [x] Parse `#tag` syntax from note content and extract a tags list on save (#72)
- [x] Store tags in a `note_tags` join table with columns `note_id` and `tag` (#73)
- [x] Add `GET /vaults/:id/tags` returning all tags with counts (#74)
- [x] Render clickable tag pills in the editor status bar (#75)
- [x] Add a tag filter panel to the sidebar (#76)
- [x] Add YAML front-matter support for: `title`, `tags`, `aliases`, `created`, `updated` (#77)
- [x] Expose front-matter fields in the search index (#78)
- [x] Write tests for the tag parser and tag repository (#79)

### `feature/e2e-testing` - Playwright end-to-end test suite

- [x] Set up Playwright and configure the test runner (`playwright.config.ts`)
- [x] Write E2E tests: auth flow (01-auth)
- [x] Write E2E tests: vault management (02-vault)
- [x] Write E2E tests: note CRUD (03-notes)
- [x] Write E2E tests: wiki-links (04-wiki-links)
- [x] Write E2E tests: tags (05-tags)
- [x] Write E2E tests: search (06-search)
- [x] Write E2E tests: keyboard shortcuts (07-keyboard-shortcuts)
- [x] Write E2E tests: front-matter (08-frontmatter)
- [x] Write E2E tests: sidebar (09-sidebar)
- [x] Write E2E tests: command palette (10-command-palette)
- [x] Write E2E tests: editor preview (11-editor-preview)
- [x] Add E2E test run to CI pipeline (`.github/workflows/validate.yml`)

### `feature/wiki-links-and-backlinks` - Wiki-link parsing and backlink panel (PR #71)

- [x] DB migration: `note_links` table with source/target/anchor columns (#65)
- [x] Parse `[[Note name]]` and `[[Note name#Section]]` on save; store edges in `note_links` table (#66)
- [x] Upsert and resolve links atomically on note create and update (#67)
- [x] Add `GET /notes/:id/backlinks` endpoint (#68)
- [x] Write tests for the link parser and backlink repository (#66)
- [x] Build a collapsible backlink panel in the editor sidebar showing linking note titles (#69)
- [x] Highlight unresolved `[[links]]` where the target note does not exist (#70)
- [x] Add a "Create note" action when clicking an unresolved link (#70)

### `feature/project-setup` - Project scaffolding (PR #13)

- [x] Set up project scaffolding and CI/CD (#1)

### `feature/core-backend` - Sync Service (Go) (PR #14)

- [x] Create PostgreSQL schema and migrations (#2)
- [x] Implement Go sync service with note CRUD (#3)
- [x] Add authentication middleware with JWT (#4)
- [x] Implement WebSocket real-time sync (#5)
- [x] Add checksum-based conflict detection and version history (#6)

### `feature/desktop-app` - Desktop App (Tauri + React) (PR #15)

- [x] Set up Tauri + React desktop app scaffold (#7)
- [x] Build markdown editor with live preview (#8)
- [x] Build file tree sidebar and vault navigation (#9)
- [x] Connect desktop app to sync service API (#10)

### `feature/docker-stack` - Infrastructure (PR #16)

- [x] Set up Docker Compose stack (#11)

### `feature/docs` - Documentation (PR #17)

- [x] Write project documentation (#12)

### `feature/bugfixes-p1` - Phase 1 bug fixes

- [x] Fix null JSON arrays in note list and versions endpoints (#18)
- [x] Add vault ownership check on note Get and Update endpoints (#19)
- [x] Add auto-migration on server startup (#20)
- [x] Fix editor cursor reset on autosave (#21)
- [x] Fix autosave stale closure race condition (#22)
- [x] Add 401 auto-logout and WebSocket reconnect guard (#23)
- [x] Fetch real user profile on token restore (#24)

### `feature/startup-docs` - Startup documentation

- [x] Update README with complete startup instructions (#25)

### `feature/ui-overhaul` - UI polish, graph view, and features

- [x] Add wiki-link parsing and graph view (#33)
- [x] Add animations, transitions, and loading states (#34)
- [x] Add status bar with word count and sync status (#35)
- [x] Polish sidebar with SVG icons and context menu (#36)
- [x] Add code syntax highlighting in markdown preview (#37)
- [x] Add command palette (Ctrl+Shift+P) (#38)
- [x] Polish authentication screen with logo and background (#39)
