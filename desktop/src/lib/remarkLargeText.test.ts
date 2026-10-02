import { describe, it, expect } from "vitest";
import { remarkTags } from "./remarkTags";
import { remarkWikilinks } from "./remarkWikilinks";
import { remarkImageEmbeds } from "./remarkImageEmbeds";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

function paragraphOf(text: string): Node {
  return { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }] };
}

// A spread (`push(...nodes)`) passes every node as an argument and throws a
// RangeError from ~100k elements; one huge paragraph must not crash the
// preview (#376).
describe("remark plugins on a pathological text node", () => {
  const COUNT = 200_000;

  it.each([
    ["remarkTags", () => remarkTags(), "#t "],
    ["remarkWikilinks", () => remarkWikilinks(), "[[a]] "],
    ["remarkImageEmbeds", () => remarkImageEmbeds(), "![[a.png]] "],
  ] as const)("%s handles 200k matches in one text node", (_name, plugin, unit) => {
    const tree = paragraphOf(unit.repeat(COUNT));
    expect(() => (plugin() as (t: Node) => void)(tree)).not.toThrow();
    // Every match became its own node (plus the text between them).
    expect(tree.children![0].children!.length).toBeGreaterThanOrEqual(COUNT);
  });
});
