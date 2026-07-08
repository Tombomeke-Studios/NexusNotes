import { describe, it, expect } from "vitest";
import { buildTree, flattenTreeNoteIds } from "./tree";
import type { Note } from "./types";

function makeNote(overrides: Partial<Note>): Note {
  return {
    id: "1",
    vault_id: "v1",
    path: "",
    title: "Test",
    content: "",
    checksum: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("buildTree", () => {
  it("returns empty array for no notes", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("creates flat list for notes without paths", () => {
    const notes = [
      makeNote({ id: "1", title: "Note A", path: "" }),
      makeNote({ id: "2", title: "Note B", path: "" }),
    ];
    const tree = buildTree(notes);
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe("note");
    expect(tree[1].type).toBe("note");
  });

  it("creates folder structure from paths", () => {
    const notes = [
      makeNote({ id: "1", title: "Deep Note", path: "folder/sub" }),
      makeNote({ id: "2", title: "Root Note", path: "" }),
    ];
    const tree = buildTree(notes);
    expect(tree[0].type).toBe("folder");
    expect(tree[0].name).toBe("folder");
    expect(tree[0].children![0].type).toBe("folder");
    expect(tree[0].children![0].name).toBe("sub");
    expect(tree[1].type).toBe("note");
  });

  it("keeps input note order when keepNoteOrder is set", () => {
    const notes = [
      makeNote({ id: "1", title: "Zebra", path: "" }),
      makeNote({ id: "2", title: "Alpha", path: "" }),
    ];
    const tree = buildTree(notes, { keepNoteOrder: true });
    expect(tree.map((n) => n.name)).toEqual(["Zebra", "Alpha"]);
  });

  it("sorts notes alphabetically by default", () => {
    const notes = [
      makeNote({ id: "1", title: "Zebra", path: "" }),
      makeNote({ id: "2", title: "Alpha", path: "" }),
    ];
    const tree = buildTree(notes);
    expect(tree.map((n) => n.name)).toEqual(["Alpha", "Zebra"]);
  });

  it("sorts folders before notes", () => {
    const notes = [
      makeNote({ id: "1", title: "Zebra", path: "" }),
      makeNote({ id: "2", title: "Alpha", path: "folder" }),
    ];
    const tree = buildTree(notes);
    expect(tree[0].type).toBe("folder");
    expect(tree[1].type).toBe("note");
  });

  it("includes empty folders that have no notes", () => {
    const tree = buildTree([], { emptyFolders: ["Projects", "Areas/Health"] });
    const names = tree.map((n) => n.name);
    expect(names).toContain("Projects");
    const areas = tree.find((n) => n.name === "Areas");
    expect(areas?.type).toBe("folder");
    expect(areas?.children?.[0].name).toBe("Health");
  });

  it("merges an empty folder with one derived from a note path", () => {
    const notes = [makeNote({ id: "1", title: "N", path: "Work" })];
    const tree = buildTree(notes, { emptyFolders: ["Work"] });
    const work = tree.filter((n) => n.name === "Work");
    expect(work).toHaveLength(1); // not duplicated
    expect(work[0].children?.[0].type).toBe("note");
  });
});

describe("flattenTreeNoteIds", () => {
  it("returns note ids in depth-first visible order (folders' notes included)", () => {
    const notes = [
      makeNote({ id: "root1", title: "Zeta", path: "" }),
      makeNote({ id: "f1", title: "Alpha", path: "Work" }),
      makeNote({ id: "f2", title: "Beta", path: "Work" }),
    ];
    const tree = buildTree(notes);
    // Folder "Work" sorts first; its notes Alpha, Beta; then root note Zeta.
    expect(flattenTreeNoteIds(tree)).toEqual(["f1", "f2", "root1"]);
  });
});
