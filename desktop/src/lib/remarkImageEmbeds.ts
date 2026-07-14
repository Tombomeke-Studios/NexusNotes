/**
 * Turns Obsidian-style `![[filename]]` embeds into mdast image nodes with an
 * `attachment://filename` url (#153). Runs BEFORE remarkWikilinks so the inner
 * `[[filename]]` isn't consumed as a wikilink. A custom `img` renderer resolves
 * the url to the actual attachment for the current note.
 */

const EMBED_RE = /!\[\[([^[\]|#]+?)(?:\|([^\]]+?))?\]\]/g;

interface ImageNode {
  type: "image";
  url: string;
  alt: string;
  title: null;
}
interface TextNode {
  type: "text";
  value: string;
}
type MdastNode = { type: string; value?: string; children?: MdastNode[] };

/** Splits a text value into text/image nodes around `![[...]]` embeds. */
export function expandEmbeds(value: string): Array<ImageNode | TextNode> {
  const out: Array<ImageNode | TextNode> = [];
  let last = 0;
  EMBED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    const name = m[1].trim();
    const alias = m[2]?.trim() ?? "";
    out.push({ type: "image", url: `attachment://${encodeURIComponent(name)}`, alt: alias || name, title: null });
    last = m.index + m[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdastNode): void {
  if (!node.children) return;
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string" && EMBED_RE.test(child.value)) {
      next.push(...(expandEmbeds(child.value) as MdastNode[]));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkImageEmbeds() {
  return (tree: MdastNode) => walk(tree);
}
