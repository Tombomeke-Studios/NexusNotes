import type { Note } from "./types";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

export interface PaletteItem {
  kind: "note" | "command";
  id: string;
  title: string;
  sub?: string;
  shortcut?: string;
}

export interface PaletteGroup {
  key: string;
  label: string;
  items: PaletteItem[];
}

export function isCommandQuery(query: string): boolean {
  return query.startsWith(">");
}

function noteItem(n: Note): PaletteItem {
  return {
    kind: "note",
    id: n.id,
    title: n.title || "Untitled",
    sub: n.path || `${n.title || "Untitled"}.md`,
  };
}

function commandItem(c: PaletteCommand): PaletteItem {
  return { kind: "command", id: c.id, title: c.label, shortcut: c.shortcut };
}

export function buildPaletteGroups(
  notes: Note[],
  commands: PaletteCommand[],
  query: string,
): PaletteGroup[] {
  const cmdMode = isCommandQuery(query);
  const term = (cmdMode ? query.slice(1) : query).trim().toLowerCase();
  const groups: PaletteGroup[] = [];

  const cmdMatches = commands.filter((c) => !term || c.label.toLowerCase().includes(term));

  if (!cmdMode) {
    const noteMatches = notes
      .filter(
        (n) =>
          !term ||
          n.title.toLowerCase().includes(term) ||
          n.content.toLowerCase().includes(term),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 7)
      .map(noteItem);
    if (noteMatches.length) {
      groups.push({ key: "notes", label: term ? "Notes" : "Recent", items: noteMatches });
    }
    const cmds = (term ? cmdMatches : commands.slice(0, 3)).map(commandItem);
    if (cmds.length) {
      groups.push({ key: "commands", label: "Commands", items: cmds });
    }
  } else if (cmdMatches.length) {
    groups.push({ key: "commands", label: "Commands", items: cmdMatches.map(commandItem) });
  }

  return groups;
}
