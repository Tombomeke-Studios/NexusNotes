import { useState } from "react";
import type { TreeNode, Vault } from "../../lib/types";
import "./Sidebar.css";

interface SidebarProps {
  vaults: Vault[];
  activeVaultId: string | null;
  tree: TreeNode[];
  activeNoteId: string | null;
  onSelectVault: (id: string) => void;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onCreateVault: (name: string) => void;
}

export function Sidebar({
  vaults,
  activeVaultId,
  tree,
  activeNoteId,
  onSelectVault,
  onSelectNote,
  onCreateNote,
  onCreateVault,
}: SidebarProps) {
  const [newVaultName, setNewVaultName] = useState("");
  const [showNewVault, setShowNewVault] = useState(false);

  const handleCreateVault = () => {
    if (newVaultName.trim()) {
      onCreateVault(newVaultName.trim());
      setNewVaultName("");
      setShowNewVault(false);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">NexusNotes</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Vaults</span>
          <button
            className="sidebar-action-btn"
            onClick={() => setShowNewVault(!showNewVault)}
            title="New vault"
          >
            +
          </button>
        </div>

        {showNewVault && (
          <div className="sidebar-new-item">
            <input
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateVault()}
              placeholder="Vault name..."
              autoFocus
            />
          </div>
        )}

        {vaults.map((v) => (
          <button
            key={v.id}
            className={`sidebar-vault ${v.id === activeVaultId ? "active" : ""}`}
            onClick={() => onSelectVault(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>

      {activeVaultId && (
        <div className="sidebar-section sidebar-files">
          <div className="sidebar-section-header">
            <span>Notes</span>
            <button
              className="sidebar-action-btn"
              onClick={onCreateNote}
              title="New note"
            >
              +
            </button>
          </div>

          <div className="sidebar-tree">
            {tree.map((node) => (
              <TreeItem
                key={node.path + node.name}
                node={node}
                activeNoteId={activeNoteId}
                onSelectNote={onSelectNote}
                depth={0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TreeItem({
  node,
  activeNoteId,
  onSelectNote,
  depth,
}: {
  node: TreeNode;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "folder") {
    return (
      <div className="tree-folder">
        <button
          className="tree-item tree-folder-label"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="tree-icon">{expanded ? "v" : ">"}</span>
          {node.name}
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path + child.name}
              node={child}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={`tree-item tree-note ${node.noteId === activeNoteId ? "active" : ""}`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => node.noteId && onSelectNote(node.noteId)}
    >
      {node.name}
    </button>
  );
}
