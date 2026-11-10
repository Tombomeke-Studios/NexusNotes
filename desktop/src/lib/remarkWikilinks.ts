// `[[Title]]`, `[[Title#Section]]`, `[[Title|alias]]`, and `[[#Section]]` for
// a heading in the same note (#558). Inside `[...]` only `]` needs escaping.
const WIKI_RE = /\[\[([^[\]|#]*?)(?:#([^[\]|]+?))?(?:\|([^\]]+?))?\]\]/g;

export interface WikilinkNode {
  type: "link";
  url: string;
  title: null;
  children: [{ type: "text"; value: string }];
}

export interface TextNode {
  type: "text";
  value: string;
}

type MdastNode = WikilinkNode | TextNode | { type: string; children?: MdastNode[] };

/** What a link shows without an alias: the title, the section, or "Title › Section". */
function label(title: string, anchor: string): string {
  if (!title) return anchor;
  return anchor ? `${title} › ${anchor}` : title;
}

/** Splits a text value into text and link nodes around its wiki-links. */
export function expandText(value: string): Array<WikilinkNode | TextNode> {
  const result: Array<WikilinkNode | TextNode> = [];
  let lastIndex = 0;
  const text = (to: number) => {
    if (to > lastIndex) result.push({ type: "text", value: value.slice(lastIndex, to) });
  };

  for (const match of value.matchAll(WIKI_RE)) {
    const title = match[1].trim();
    const anchor = match[2]?.trim() ?? "";
    const alias = match[3]?.trim() ?? "";
    // `[[]]` and `[[|alias]]` point nowhere: they stay text.
    if (!title && !anchor) continue;
    text(match.index);
    const url = `wikilink://${encodeURIComponent(title)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
    result.push({
      type: "link",
      url,
      title: null,
      children: [{ type: "text", value: alias || label(title, anchor) }],
    });
    lastIndex = match.index + match[0].length;
  }
  text(value.length);
  return result;
}

function walkNode(node: MdastNode): void {
  if (!("children" in node) || !node.children) return;

  const newChildren: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && "value" in child && (child as TextNode).value.includes("[[")) {
      // A loop, not push(...): a spread overflows the call stack on huge text (#376).
      for (const n of expandText((child as TextNode).value)) newChildren.push(n);
    } else {
      walkNode(child);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

export function remarkWikilinks() {
  return (tree: MdastNode) => {
    walkNode(tree);
  };
}
