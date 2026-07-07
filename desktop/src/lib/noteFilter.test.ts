import { describe, it, expect } from "vitest";
import { folderOf, filterNotes, sortNotes, searchNotes, uniqueTitle, ROOT_FOLDER } from "./noteFilter";
import type { Note } from "./types";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    path: "",
    title: "Untitled",
    content: "",
    checksum: "",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("folderOf", () => {
  it("returns the top-level folder from a path", () => {
    expect(folderOf("Papers/attention.md")).toBe("Papers");
    expect(folderOf("Daily/2026/07.md")).toBe("Daily");
  });

  it("returns null for root-level notes", () => {
    expect(folderOf("")).toBeNull();
    expect(folderOf("note.md")).toBeNull();
  });
});

describe("filterNotes", () => {
  const notes = [
    note({ id: "a", path: "Papers/a.md", content: "#research stuff" }),
    note({ id: "b", path: "b.md", content: "#ideas" }),
    note({ id: "c", path: "Papers/c.md", content: "plain" }),
  ];

  it("passes everything with no filters", () => {
    expect(filterNotes(notes, [], null).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("matches any selected tag", () => {
    expect(filterNotes(notes, ["research", "ideas"], null).map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("filters by top-level folder", () => {
    expect(filterNotes(notes, [], "Papers").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("filters root-only notes with the root sentinel", () => {
    expect(filterNotes(notes, [], ROOT_FOLDER).map((n) => n.id)).toEqual(["b"]);
  });

  it("combines tag and folder filters", () => {
    expect(filterNotes(notes, ["research"], "Papers").map((n) => n.id)).toEqual(["a"]);
  });
});

describe("sortNotes", () => {
  const notes = [
    note({ id: "old", title: "Zebra", updated_at: "2026-01-01T00:00:00Z" }),
    note({ id: "new", title: "Alpha", updated_at: "2026-07-01T00:00:00Z" }),
  ];

  it("sorts by last updated descending", () => {
    expect(sortNotes(notes, "updated").map((n) => n.id)).toEqual(["new", "old"]);
  });

  it("sorts by title ascending", () => {
    expect(sortNotes(notes, "title").map((n) => n.id)).toEqual(["new", "old"]);
    expect(sortNotes(notes, "title").map((n) => n.title)).toEqual(["Alpha", "Zebra"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...notes];
    sortNotes(notes, "title");
    expect(notes).toEqual(copy);
  });
});

describe("uniqueTitle", () => {
  it("returns the base title when unused", () => {
    expect(uniqueTitle(new Set(["Other"]), "Note copy")).toBe("Note copy");
  });

  it("appends an incrementing suffix until unique", () => {
    const titles = new Set(["Note copy", "Note copy 2"]);
    expect(uniqueTitle(titles, "Note copy")).toBe("Note copy 3");
  });
});

describe("searchNotes", () => {
  const notes = [
    note({ id: "a", title: "Attention paper", content: "# Heading\n\nThe transformer uses self-attention everywhere." }),
    note({ id: "b", title: "Groceries", content: "- milk\n- eggs" }),
  ];

  it("returns empty for a blank query", () => {
    expect(searchNotes(notes, "  ")).toEqual([]);
  });

  it("matches titles case-insensitively", () => {
    const hits = searchNotes(notes, "GROCERIES");
    expect(hits).toHaveLength(1);
    expect(hits[0].note.id).toBe("b");
  });

  it("matches content and produces a cleaned snippet around the hit", () => {
    const hits = searchNotes(notes, "transformer");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("transformer");
    expect(hits[0].snippet).not.toContain("#");
  });
});
