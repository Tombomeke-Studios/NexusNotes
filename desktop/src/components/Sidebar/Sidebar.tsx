import { useState } from "react";
import type { TreeNode, Vault } from "../../lib/types";
import "./Sidebar.css";

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`tree-icon ${expanded ? "tree-icon--expanded" : ""}`}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="tree-note-icon">
    <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const VaultIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sidebar-vault-icon">
    <path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M8 2v12M2 4l6 2 6-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

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
        <div className="sidebar-logo-icon">N</div>
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {showNewVault && (
          <div className="sidebar-new-item">
            <input
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateVault();
                if (e.key === "Escape") setShowNewVault(false);
              }}
              placeholder="Vault name..."
              autoFocus
            />
          </div>
        )}

        {vaults.length === 0 && !showNewVault && (
          <div className="sidebar-empty">No vaults yet. Create one to get started.</div>
        )}

        {vaults.map((v) => (
          <button
            key={v.id}
            className={`sidebar-vault ${v.id === activeVaultId ? "active" : ""}`}
            onClick={() => onSelectVault(v.id)}
          >
            <VaultIcon />
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
              title="New note (Ctrl+N)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {tree.length === 0 && (
            <div className="sidebar-empty">No notes yet. Create your first note.</div>
          )}

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
          style={{ paddingLeft: `${14 + depth * 16}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon expanded={expanded} />
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
      style={{ paddingLeft: `${14 + depth * 16}px` }}
      onClick={() => node.noteId && onSelectNote(node.noteId)}
    >
      <FileIcon />
      {node.name}
    </button>
  );
}
