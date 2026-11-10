import { describe, it, expect } from "vitest";
import { parseOutline, headingSlug, findHeading, slugOccurrence } from "./outline";

describe("parseOutline", () => {
  it("returns empty for content without headings", () => {
    expect(parseOutline("plain text\n\nmore text")).toEqual([]);
  });

  it("extracts headings with levels in document order", () => {
    const outline = parseOutline("# One\n\ntext\n\n## Two\n\n### Three\n\n## Four");
    expect(outline).toEqual([
      { level: 1, text: "One", index: 0, offset: 0 },
      { level: 2, text: "Two", index: 1, offset: 13 },
      { level: 3, text: "Three", index: 2, offset: 21 },
      { level: 2, text: "Four", index: 3, offset: 32 },
    ]);
  });

  it("caps heading depth at 4", () => {
    const outline = parseOutline("##### Five hashes");
    expect(outline).toEqual([]);
  });

  it("ignores heading-like lines inside fenced code blocks", () => {
    const outline = parseOutline("# Real\n\n```\n# not a heading\n```\n\n## Also real");
    expect(outline.map((h) => h.text)).toEqual(["Real", "Also real"]);
  });
});

describe("parseOutline — fences and levels", () => {
  it("ignores headings inside ~~~ fences and fences longer than three", () => {
    const text = "# A\n~~~\n# no\n~~~\n````md\n```\n# still code\n````\n## B";
    expect(parseOutline(text).map((h) => h.text)).toEqual(["A", "B"]);
  });

  it("does not let a ~~~ line close a ``` fence", () => {
    expect(parseOutline("```\n~~~\n# code\n```\n# Real").map((h) => h.text)).toEqual(["Real"]);
  });

  it("drops closing hashes from the text", () => {
    expect(parseOutline("## Title ##")[0].text).toBe("Title");
    expect(parseOutline("## C# and F#")[0].text).toBe("C# and F#");
  });

  it("includes deeper levels on request", () => {
    expect(parseOutline("# A\n##### Deep", 6).map((h) => [h.level, h.index])).toEqual([
      [1, 0],
      [5, 1],
    ]);
  });
});

describe("findHeading (#558)", () => {
  const text = "# Plan\n\n## Open questions\n\n###### Fine print\n\n## open-questions";

  it("finds a heading by its text, whatever the case", () => {
    expect(findHeading(text, "open QUESTIONS")).toMatchObject({ text: "Open questions", index: 1, offset: 8 });
  });

  it("falls back to the slug, and reaches every level", () => {
    expect(findHeading(text, "Open-Questions!")?.index).toBe(1);
    expect(findHeading(text, "fine print")?.level).toBe(6);
  });

  it("prefers the exact text over an earlier heading with the same slug", () => {
    expect(findHeading(text, "open-questions")?.index).toBe(3);
  });

  it("returns null for an unknown or empty section", () => {
    expect(findHeading(text, "Nope")).toBeNull();
    expect(findHeading(text, "  ")).toBeNull();
  });
});

describe("slugOccurrence", () => {
  it("counts earlier headings with the same slug", () => {
    const all = parseOutline("# Notes\n## Day\n## Notes\n## notes!", 6);
    expect(all.map((h) => slugOccurrence(all, h))).toEqual([0, 0, 1, 2]);
  });
});

describe("headingSlug", () => {
  it("makes the GitHub-style anchor of a heading", () => {
    expect(headingSlug("My Heading")).toBe("my-heading");
    expect(headingSlug("  What's new in v2.0?  ")).toBe("whats-new-in-v20");
    expect(headingSlug("Café & crème")).toBe("café--crème");
    expect(headingSlug("already-slugged")).toBe("already-slugged");
  });
});
