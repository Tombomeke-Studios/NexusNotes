import { describe, it, expect } from "vitest";
import { expandText as expand, remarkWikilinks } from "./remarkWikilinks";

/** The real plugin's nodes, flattened to what the tests compare. */
function expandText(value: string): Array<{ type: string; value?: string; url?: string; label?: string }> {
  return expand(value).map((n) => (n.type === "link" ? { type: "link", url: n.url, label: n.children[0].value } : n));
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
    expect(result[0].label).toBe("My Note › Section");
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

describe("remarkWikilinks — sections and edge cases (#558)", () => {
  it("links a heading of the same note with [[#Section]]", () => {
    expect(expandText("see [[#Open questions]]")).toEqual([
      { type: "text", value: "see " },
      { type: "link", url: "wikilink://#Open%20questions", label: "Open questions" },
    ]);
    expect(expandText("[[#Top|back up]]")[0].label).toBe("back up");
  });

  it("leaves links that point nowhere as text", () => {
    expect(expandText("[[]] and [[|x]]")).toEqual([{ type: "text", value: "[[]] and [[|x]]" }]);
  });

  it("keeps the text between an empty link and a real one", () => {
    expect(expandText("[[]] then [[A]]!")).toEqual([
      { type: "text", value: "[[]] then " },
      { type: "link", url: "wikilink://A", label: "A" },
      { type: "text", value: "!" },
    ]);
  });

  it("rewrites text nodes in the tree and leaves the others alone", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "a [[B]]" }] },
        { type: "code", value: "[[C]]" },
      ],
    };
    remarkWikilinks()(tree);
    expect(tree.children[0].children).toHaveLength(2);
    expect(tree.children[1]).toEqual({ type: "code", value: "[[C]]" });
  });
});
