# Brand

How NexusNotes is named, described and drawn. Product copy, the README, store
listings and release notes follow this page.

## Name

- **NexusNotes**: one word, capital N twice. Not "Nexus Notes", "Nexusnotes" or
  "NN".
- Possessive: NexusNotes' (vaults, notes) is fine; prefer rephrasing ("your notes in
  NexusNotes").
- Code and paths keep their existing lower-case forms (`nexus-notes-desktop`,
  `nexus_token`); they are identifiers, not the name.

## Tagline and description

- **Tagline:** "Your notes, linked like your thoughts, and private by default."
- **One line:** "A markdown-first note-taking app you host yourself, with linked notes, a
  graph view and end-to-end encrypted sync."
- Voice: plain, concrete, calm. Say what a feature does for the reader ("your notes
  are encrypted on your device"), not how it is built ("AES-256-GCM"), except in
  technical documentation.

## Colours

The palette is the app's dark theme (Catppuccin Mocha based). The source of truth is
the custom properties at the top of `desktop/src/index.css`; use those tokens in code,
never the hex values.

| Role | Token | Value |
|---|---|---|
| Accent (lavender) | `--accent` | `#cba6f7` |
| Accent, second stop | `--accent-hover` | `#b4befe` |
| Background | `--bg-base` | `#1e1e2e` |
| Deepest background | `--bg-crust` | `#11111b` |
| Surface | `--bg-surface` | `#313244` |
| Text | `--text-primary` | `#cdd6f4` |
| Muted text | `--text-muted` | `#9399b2` |
| Success | `--success` | `#a6e3a1` |
| Warning | `--warning` | `#f9e2af` |
| Error | `--error` | `#f38ba8` |

The accent gradient runs from `#cba6f7` to `#b4befe` at 135 degrees. Graph folder
colours are `--graph-folder-1` to `--graph-folder-10`.

## Logo

The mark is a small constellation: four nodes in the corners of a square, linked into
an **N**, around a ringed core node. It stands for notes connected into a network.

| File | Use |
|---|---|
| `desktop/public/favicon.svg` | The mark on the dark tile (browser tab, small sizes) |
| `desktop/public/logo.svg` | The same, at 512 px (README, documents) |
| `desktop/src/components/Logo.tsx` | In the app: `tile` (dark tile), `animated` (top bar, no tile), `dark` (dark nodes for the bright gradient tile on the sign-in card) |
| `desktop/src-tauri/icons/` | App icons: dark nodes on the bright lavender gradient tile, the same treatment as the sign-in card |

Rules:

- Keep the node layout and the N links; do not rotate, stretch or add nodes.
- Use one of the two treatments: lavender nodes on the dark tile, or dark nodes on the
  lavender gradient tile. Do not place the lavender mark on a light background without
  the dark tile.
- Clear space around the tile: at least a quarter of its width.
- Smallest size: 16 px (favicon). Below 32 px the links may disappear; the nodes alone
  still read as the mark.

The Tauri icons were checked against the mark (October 2026): same constellation, in
the light-tile treatment. Regenerate them from a 1024 px render of the mark with
`npx tauri icon <file>` in `desktop/` when the mark changes.
