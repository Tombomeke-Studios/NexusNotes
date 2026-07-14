/**
 * Groups flat `tag/subtag` names into a tree for the sidebar tag panel (#154).
 * A tag like `work/projects/x` nests under `work` › `projects` › `x`. Each
 * node carries its own note count plus a rolled-up total across descendants.
 */

export interface TagTreeNode {
  /** Last path segment, e.g. "projects". */
  segment: string;
  /** Full tag path from the root, e.g. "work/projects". */
  path: string;
  /** Notes carrying exactly this tag (0 for grouping-only nodes). */
  count: number;
  /** count plus every descendant's count. */
  total: number;
  children: TagTreeNode[];
}

/** Builds the tag tree from `{tag, count}` pairs (as from buildTagCounts). */
export function buildTagTree(tags: Array<{ tag: string; count: number }>): TagTreeNode[] {
  const roots: TagTreeNode[] = [];
  const byPath = new Map<string, TagTreeNode>();

  const ensure = (path: string): TagTreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const segment = slash < 0 ? path : path.slice(slash + 1);
    const node: TagTreeNode = { segment, path, count: 0, total: 0, children: [] };
    byPath.set(path, node);
    if (slash < 0) {
      roots.push(node);
    } else {
      ensure(path.slice(0, slash)).children.push(node);
    }
    return node;
  };

  for (const { tag, count } of tags) {
    ensure(tag).count = count;
  }

  // Roll up totals bottom-up and sort children by total desc, then name.
  const finalize = (node: TagTreeNode): number => {
    node.total = node.count + node.children.reduce((sum, c) => sum + finalize(c), 0);
    node.children.sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment));
    return node.total;
  };
  for (const root of roots) finalize(root);
  roots.sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment));

  return roots;
}
