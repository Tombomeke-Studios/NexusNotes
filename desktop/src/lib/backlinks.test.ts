import { describe, it, expect } from "vitest";
import { buildBacklinkCards } from "./backlinks";
import type { Note } from "./types";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    path: "",
    title: "Untitled",
    content: "",
    checksum: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("buildBacklinkCards", () => {
  const target = note({ id: "t", title: "Research Note" });
  const linker = note({
    id: "l",
    title: "Note 2",
    content: "This note links back to [[Research Note]] for context.",
  });
  const aliased = note({
    id: "a",
    title: "Aliased",
    content: "See [[Research Note|the research]] here.",
  });
  const unrelated = note({ id: "u", title: "Other", content: "No links here." });

  it("finds notes linking to the target with context", () => {
    const cards = buildBacklinkCards([target, linker, unrelated], target);
    expect(cards).toHaveLength(1);
    expect(cards[0].noteId).toBe("l");
    expect(cards[0].title).toBe("Note 2");
    expect(cards[0].match).toBe("[[Research Note]]");
    expect(cards[0].pre).toContain("links back to");
    expect(cards[0].post).toContain("for context");
  });

  it("matches aliased wiki-links", () => {
    const cards = buildBacklinkCards([target, aliased], target);
    expect(cards).toHaveLength(1);
    expect(cards[0].match).toBe("[[Research Note|the research]]");
  });

  it("is case-insensitive and excludes the note itself", () => {
    const self = note({ id: "s", title: "Loop", content: "[[loop]]" });
    const other = note({ id: "o", title: "Other", content: "see [[LOOP]]" });
    const cards = buildBacklinkCards([self, other], self);
    expect(cards.map((c) => c.noteId)).toEqual(["o"]);
  });
});
