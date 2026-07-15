// Renders Obsidian-style callout blocks (#223): a blockquote whose first line
// is `[!TYPE]` (optionally `[!TYPE] Custom title`) becomes a styled callout.
// Example:
//   > [!WARNING] Heads up
//   > body text
// The transform rewrites the blockquote into a `div.callout.callout-<type>`
// carrying a `data-callout` attribute, and prepends a `div.callout-title`.
const CALLOUT_RE = /^\[!(\w+)\]([+-]?)[ \t]*(.*)$/;

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

// Title-cases a callout type for the default heading ("warning" -> "Warning").
function titleFor(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function transformBlockquote(node: MdNode): void {
  const firstPara = node.children?.[0];
  if (!firstPara || firstPara.type !== "paragraph" || !firstPara.children?.length) return;

  const firstText = firstPara.children[0];
  if (firstText.type !== "text" || typeof firstText.value !== "string") return;

  // Only the first physical line carries the callout marker.
  const newlineIdx = firstText.value.indexOf("\n");
  const firstLine = newlineIdx === -1 ? firstText.value : firstText.value.slice(0, newlineIdx);
  const match = CALLOUT_RE.exec(firstLine);
  if (!match) return;

  const type = match[1].toLowerCase();
  const customTitle = match[3].trim();

  // Strip the marker line from the leading text node; keep any content that
  // followed it on later lines of the same node.
  const rest = newlineIdx === -1 ? "" : firstText.value.slice(newlineIdx + 1);
  if (rest) {
    firstText.value = rest;
  } else {
    firstPara.children.shift();
    // Drop a now-leading hard/soft break so the body doesn't start blank.
    if (firstPara.children[0]?.type === "break") firstPara.children.shift();
    if (firstPara.children.length === 0) node.children!.shift();
  }

  node.data = {
    hName: "div",
    hProperties: {
      className: ["callout", `callout-${type}`],
      "data-callout": type,
    },
  };

  const titleNode: MdNode = {
    type: "paragraph",
    data: { hName: "div", hProperties: { className: ["callout-title"] } },
    children: [{ type: "text", value: customTitle || titleFor(type) }],
  };
  node.children!.unshift(titleNode);
}

function walk(node: MdNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "blockquote") transformBlockquote(child);
    walk(child);
  }
}

export function remarkCallouts() {
  return (tree: MdNode) => {
    walk(tree);
  };
}
