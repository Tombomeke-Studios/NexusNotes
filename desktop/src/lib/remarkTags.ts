// Mirrors the tag grammar used by lib/tags.ts and the backend parser.
const TAG_RE = /(^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g;

interface TagLinkNode {
  type: "link";
  url: string;
  title: null;
  children: [{ type: "text"; value: string }];
}

interface TextNode {
  type: "text";
  value: string;
}

type MdastNode = TagLinkNode | TextNode | { type: string; children?: MdastNode[] };

function expandText(value: string): Array<TagLinkNode | TextNode> {
  const result: Array<TagLinkNode | TextNode> = [];
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(value)) !== null) {
    const lead = match[1];
    const tag = match[2];
    const tagStart = match.index + lead.length;
    if (tagStart > lastIndex) {
      result.push({ type: "text", value: value.slice(lastIndex, tagStart) });
    }
    result.push({
      type: "link",
      url: `tag://${encodeURIComponent(tag.toLowerCase())}`,
      title: null,
      children: [{ type: "text", value: `#${tag}` }],
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
    TAG_RE.lastIndex = 0;
    if (child.type === "text" && "value" in child && TAG_RE.test((child as TextNode).value)) {
      newChildren.push(...expandText((child as TextNode).value));
    } else {
      walkNode(child);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

export function remarkTags() {
  return (tree: MdastNode) => {
    walkNode(tree);
  };
}
