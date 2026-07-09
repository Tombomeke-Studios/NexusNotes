/**
 * Sample notes seeded into a brand-new user's first vault so the app isn't empty
 * on first run. They use wiki-links, tags and a folder so the graph, backlinks
 * and file tree are populated from the start. Users can freely edit or delete them.
 */
export interface WelcomeNote {
  title: string;
  /** Folder the note lives in ("" = root). */
  path: string;
  content: string;
}

export const welcomeNotes: WelcomeNote[] = [
  {
    title: "Welcome",
    path: "",
    content: `# Welcome to NexusNotes 👋

This is your **second brain** — a markdown-first, self-hosted place for your notes.

Here are a few notes to get you started. Feel free to edit or delete them.

- Read the [[Getting Started]] guide.
- Peek at the [[Keyboard Shortcuts]].
- See how notes connect in [[Project Ideas]].

Open the **graph** (\`Ctrl+G\`) to see how these notes link together. 🕸️

#welcome
`,
  },
  {
    title: "Getting Started",
    path: "",
    content: `# Getting Started

A few things to try:

1. **Create a note** with \`Ctrl+N\`, or the note icon in the sidebar.
2. **Link notes** by typing \`[[Note name]]\` — try linking back to [[Welcome]].
3. **Tag** anything with \`#like-this\`; click a tag to filter.
4. **Organize** with folders — drag notes onto a folder, or right-click to make one.
5. **Search everything** with \`Ctrl+P\`, or full-text search with \`Ctrl+Shift+F\`.
6. **Daily notes**: \`Ctrl+D\` opens today's note.

Notes save automatically a second after you stop typing (or \`Ctrl+S\`).

See also: [[Keyboard Shortcuts]].

#guide
`,
  },
  {
    title: "Keyboard Shortcuts",
    path: "",
    content: `# Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| \`Ctrl+P\` | Quick open / command palette |
| \`Ctrl+Shift+P\` | Command palette |
| \`Ctrl+N\` | New note |
| \`Ctrl+S\` | Save |
| \`Ctrl+E\` | Cycle edit / split / read |
| \`Ctrl+G\` | Graph view |
| \`Ctrl+D\` | Today's daily note |
| \`Ctrl+Shift+F\` | Search across the vault |
| \`Ctrl+B\` | Toggle sidebar |
| \`Ctrl+,\` | Settings |

Back to [[Welcome]] · [[Getting Started]].

#guide
`,
  },
  {
    title: "Project Ideas",
    path: "Examples",
    content: `# Project Ideas

An example note inside the **Examples** folder, linked from [[Welcome]].

- [ ] Capture an idea here
- [ ] Link it to a related note with \`[[ ]]\`
- [ ] Tag it so you can find it later

#idea #example
`,
  },
];
