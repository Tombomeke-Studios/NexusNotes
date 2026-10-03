import { renderTemplate, templateVars, TEMPLATES_FOLDER } from "./templates";
import { toIsoDate } from "./daily";

/**
 * Sample notes seeded into a brand-new user's first vault (#445, #446, #449)
 * so the app isn't empty on first run: a short quick-start guide (starred),
 * editor tips, a linked example in a folder, a template for Ctrl+T and today's
 * daily note. They link to each other, so the graph and backlinks have
 * something to show. Users can freely edit or delete them.
 */
export interface WelcomeNote {
  title: string;
  /** Folder the note lives in ("" = root). */
  path: string;
  content: string;
}

/** The guide that is starred on seeding (#449). */
export const QUICK_START_TITLE = "Getting Started";

export function welcomeNotes(now: Date, dailyTemplate: string): WelcomeNote[] {
  const today = toIsoDate(now);
  return [
    {
      title: "Welcome",
      path: "",
      content: `# Welcome to NexusNotes 👋

This is your **second brain**: a markdown-first, self-hosted place for your notes.

Start here:

- Read the two-minute [[Getting Started]] guide.
- Try the editor in [[My First Note]].
- See how notes connect in [[Project Ideas]].
- Keep the [[Keyboard Shortcuts]] close.

Open the **graph** (\`Ctrl+G\`) to see these notes link together. 🕸️

#welcome
`,
    },
    {
      title: QUICK_START_TITLE,
      path: "",
      content: `# Getting Started

Two minutes, five ideas:

1. **Create** a note with \`Ctrl+N\`. It saves itself a second after you stop typing.
2. **Link** notes by typing \`[[Note name]]\`, like this link back to [[Welcome]]. A link to
   a note that doesn't exist yet creates it when you click it.
3. **Tag** anything with \`#like-this\`, then click the tag to filter.
4. **Find** anything: \`Ctrl+P\` jumps to a note, \`Ctrl+Shift+F\` searches all text.
5. **Go back in time**: \`Ctrl+Shift+H\` shows a note's version history.

Today's daily note (\`Ctrl+D\`) is a good place to start writing.
Practise in [[My First Note]]; press \`?\` for every shortcut.

#guide
`,
    },
    {
      title: "My First Note",
      path: "",
      content: `# My First Note

Edit this note freely. A few things the editor can do:

- **Bold**, _italic_, \`code\`, and lists, all in plain markdown.
- Switch between **Edit**, **Split** and **Read** with \`Ctrl+E\`.
- Hover a link like [[Welcome]] in Read view to preview it.
- Tasks:
  - [x] Open this note
  - [ ] Link it to [[Project Ideas]]

> [!TIP] Callouts
> Start a quote with \`[!TIP]\`, \`[!NOTE]\` or \`[!WARNING]\` to make a callout like this one.

Made a mistake? \`Ctrl+Shift+H\` brings back any earlier version.

#guide
`,
    },
    {
      title: "Keyboard Shortcuts",
      path: "",
      content: `# Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| \`Ctrl+P\` | Quick open |
| \`Ctrl+Shift+P\` | Command palette |
| \`Ctrl+N\` | New note |
| \`Ctrl+S\` | Save |
| \`Ctrl+E\` | Cycle edit / split / read |
| \`Ctrl+G\` | Graph view |
| \`Ctrl+D\` | Today's daily note |
| \`Ctrl+T\` | Insert a template |
| \`Ctrl+Shift+F\` | Search across the vault |
| \`Ctrl+Shift+H\` | Version history |
| \`Ctrl+B\` | Toggle sidebar |
| \`Ctrl+,\` | Settings |
| \`?\` | All shortcuts |

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
- [ ] Link it to a related note with \`[[ ]]\`, like [[My First Note]]
- [ ] Tag it so you can find it later

#idea #example
`,
    },
    {
      title: "Meeting",
      path: TEMPLATES_FOLDER,
      content: `# {{title}}

**Date:** {{date}} {{time}}

## Attendees

-

## Notes

-

## Actions

- [ ]
`,
    },
    {
      title: today,
      path: "Daily",
      content: `${renderTemplate(dailyTemplate, templateVars(now, today)).trimEnd()}

First day with NexusNotes: see [[Getting Started]].
`,
    },
  ];
}
