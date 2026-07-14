import { describe, it, expect } from "vitest";
import { expandEmbeds, remarkImageEmbeds } from "./remarkImageEmbeds";

describe("expandEmbeds", () => {
  it("turns an embed into an image node with an attachment url", () => {
    const out = expandEmbeds("before ![[pixel.png]] after");
    expect(out).toEqual([
      { type: "text", value: "before " },
      { type: "image", url: "attachment://pixel.png", alt: "pixel.png", title: null },
      { type: "text", value: " after" },
    ]);
  });

  it("encodes spaces and uses an alias as alt text", () => {
    const [node] = expandEmbeds("![[my file.png|A diagram]]") as Array<{ url: string; alt: string }>;
    expect(node.url).toBe("attachment://my%20file.png");
    expect(node.alt).toBe("A diagram");
  });

  it("leaves plain text and normal wiki-links untouched", () => {
    expect(expandEmbeds("see [[Note]] and text")).toEqual([
      { type: "text", value: "see [[Note]] and text" },
    ]);
  });
});

describe("remarkImageEmbeds transformer", () => {
  it("rewrites text children within a tree", () => {
    const tree = {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "x ![[a.png]] y" }] }],
    };
    remarkImageEmbeds()(tree as never);
    const para = (tree.children[0] as { children: Array<{ type: string; url?: string }> }).children;
    expect(para.map((n) => n.type)).toEqual(["text", "image", "text"]);
    expect(para[1].url).toBe("attachment://a.png");
  });
});
