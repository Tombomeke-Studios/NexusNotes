import { useState } from "react";
import type { TagTreeNode } from "../../lib/tagTree";

interface TagTreeProps {
  nodes: TagTreeNode[];
  filterTags: string[];
  onToggleTag: (tag: string) => void;
  onRenameTag: (tag: string) => void;
}

/**
 * Nested tag panel (#154): renders the tag hierarchy with collapsible groups,
 * click-to-filter, and a rename action per tag. Grouping-only nodes (a parent
 * segment never tagged on its own) aren't clickable filters.
 */
export function TagTree({ nodes, filterTags, onToggleTag, onRenameTag }: TagTreeProps) {
  return (
    <div className="tag-tree">
      {nodes.map((node) => (
        <TagTreeItem
          key={node.path}
          node={node}
          depth={0}
          filterTags={filterTags}
          onToggleTag={onToggleTag}
          onRenameTag={onRenameTag}
        />
      ))}
    </div>
  );
}

function TagTreeItem({
  node,
  depth,
  filterTags,
  onToggleTag,
  onRenameTag,
}: {
  node: TagTreeNode;
  depth: number;
  filterTags: string[];
  onToggleTag: (tag: string) => void;
  onRenameTag: (tag: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const active = filterTags.includes(node.path);
  const taggable = node.count > 0;

  return (
    <div className="tag-tree-branch">
      <div className="tag-tree-row" style={{ paddingLeft: 4 + depth * 12 }}>
        {hasChildren ? (
          <button
            className={`tag-tree-toggle${open ? " tag-tree-toggle--open" : ""}`}
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="tag-tree-toggle tag-tree-toggle--leaf" />
        )}
        <button
          className={`tag-tree-label${active ? " tag-tree-label--active" : ""}${taggable ? "" : " tag-tree-label--group"}`}
          onClick={() => taggable && onToggleTag(node.path)}
          onContextMenu={(e) => {
            // Rename works on any node, incl. grouping-only parents (it cascades
            // to children); filtering is only offered for directly-tagged nodes.
            e.preventDefault();
            onRenameTag(node.path);
          }}
          title={
            taggable
              ? `#${node.path} — click to filter, right-click to rename`
              : `#${node.path} — right-click to rename`
          }
        >
          <span className="tag-tree-name">{node.segment}</span>
          <span className="tag-tree-count">{node.total}</span>
        </button>
      </div>
      {hasChildren && open && (
        <div className="tag-tree-children">
          {node.children.map((child) => (
            <TagTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              filterTags={filterTags}
              onToggleTag={onToggleTag}
              onRenameTag={onRenameTag}
            />
          ))}
        </div>
      )}
    </div>
  );
}
