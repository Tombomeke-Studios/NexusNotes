import { describe, it, expect } from "vitest";
import {
  findMatches,
  matchAtOrAfter,
  stepMatch,
  replaceAllPlan,
  markMatches,
  matchLabel,
  MAX_MATCHES,
} from "./findReplace";
import { highlightMarkdown, type Segment } from "./mdHighlight";

const spans = (text: string, ms: Array<{ start: number; end: number }>) => ms.map((m) => text.slice(m.start, m.end));

describe("findMatches", () => {
  it("finds every occurrence, case-insensitive by default", () => {
    const text = "Cat cat CAT scatter";
    const ms = findMatches(text, "cat");
    expect(ms).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
      { start: 13, end: 16 },
    ]);
  });

  it("respects case sensitivity", () => {
    expect(spans("Cat cat CAT", findMatches("Cat cat CAT", "cat", { caseSensitive: true }))).toEqual(["cat"]);
  });

  it("matches whole words only when asked", () => {
    const text = "cat scatter cat_x cat-like (cat)";
    const ms = findMatches(text, "cat", { wholeWord: true });
    expect(ms.map((m) => m.start)).toEqual([0, 18, 28]);
  });

  it("treats whole words with letters outside ASCII as word characters", () => {
    expect(findMatches("café cafés", "café", { wholeWord: true })).toEqual([{ start: 0, end: 4 }]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatches("anything", "")).toEqual([]);
  });

  it("takes the query literally (no regex)", () => {
    const text = "a.b axb (x) [y] $1 \\d+ a*";
    expect(spans(text, findMatches(text, "a.b"))).toEqual(["a.b"]);
    expect(spans(text, findMatches(text, "(x)"))).toEqual(["(x)"]);
    expect(spans(text, findMatches(text, "[y]"))).toEqual(["[y]"]);
    expect(spans(text, findMatches(text, "\\d+"))).toEqual(["\\d+"]);
    expect(spans(text, findMatches(text, "a*"))).toEqual(["a*"]);
    expect(spans(text, findMatches(text, "$1"))).toEqual(["$1"]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("keeps offsets right for characters whose lower case is longer", () => {
    // "İ".toLowerCase() is two code units; offsets must still point into the original text.
    const text = "İx ix";
    const ms = findMatches(text, "ix");
    expect(spans(text, ms)).toContain("ix");
    for (const m of ms) expect(text.slice(m.start, m.end).toLowerCase()).toContain("x");
  });

  it("finds matches across a large note (beyond the highlighting cutoff)", () => {
    const text = "word ".repeat(40_000) + "needle";
    expect(text.length).toBeGreaterThan(150_000);
    expect(findMatches(text, "needle")).toEqual([{ start: 200_000, end: 200_006 }]);
  });

  it("stops at the limit", () => {
    const text = "a".repeat(MAX_MATCHES + 50);
    expect(findMatches(text, "a")).toHaveLength(MAX_MATCHES);
    expect(findMatches(text, "a", {}, 10)).toHaveLength(10);
  });
});

describe("matchAtOrAfter", () => {
  const ms = [
    { start: 2, end: 4 },
    { start: 10, end: 12 },
    { start: 20, end: 22 },
  ];
  it("picks the first match starting at or after the offset", () => {
    expect(matchAtOrAfter(ms, 0)).toBe(0);
    expect(matchAtOrAfter(ms, 2)).toBe(0);
    expect(matchAtOrAfter(ms, 3)).toBe(1);
    expect(matchAtOrAfter(ms, 20)).toBe(2);
  });
  it("wraps to the first match past the last one", () => {
    expect(matchAtOrAfter(ms, 21)).toBe(0);
  });
  it("is -1 without matches", () => {
    expect(matchAtOrAfter([], 5)).toBe(-1);
  });
});

describe("stepMatch", () => {
  it("moves forward and back, wrapping around", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(1, 3, -1)).toBe(0);
  });
  it("is -1 without matches", () => {
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
  it("starts at the first or last match from no selection", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });
});

describe("replaceAllPlan", () => {
  it("replaces every match and spans only the changed range", () => {
    const text = "one cat, two cats, end";
    const ms = findMatches(text, "cat");
    const plan = replaceAllPlan(text, ms, "dog")!;
    expect(plan.text).toBe("one dog, two dogs, end");
    expect(plan.start).toBe(4);
    expect(plan.end).toBe(16);
    expect(text.slice(0, plan.start) + plan.insert + text.slice(plan.end)).toBe(plan.text);
    expect(plan.count).toBe(2);
  });

  it("inserts the replacement literally ($ patterns are not special)", () => {
    const text = "a-b";
    const plan = replaceAllPlan(text, findMatches(text, "-"), "$& $1 $$")!;
    expect(plan.text).toBe("a$& $1 $$b");
  });

  it("can replace with nothing", () => {
    const text = "x, y, x";
    expect(replaceAllPlan(text, findMatches(text, "x"), "")!.text).toBe(", y, ");
  });

  it("is null without matches", () => {
    expect(replaceAllPlan("abc", [], "z")).toBeNull();
  });
});

describe("matchLabel", () => {
  it("reads like a find bar", () => {
    expect(matchLabel("", 0, -1)).toBe("");
    expect(matchLabel("q", 0, -1)).toBe("No results");
    expect(matchLabel("q", 12, 2)).toBe("3 of 12");
    expect(matchLabel("q", 12, -1)).toBe("12 results");
    expect(matchLabel("q", MAX_MATCHES, 0)).toBe(`1 of ${MAX_MATCHES}+`);
  });
});

describe("markMatches", () => {
  const joined = (lines: Segment[][]) => lines.map((l) => l.map((s) => s.text).join("")).join("\n");

  it("keeps every character in order", () => {
    const text = "# Cat title\nA **cat** and a cat.\n\nlast cat";
    const lines = highlightMarkdown(text)!;
    const marked = markMatches(lines, findMatches(text, "cat"), 1);
    expect(joined(marked)).toBe(text);
  });

  it("wraps matches in find-match segments and emphasises the current one", () => {
    const text = "a cat\nthe cat";
    const lines = highlightMarkdown(text)!;
    const marked = markMatches(lines, findMatches(text, "cat"), 1);
    expect(marked[0]).toEqual([{ text: "a " }, { cls: "find-match", text: "cat" }]);
    expect(marked[1]).toEqual([{ text: "the " }, { cls: "find-match find-match--current", text: "cat" }]);
  });

  it("keeps the markdown class on a match inside a styled segment", () => {
    const text = "x **bold cat** y";
    const marked = markMatches(highlightMarkdown(text)!, findMatches(text, "cat"), -1);
    const hit = marked[0].find((s) => s.cls?.includes("find-match"))!;
    expect(hit).toEqual({ cls: "md-strong find-match", text: "cat" });
  });

  it("marks a match split over two segments in both", () => {
    // "`code`" is one segment, the following "x" another: "e`x" spans both.
    const text = "`code`x";
    const marked = markMatches(highlightMarkdown(text)!, findMatches(text, "e`x"), 0);
    const hits = marked[0].filter((s) => s.cls?.includes("find-match"));
    expect(hits.map((s) => s.text)).toEqual(["e`", "x"]);
    expect(joined(marked)).toBe(text);
  });

  it("returns the lines untouched without matches", () => {
    const lines = highlightMarkdown("plain")!;
    expect(markMatches(lines, [], -1)).toBe(lines);
  });
});
