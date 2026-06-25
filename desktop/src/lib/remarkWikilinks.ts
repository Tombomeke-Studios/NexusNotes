const WIKI_RE = /\[\[([^\]|#\[]+?)(?:#([^\]|]+?))?(?:\|([^\]]+?))?\]\]/g;

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

function walkNode(node: any): void {
  if (!node.children) return;

  const newChildren: any[] = [];
  for (const child of node.children) {
    if (child.type === "text" && WIKI_RE.test(child.value)) {
      newChildren.push(...expandText(child.value));
    } else {
      walkNode(child);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function remarkWikilinks(): (tree: any) => void {
  return (tree: any) => {
    walkNode(tree);
  };
}
