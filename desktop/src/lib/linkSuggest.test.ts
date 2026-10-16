import { describe, it, expect } from "vitest";
import {
  detectLinkTrigger,
  matchScore,
  linkOptions,
  linkInsertion,
  MAX_OPTIONS,
} from "./linkSuggest";
import type { Note } from "./types";

function note(id: string, title: string, path = "", content = "", updated = "2026-01-01T00:00:00Z"): Note {
  return {
    id,
    vault_id: "v",
    path,
    title,
    content,
    checksum: "",
    created_at: updated,
    updated_at: updated,
  };
}

/** Splits "before|after" at the bar into text and caret. */
function at(s: string): [string, number] {
  const caret = s.indexOf("|");
  return [s.slice(0, caret) + s.slice(caret + 1), caret];
}

describe("detectLinkTrigger", () => {
  it("opens right after [[", () => {
    const [text, caret] = at("See [[|");
    expect(detectLinkTrigger(text, caret)).toEqual({ from: 4, query: "" });
  });

  it("reports the fragment typed after [[", () => {
    const [text, caret] = at("See [[Meet|");
    expect(detectLinkTrigger(text, caret)).toEqual({ from: 4, query: "Meet" });
  });

  it("works with the caret inside an existing link", () => {
    const [text, caret] = at("[[Mee|ting]] and more");
    expect(detectLinkTrigger(text, caret)).toEqual({ from: 0, query: "Mee" });
  });

  it("allows spaces and a heading after #", () => {
    const [text, caret] = at("x [[Project plan#Go|");
    expect(detectLinkTrigger(text, caret)).toEqual({ from: 2, query: "Project plan#Go" });
  });

  it("is closed once the link is closed with ]]", () => {
    const [text, caret] = at("[[Meeting]]|");
    expect(detectLinkTrigger(text, caret)).toBeNull();
  });

  it("is closed by a single ] too", () => {
    const [text, caret] = at("[[Meeting]|");
    expect(detectLinkTrigger(text, caret)).toBeNull();
  });

  it("is closed after an alias bar", () => {
    const text = "[[Meeting|al";
    expect(detectLinkTrigger(text, text.length)).toBeNull();
  });

  it("does not cross a line break", () => {
    const [text, caret] = at("[[Meet\nnext|");
    expect(detectLinkTrigger(text, caret)).toBeNull();
  });

  it("ignores a single bracket and plain text", () => {
    expect(detectLinkTrigger("[x", 2)).toBeNull();
    expect(detectLinkTrigger("hello", 5)).toBeNull();
    expect(detectLinkTrigger("", 0)).toBeNull();
  });

  it("ignores ![[ attachment embeds", () => {
    const [text, caret] = at("![[pic|");
    expect(detectLinkTrigger(text, caret)).toBeNull();
  });

  it("uses the innermost [[ when brackets repeat", () => {
    const [text, caret] = at("[[[Plan|");
    expect(detectLinkTrigger(text, caret)).toEqual({ from: 1, query: "Plan" });
  });

  it("gives up on a very long fragment", () => {
    const text = "[[" + "a".repeat(300);
    expect(detectLinkTrigger(text, text.length)).toBeNull();
  });
});

describe("matchScore", () => {
  it("ranks exact over prefix over substring over fuzzy", () => {
    const exact = matchScore("Plan", "plan");
    const prefix = matchScore("Planning", "plan");
    const word = matchScore("Project plan", "plan");
    const inner = matchScore("Explanation", "plan");
    const fuzzy = matchScore("Play analysis", "plan");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it("is case-insensitive and ignores surrounding spaces", () => {
    expect(matchScore("Meeting Notes", "  MEETING notes ")).toBe(matchScore("meeting notes", "meeting notes"));
  });

  it("prefers the shorter title among prefix matches", () => {
    expect(matchScore("Plan", "pl")).toBeGreaterThan(matchScore("Planning sessions", "pl"));
  });

  it("matches letters in order with gaps (fuzzy)", () => {
    expect(matchScore("Meeting notes", "mtn")).toBeGreaterThan(0);
  });

  it("rejects letters out of order or missing", () => {
    expect(matchScore("Meeting notes", "ntm")).toBe(-1);
    expect(matchScore("Meeting", "z")).toBe(-1);
  });

  it("scores everything 0 for an empty query", () => {
    expect(matchScore("Anything", "")).toBe(0);
  });
});

describe("linkOptions", () => {
  const notes = [
    note("1", "Planning", "Work", "", "2026-01-02T00:00:00Z"),
    note("2", "Plan", "", "# Goals\n## Risks\n```\n# not a heading\n```\n### Next steps", "2026-01-01T00:00:00Z"),
    note("3", "Project plan", "Work/2026", "", "2026-01-05T00:00:00Z"),
    note("4", "Explanation", "", "", "2026-01-03T00:00:00Z"),
    note("5", "Groceries", "Home", "", "2026-01-04T00:00:00Z"),
  ];

  it("ranks exact and prefix matches first, then the rest", () => {
    const opts = linkOptions(notes, "plan");
    expect(opts.map((o) => o.label)).toEqual(["Plan", "Planning", "Project plan", "Explanation"]);
  });

  it("gives each note its folder as a hint", () => {
    const opts = linkOptions(notes, "plan");
    expect(opts.map((o) => o.hint)).toEqual(["", "Work", "Work/2026", ""]);
    expect(opts[0]).toMatchObject({ kind: "note", target: "Plan", noteId: "2" });
  });

  it("lists the most recently edited notes for an empty fragment", () => {
    const opts = linkOptions(notes, "");
    expect(opts.map((o) => o.label)).toEqual(["Project plan", "Groceries", "Explanation", "Planning", "Plan"]);
  });

  it("leaves out the note being edited", () => {
    const opts = linkOptions(notes, "plan", { excludeId: "2" });
    expect(opts.map((o) => o.label)).not.toContain("Plan");
  });

  it("shows at most MAX_OPTIONS results", () => {
    const many = Array.from({ length: 20 }, (_, i) => note(`n${i}`, `Note ${i}`));
    expect(linkOptions(many, "note")).toHaveLength(MAX_OPTIONS);
    expect(MAX_OPTIONS).toBe(8);
  });

  it("skips titles that cannot be written inside [[ ]]", () => {
    const odd = [note("a", "a|b"), note("b", "c]d"), note("c", ""), note("d", "ok")];
    expect(linkOptions(odd, "").map((o) => o.label)).toEqual(["ok"]);
  });

  it("offers to create a link when nothing matches", () => {
    expect(linkOptions(notes, "  Brand new idea ")).toEqual([
      { kind: "create", key: "create", label: "Brand new idea", hint: "", target: "Brand new idea" },
    ]);
  });

  it("offers nothing for an empty fragment in an empty vault", () => {
    expect(linkOptions([], "")).toEqual([]);
  });

  it("lists the headings of the named note after #", () => {
    const opts = linkOptions(notes, "plan#");
    expect(opts.map((o) => [o.kind, o.label, o.hint, o.target])).toEqual([
      ["heading", "Goals", "H1", "Plan#Goals"],
      ["heading", "Risks", "H2", "Plan#Risks"],
      ["heading", "Next steps", "H3", "Plan#Next steps"],
    ]);
  });

  it("filters the headings by what follows #", () => {
    expect(linkOptions(notes, "Plan#ri").map((o) => o.label)).toEqual(["Risks"]);
  });

  it("lists headings of the note being edited too", () => {
    expect(linkOptions(notes, "Plan#", { excludeId: "2" })).toHaveLength(3);
  });

  it("falls back to creating the link for an unknown note or heading", () => {
    expect(linkOptions(notes, "Nope#x")).toEqual([
      { kind: "create", key: "create", label: "Nope#x", hint: "", target: "Nope#x" },
    ]);
  });
});

describe("linkInsertion", () => {
  it("replaces the fragment and closes the brackets", () => {
    const [text, caret] = at("See [[Pla| today");
    const edit = linkInsertion(text, { from: 4, query: "Pla" }, caret, "Plan");
    expect(edit.text).toBe("See [[Plan]] today");
    expect(edit.text.slice(edit.start, edit.start + edit.insert.length)).toBe("[[Plan]]");
    expect(edit.caret).toBe("See [[Plan]]".length);
  });

  it("describes the edit as a range of the old text", () => {
    const [text, caret] = at("See [[Pla| today");
    const edit = linkInsertion(text, { from: 4, query: "Pla" }, caret, "Plan");
    expect(text.slice(0, edit.start) + edit.insert + text.slice(edit.end)).toBe(edit.text);
  });

  it("does not double the brackets of an already closed link", () => {
    const [text, caret] = at("[[Pla|nn]] after");
    const edit = linkInsertion(text, { from: 0, query: "Pla" }, caret, "Planning");
    expect(edit.text).toBe("[[Planning]] after");
    expect(edit.caret).toBe("[[Planning]]".length);
  });

  it("keeps an existing alias", () => {
    const text = "[[Pl|shown]]";
    const caret = 4; // after "Pl"
    const edit = linkInsertion(text, { from: 0, query: "Pl" }, caret, "Plan");
    expect(edit.text).toBe("[[Plan|shown]]");
    expect(edit.caret).toBe("[[Plan".length);
  });

  it("keeps an existing heading when picking a note", () => {
    const [text, caret] = at("[[Pl|#Goals]]");
    const edit = linkInsertion(text, { from: 0, query: "Pl" }, caret, "Plan");
    expect(edit.text).toBe("[[Plan#Goals]]");
  });

  it("inserts a heading target", () => {
    const [text, caret] = at("[[Plan#Ri|");
    const edit = linkInsertion(text, { from: 0, query: "Plan#Ri" }, caret, "Plan#Risks");
    expect(edit.text).toBe("[[Plan#Risks]]");
    expect(edit.caret).toBe(edit.text.length);
  });

  it("leaves text on the next line alone", () => {
    const [text, caret] = at("[[Pl|\nnext]]");
    const edit = linkInsertion(text, { from: 0, query: "Pl" }, caret, "Plan");
    expect(edit.text).toBe("[[Plan]]\nnext]]");
  });
});
