import { describe, it, expect } from "vitest";
import { remarkTags } from "./remarkTags";

interface TestNode {
  type: string;
  value?: string;
  url?: string;
  children?: TestNode[];
}

function run(tree: TestNode): TestNode {
  remarkTags()(tree);
  return tree;
}

function paragraph(...children: TestNode[]): TestNode {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

describe("remarkTags", () => {
  it("converts an inline tag to a tag:// link", () => {
    const tree = run(paragraph({ type: "text", value: "note about #research topics" }));
    const children = tree.children![0].children!;
    const link = children.find((c) => c.type === "link");
    expect(link).toBeDefined();
    expect(link!.url).toBe("tag://research");
    expect(link!.children![0].value).toBe("#research");
  });

  it("keeps surrounding text including the leading space", () => {
    const tree = run(paragraph({ type: "text", value: "before #tag after" }));
    const children = tree.children![0].children!;
    expect(children[0].value).toBe("before ");
    expect(children[2].value).toBe(" after");
  });

  it("matches a tag at the start of the text", () => {
    const tree = run(paragraph({ type: "text", value: "#daily log" }));
    const children = tree.children![0].children!;
    expect(children[0].type).toBe("link");
  });

  it("ignores hashes inside words and numeric-only tags", () => {
    const tree = run(paragraph({ type: "text", value: "c# and item#2 and #123" }));
    const children = tree.children![0].children!;
    expect(children.every((c) => c.type !== "link")).toBe(true);
  });

  it("does not descend into code-ish nodes without text children", () => {
    const tree: TestNode = {
      type: "root",
      children: [{ type: "code", value: "#not-a-tag" }],
    };
    expect(() => run(tree)).not.toThrow();
    expect(tree.children![0].value).toBe("#not-a-tag");
  });
});
