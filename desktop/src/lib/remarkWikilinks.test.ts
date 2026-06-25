import { describe, it, expect } from "vitest";

const WIKI_RE = /\[\[([^\]|#\[]+?)(?:#([^\]|]+?))?(?:\|([^\]]+?))?\]\]/g;

function expandText(value: string): Array<{ type: string; value?: string; url?: string; label?: string }> {
  const result: Array<{ type: string; value?: string; url?: string; label?: string }> = [];
  let lastIndex = 0;
  WIKI_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKI_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    const title = match[1].trim();
    const anchor = match[2]?.trim() ?? "";
    const alias = match[3]?.trim() ?? "";
    const url = `wikilink://${encodeURIComponent(title)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
    result.push({ type: "link", url, label: alias || title });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    result.push({ type: "text", value: value.slice(lastIndex) });
  }

  return result;
}

describe("remarkWikilinks (expandText logic)", () => {
  it("parses a bare wikilink", () => {
    const result = expandText("[[My Note]]");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("link");
    expect(result[0].url).toBe("wikilink://My%20Note");
    expect(result[0].label).toBe("My Note");
  });

  it("parses a wikilink with anchor", () => {
    const result = expandText("[[My Note#Section]]");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("wikilink://My%20Note#Section");
    expect(result[0].label).toBe("My Note");
  });

  it("parses a wikilink with alias", () => {
    const result = expandText("[[My Note|display text]]");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("wikilink://My%20Note");
    expect(result[0].label).toBe("display text");
  });

  it("parses a wikilink with anchor and alias", () => {
    const result = expandText("[[My Note#Section|click here]]");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("wikilink://My%20Note#Section");
    expect(result[0].label).toBe("click here");
  });

  it("returns surrounding text as text nodes", () => {
    const result = expandText("See [[Note A]] for details");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", value: "See " });
    expect(result[1].type).toBe("link");
    expect(result[2]).toEqual({ type: "text", value: " for details" });
  });

  it("handles multiple wikilinks", () => {
    const result = expandText("[[A]] and [[B]]");
    expect(result).toHaveLength(3);
    expect(result[0].url).toBe("wikilink://A");
    expect(result[1]).toEqual({ type: "text", value: " and " });
    expect(result[2].url).toBe("wikilink://B");
  });

  it("handles plain text with no wikilinks", () => {
    const result = expandText("just plain text");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", value: "just plain text" });
  });

  it("handles empty string", () => {
    const result = expandText("");
    expect(result).toHaveLength(0);
  });
});
