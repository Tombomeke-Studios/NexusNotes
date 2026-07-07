import { describe, it, expect } from "vitest";
import { parseOutline } from "./outline";

describe("parseOutline", () => {
  it("returns empty for content without headings", () => {
    expect(parseOutline("plain text\n\nmore text")).toEqual([]);
  });

  it("extracts headings with levels in document order", () => {
    const outline = parseOutline("# One\n\ntext\n\n## Two\n\n### Three\n\n## Four");
    expect(outline).toEqual([
      { level: 1, text: "One", index: 0 },
      { level: 2, text: "Two", index: 1 },
      { level: 3, text: "Three", index: 2 },
      { level: 2, text: "Four", index: 3 },
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
