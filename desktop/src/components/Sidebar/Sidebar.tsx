import { useState } from "react";
import type { TreeNode, Vault } from "../../lib/types";
import type { SortBy, SearchHit } from "../../lib/noteFilter";
import { ROOT_FOLDER } from "../../lib/noteFilter";
import "./Sidebar.css";

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    className={`tree-chevron ${expanded ? "tree-chevron--expanded" : ""}`}
  >
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FolderIcon = ({ active }: { active?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`tree-icon${active ? " tree-icon--accent" : ""}`}>
    <path
      d="M2 4.5A1.5 1.5 0 013.5 3h2.6a1.5 1.5 0 011.2.6l.6.8a1.5 1.5 0 001.2.6h3.4A1.5 1.5 0 0114 6.5V12a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="tree-icon">
    <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface SidebarProps {
  view: "files" | "search";
  vaults: Vault[];
  activeVaultId: string | null;
  tree: TreeNode[];
  activeNoteId: string | null;
  tagCounts: Array<{ tag: string; count: number }>;
  folders: string[];
  filterTags: string[];
  filterFolder: string | null;
  sortBy: SortBy;
  searchQuery: string;
  searchHits: SearchHit[];
  onSelectVault: (id: string) => void;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onCreateVault: (name: string) => void;
  onToggleTag: (tag: string) => void;
  onSetFolder: (folder: string | null) => void;
  onSetSort: (sort: SortBy) => void;
  onClearFilters: () => void;
  onSearchChange: (query: string) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
}

export function Sidebar({
  view,
  vaults,
  activeVaultId,
  tree,
  activeNoteId,
  tagCounts,
  folders,
  filterTags,
  filterFolder,
  sortBy,
  searchQuery,
  searchHits,
  onSelectVault,
  onSelectNote,
  onCreateNote,
  onCreateVault,
  onToggleTag,
  onSetFolder,
  onSetSort,
  onClearFilters,
  onSearchChange,
  onNoteContextMenu,
}: SidebarProps) {
  const [showVaults, setShowVaults] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [showNewVault, setShowNewVault] = useState(false);

  const activeVault = vaults.find((v) => v.id === activeVaultId);
  const filterCount = filterTags.length + (filterFolder ? 1 : 0);
  const hasFilter = filterCount > 0;

  const handleCreateVault = () => {
    if (newVaultName.trim()) {
      onCreateVault(newVaultName.trim());
      setNewVaultName("");
      setShowNewVault(false);
      setShowVaults(false);
    }
  };

  if (view === "search") {
    return (
      <div className="sidebar">
        <div className="sidebar-search-head">
          <div className="sidebar-search-title">Search</div>
          <div className="sidebar-search-box">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              placeholder="Search in vault..."
            />
          </div>
        </div>
        <div className="sidebar-search-count">
          {!searchQuery.trim()
            ? "Type to search this vault"
            : `${searchHits.length} result${searchHits.length === 1 ? "" : "s"}`}
        </div>
        <div className="sidebar-search-results">
          {searchHits.map((hit) => (
            <button key={hit.note.id} className="sidebar-search-result" onClick={() => onSelectNote(hit.note.id)}>
              <span className="sidebar-search-result-title">{hit.note.title}</span>
              <span className="sidebar-search-result-snippet">{hit.snippet}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <button className="sidebar-vault-btn" onClick={() => setShowVaults((v) => !v)}>
          <span className="sidebar-vault-name">{activeVault?.name ?? "Vault"}</span>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="sidebar-head-actions">
          <button
            className={`sidebar-action-btn${hasFilter || sortBy !== "updated" ? " sidebar-action-btn--accent" : ""}${showFilter ? " sidebar-action-btn--open" : ""}`}
            onClick={() => setShowFilter((v) => !v)}
            title="Filter & sort"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 3.5h11l-4.2 5v3.8l-2.6-1.5V8.5l-4.2-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {filterCount > 0 && <span className="sidebar-filter-count">{filterCount}</span>}
          </button>
          <button className="sidebar-action-btn" onClick={onCreateNote} title="New note (Ctrl+N)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M9.5 2.5h-5A1.5 1.5 0 003 4v8a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 12V6l-3.5-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {showVaults && (
        <div className="sidebar-vault-list">
          {vaults.map((v) => (
            <button
              key={v.id}
              className={`sidebar-vault-item${v.id === activeVaultId ? " active" : ""}`}
              onClick={() => {
                onSelectVault(v.id);
                setShowVaults(false);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M8 2v12M2 4l6 2 6-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <span>{v.name}</span>
              {v.id === activeVaultId && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="sidebar-vault-check">
                  <path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          {showNewVault ? (
            <div className="sidebar-new-vault">
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
          ) : (
            <button className="sidebar-vault-item sidebar-vault-item--new" onClick={() => setShowNewVault(true)}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              New vault
            </button>
          )}
        </div>
      )}

      {showFilter && (
        <>
          <div className="sidebar-filter-overlay" onClick={() => setShowFilter(false)} />
          <div className="sidebar-filter-pop">
            <div className="sidebar-filter-pop-head">
              <span>Filter notes</span>
              <button
                className={`sidebar-filter-clear${hasFilter ? " sidebar-filter-clear--active" : ""}`}
                onClick={onClearFilters}
              >
                Clear all
              </button>
            </div>
            <div className="sidebar-filter-label">Sort by</div>
            <div className="sidebar-filter-sort">
              <button
                className={sortBy === "updated" ? "active" : ""}
                onClick={() => onSetSort("updated")}
              >
                Last updated
              </button>
              <button
                className={sortBy === "title" ? "active" : ""}
                onClick={() => onSetSort("title")}
              >
                A to Z
              </button>
            </div>
            <div className="sidebar-filter-label">Folder</div>
            <div className="sidebar-chip-row">
              <button
                className={`sidebar-chip${!filterFolder ? " sidebar-chip--active" : ""}`}
                onClick={() => onSetFolder(null)}
              >
                All
              </button>
              <button
                className={`sidebar-chip${filterFolder === ROOT_FOLDER ? " sidebar-chip--active" : ""}`}
                onClick={() => onSetFolder(ROOT_FOLDER)}
              >
                Root
              </button>
              {folders.map((f) => (
                <button
                  key={f}
                  className={`sidebar-chip${filterFolder === f ? " sidebar-chip--active" : ""}`}
                  onClick={() => onSetFolder(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="sidebar-filter-label">Tags &middot; match any</div>
            <div className="sidebar-chip-row">
              {tagCounts.map(({ tag, count }) => (
                <button
                  key={tag}
                  className={`sidebar-chip${filterTags.includes(tag) ? " sidebar-chip--active" : ""}`}
                  onClick={() => onToggleTag(tag)}
                >
                  #{tag}
                  <span className="sidebar-chip-count">{count}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {hasFilter && (
        <div className="sidebar-filter-banner">
          <span>
            Filtering:{" "}
            {[filterFolder === ROOT_FOLDER ? "Root notes" : filterFolder, ...filterTags.map((t) => `#${t}`)]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button onClick={onClearFilters} title="Clear filters">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <div className="sidebar-tree">
        {tree.length === 0 && (
          <div className="sidebar-empty">
            {hasFilter ? "No notes match the current filter" : "No notes yet. Create your first note."}
          </div>
        )}
        {tree.map((node) => (
          <TreeItem
            key={node.path + node.name}
            node={node}
            activeNoteId={activeNoteId}
            onSelectNote={onSelectNote}
            onNoteContextMenu={onNoteContextMenu}
            depth={0}
          />
        ))}
      </div>

      {tagCounts.length > 0 && (
        <div className="sidebar-tags">
          <div className="sidebar-tags-label">Tags</div>
          <div className="sidebar-chip-row">
            {tagCounts.map(({ tag, count }) => (
              <button
                key={tag}
                className={`sidebar-chip${filterTags.includes(tag) ? " sidebar-chip--active" : ""}`}
                onClick={() => onToggleTag(tag)}
              >
                #{tag}
                <span className="sidebar-chip-count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function countNotes(node: TreeNode): number {
  if (node.type === "note") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countNotes(child), 0);
}

function TreeItem({
  node,
  activeNoteId,
  onSelectNote,
  onNoteContextMenu,
  depth,
}: {
  node: TreeNode;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "folder") {
    return (
      <div className="tree-folder">
        <button
          className="tree-item tree-folder-label"
          style={{ paddingLeft: `${8 + depth * 19}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon expanded={expanded} />
          <FolderIcon active={expanded} />
          <span className="tree-item-name">{node.name}</span>
          <span className="tree-folder-count">{countNotes(node)}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path + child.name}
              node={child}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              onNoteContextMenu={onNoteContextMenu}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={`tree-item tree-note ${node.noteId === activeNoteId ? "active" : ""}`}
      style={{ paddingLeft: `${8 + depth * 19}px` }}
      title={node.name}
      onClick={() => node.noteId && onSelectNote(node.noteId)}
      onContextMenu={(e) => {
        if (node.noteId && onNoteContextMenu) {
          e.preventDefault();
          onNoteContextMenu(e, node.noteId);
        }
      }}
    >
      <FileIcon />
      <span className="tree-item-name">{node.name}</span>
    </button>
  );
}
