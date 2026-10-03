import { describe, it, expect } from "vitest";
import { previewExcerpt } from "./linkPreview";

describe("previewExcerpt", () => {
  it("drops front matter, the leading title heading and markdown syntax", () => {
    const content = "---\ntags: [a]\n---\n# Plan\n\nSome **bold** and _soft_ text with a [link](https://x.y) and [[Other note|alias]].\n\n- item one\n- item two";
    expect(previewExcerpt(content, "Plan")).toBe("Some bold and soft text with a link and alias.\nitem one\nitem two");
  });

  it("cuts long text at a word boundary", () => {
    const out = previewExcerpt("word ".repeat(200), "x", 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it("skips code fences and keeps empty notes empty", () => {
    expect(previewExcerpt("```js\nconst a = 1;\n```\nAfter code", "x")).toBe("After code");
    expect(previewExcerpt("", "x")).toBe("");
  });
});
