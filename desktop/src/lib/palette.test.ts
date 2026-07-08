import { describe, it, expect } from "vitest";
import { buildPaletteGroups, isCommandQuery } from "./palette";
import type { Note } from "./types";
import type { PaletteCommand } from "./palette";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    path: "",
    title: "Untitled",
    content: "",
    checksum: "",
    created_at: "",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const notes = [
  note({ id: "a", title: "Attention paper", path: "Papers/attention.md", updated_at: "2026-07-01T00:00:00Z" }),
  note({ id: "b", title: "Groceries", content: "milk and eggs", updated_at: "2026-06-01T00:00:00Z" }),
  note({ id: "c", title: "Roadmap", updated_at: "2026-05-01T00:00:00Z" }),
];

const commands: PaletteCommand[] = [
  { id: "new", label: "New note", shortcut: "Ctrl+N", action: () => {} },
  { id: "graph", label: "Open graph", shortcut: "Ctrl+G", action: () => {} },
  { id: "settings", label: "Open settings", shortcut: "Ctrl+,", action: () => {} },
  { id: "out", label: "Sign out", action: () => {} },
];

describe("isCommandQuery", () => {
  it("detects the > prefix", () => {
    expect(isCommandQuery(">")).toBe(true);
    expect(isCommandQuery("> graph")).toBe(true);
    expect(isCommandQuery("graph")).toBe(false);
  });
});

describe("buildPaletteGroups", () => {
  it("shows recent notes plus a few commands when the query is empty", () => {
    const groups = buildPaletteGroups(notes, commands, "");
    expect(groups[0].label).toBe("Recent");
    expect(groups[0].items[0].id).toBe("a");
    expect(groups[1].label).toBe("Commands");
    expect(groups[1].items.length).toBeLessThanOrEqual(3);
  });

  it("filters notes by title and content", () => {
    const groups = buildPaletteGroups(notes, commands, "milk");
    const noteGroup = groups.find((g) => g.label === "Notes");
    expect(noteGroup!.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("only lists commands in command mode", () => {
    const groups = buildPaletteGroups(notes, commands, "> graph");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Commands");
    expect(groups[0].items.map((i) => i.id)).toEqual(["graph"]);
  });

  it("shows the note path as subtitle", () => {
    const groups = buildPaletteGroups(notes, commands, "attention");
    const item = groups[0].items[0];
    expect(item.sub).toBe("Papers/attention.md");
  });

  it("returns no groups when nothing matches", () => {
    expect(buildPaletteGroups(notes, commands, "zzzz-no-match")).toEqual([]);
  });
});
