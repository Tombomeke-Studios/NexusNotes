// Character class `[^[\]|#[]+?` — `[` and `|` don't need escaping inside `[...]`
const WIKI_RE = /\[\[([^[\]|#[]+?)(?:#([^[\]|]+?))?(?:\|([^\]]+?))?\]\]/g;

interface WikilinkNode {
  type: "link";
  url: string;
  title: null;
  children: [{ type: "text"; value: string }];
}

interface TextNode {
  type: "text";
  value: string;
}

type MdastNode = WikilinkNode | TextNode | { type: string; children?: MdastNode[] };

function expandText(value: string): Array<WikilinkNode | TextNode> {
  const result: Array<WikilinkNode | TextNode> = [];
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
    result.push({
      type: "link",
      url,
      title: null,
      children: [{ type: "text", value: alias || title }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    result.push({ type: "text", value: value.slice(lastIndex) });
  }

  return result;
}

function walkNode(node: MdastNode): void {
  if (!("children" in node) || !node.children) return;

  const newChildren: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && "value" in child && WIKI_RE.test((child as TextNode).value)) {
      newChildren.push(...expandText((child as TextNode).value));
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
