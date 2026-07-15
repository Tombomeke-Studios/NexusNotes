import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TreeNode, Vault } from "../../lib/types";
import type { SortBy, SearchHit } from "../../lib/noteFilter";
import { ROOT_FOLDER } from "../../lib/noteFilter";
import { buildTagTree } from "../../lib/tagTree";
import { ContextMenu } from "../Workspace/ContextMenu";
import { TagTree } from "./TagTree";
import "./Sidebar.css";

/** Drag-and-drop context threaded through the tree so notes can be moved. */
interface TreeDnd {
  dragNoteId: string | null;
  setDragNoteId: (id: string | null) => void;
  dropFolder: string | null;
  setDropFolder: (path: string | null) => void;
  onMoveNote: (noteId: string, folderPath: string) => void;
  onFolderContextMenu: (e: React.MouseEvent, path: string) => void;
  /** While Shift is held, notes aren't draggable so Shift+drag can marquee. */
  shiftHeld: boolean;
}

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
  /** Ctrl/Cmd click toggles a note in the multi-selection. */
  onNoteClick: (e: React.MouseEvent, id: string) => void;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onCreateNote: () => void;
  onCreateFolder: (path: string) => void;
  onMoveNote: (noteId: string, folderPath: string) => void;
  onDeleteFolder: (path: string) => void;
  /** Bump to pop open the "new folder" input from outside (e.g. right-click). */
  newFolderNonce?: number;
  /** Opens the app-level "new vault" dialog (name + encryption opt-in). */
  onRequestNewVault: () => void;
  /** Opens the sharing panel for a vault (#55). */
  onShareVault: (vaultId: string) => void;
  /** Opens the linked-files panel for a vault (#60-64). */
  onOpenLinks: (vaultId: string) => void;
  onToggleTag: (tag: string) => void;
  /** Rename a tag (and its nested children) across every note (#154). */
  onRenameTag: (tag: string) => void;
  onSetFolder: (folder: string | null) => void;
  onSetSort: (sort: SortBy) => void;
  onClearFilters: () => void;
  onSearchChange: (query: string) => void;
  onSignOut: () => void;
  starredIds: Set<string>;
  /** Starred notes for the sidebar section, in star order. */
  starredNotes: Array<{ id: string; title: string }>;
  /** Recently opened notes for the active vault, most recent first. */
  recentNotes: Array<{ id: string; title: string }>;
  /** Note with unsaved changes (shows a dot in the tree). */
  unsavedNoteId?: string | null;
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
  onNoteClick,
  selectedIds,
  onSetSelectedIds,
  onCreateNote,
  onCreateFolder,
  onMoveNote,
  onDeleteFolder,
  newFolderNonce,
  onRequestNewVault,
  onShareVault,
  onOpenLinks,
  onToggleTag,
  onRenameTag,
  onSetFolder,
  onSetSort,
  onClearFilters,
  onSearchChange,
  onSignOut,
  starredIds,
  starredNotes,
  recentNotes,
  unsavedNoteId,
  onNoteContextMenu,
}: SidebarProps) {
  const [showVaults, setShowVaults] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [starredOpen, setStarredOpen] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; base: Set<string> } | null>(null);

  // Track Shift so notes stop being draggable while a marquee (drag-to-select)
  // is possible.
  useEffect(() => {
    const kd = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(true);
    const ku = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  // Shift + drag draws a selection box; every note it covers is added to the
  // selection that was present when the drag began.
  const beginMarquee = (e: React.PointerEvent) => {
    if (!e.shiftKey && !shiftHeld) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, base: new Set(selectedIds) };
    marqueeStart.current = start;
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
    const move = (ev: PointerEvent) => {
      const x = Math.min(start.x, ev.clientX);
      const y = Math.min(start.y, ev.clientY);
      const w = Math.abs(ev.clientX - start.x);
      const h = Math.abs(ev.clientY - start.y);
      setMarquee({ x, y, w, h });
      const hit = new Set(start.base);
      treeRef.current?.querySelectorAll<HTMLElement>("[data-note-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) {
          const id = el.getAttribute("data-note-id");
          if (id) hit.add(id);
        }
      });
      onSetSelectedIds(hit);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      marqueeStart.current = null;
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (name) onCreateFolder(name);
    setNewFolderName("");
    setShowNewFolder(false);
  };

  // Open the new-folder input when asked from outside (workspace right-click).
  useEffect(() => {
    if (newFolderNonce) {
      setNewFolderName("");
      setShowNewFolder(true);
    }
  }, [newFolderNonce]);

  const dnd: TreeDnd = {
    dragNoteId,
    setDragNoteId,
    dropFolder,
    setDropFolder,
    onMoveNote,
    onFolderContextMenu: (e, path) => {
      e.preventDefault();
      setFolderMenu({
        x: Math.min(e.clientX, window.innerWidth - 190),
        y: Math.min(e.clientY, window.innerHeight - 110),
        path,
      });
    },
    shiftHeld,
  };

  const tagTree = useMemo(() => buildTagTree(tagCounts), [tagCounts]);
  const activeVault = vaults.find((v) => v.id === activeVaultId);
  const filterCount = filterTags.length + (filterFolder ? 1 : 0);
  const hasFilter = filterCount > 0;

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
          {activeVault?.encryption === "e2ee" && (
            <svg className="sidebar-vault-lock" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-label="Encrypted vault">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          )}
          <span className="sidebar-vault-name">{activeVault?.name ?? "Vault"}</span>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="sidebar-head-actions">
          <button
            className={`sidebar-action-btn${hasFilter || sortBy !== "title" ? " sidebar-action-btn--accent" : ""}${showFilter ? " sidebar-action-btn--open" : ""}`}
            onClick={() => setShowFilter((v) => !v)}
            title="Filter & sort"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 3.5h11l-4.2 5v3.8l-2.6-1.5V8.5l-4.2-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {filterCount > 0 && <span className="sidebar-filter-count">{filterCount}</span>}
          </button>
          <button
            className="sidebar-action-btn"
            onClick={() => {
              setShowNewFolder(true);
              setNewFolderName("");
            }}
            title="New folder"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 4.5A1.5 1.5 0 013.5 3h2.6a1.5 1.5 0 011.2.6l.6.8a1.5 1.5 0 001.2.6h3.4A1.5 1.5 0 0114 6.5V12a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 8v3M6.5 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
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
            <div key={v.id} className={`sidebar-vault-row${v.id === activeVaultId ? " active" : ""}`}>
              <button
                className="sidebar-vault-item"
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
                {v.role && v.role !== "owner" && (
                  <span className="sidebar-vault-role" title={`Shared with you (${v.role})`}>{v.role}</span>
                )}
                {v.encryption === "e2ee" && (
                  <svg className="sidebar-vault-lock" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-label="Encrypted vault">
                    <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                )}
                {v.id === activeVaultId && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="sidebar-vault-check">
                    <path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <button
                className="sidebar-vault-share"
                title="Linked files"
                onClick={() => {
                  setShowVaults(false);
                  onOpenLinks(v.id);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M6.5 9.5l3-3M7 4.5l.8-.8a2.4 2.4 0 013.5 3.4l-.9.9M9 11.5l-.8.8a2.4 2.4 0 01-3.5-3.4l.9-.9"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <button
                className="sidebar-vault-share"
                title={v.role && v.role !== "owner" ? "Sharing & members" : "Share vault"}
                onClick={() => {
                  setShowVaults(false);
                  onShareVault(v.id);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="4" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="12" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5.6 7.1l4.8-2.2M5.6 8.9l4.8 2.2" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </div>
          ))}
          <button
            className="sidebar-vault-item sidebar-vault-item--new"
            onClick={() => {
              setShowVaults(false);
              onRequestNewVault();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New vault
          </button>
          <div className="sidebar-vault-sep" />
          <button className="sidebar-vault-item sidebar-vault-item--signout" onClick={onSignOut}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
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

      {starredNotes.length > 0 && (
        <div className="sidebar-recent">
          <button className="sidebar-recent-head" onClick={() => setStarredOpen((o) => !o)}>
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              className={`sidebar-recent-chevron${starredOpen ? " sidebar-recent-chevron--open" : ""}`}
            >
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Starred
          </button>
          {starredOpen &&
            starredNotes.map((n) => (
              <button
                key={n.id}
                className={`sidebar-recent-item${n.id === activeNoteId ? " sidebar-recent-item--active" : ""}`}
                onClick={(e) => onNoteClick(e, n.id)}
                title={n.title}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6L8 1.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <span className="sidebar-recent-title">{n.title}</span>
              </button>
            ))}
        </div>
      )}

      {recentNotes.length > 0 && (
        <div className="sidebar-recent">
          <button className="sidebar-recent-head" onClick={() => setRecentOpen((o) => !o)}>
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              className={`sidebar-recent-chevron${recentOpen ? " sidebar-recent-chevron--open" : ""}`}
            >
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Recent
          </button>
          {recentOpen &&
            recentNotes.map((n) => (
              <button
                key={n.id}
                className={`sidebar-recent-item${n.id === activeNoteId ? " sidebar-recent-item--active" : ""}`}
                onClick={(e) => onNoteClick(e, n.id)}
                title={n.title}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <span className="sidebar-recent-title">{n.title}</span>
              </button>
            ))}
        </div>
      )}

      <div
        ref={treeRef}
        className={`sidebar-tree${dragNoteId && dropFolder === "" ? " sidebar-tree--drop" : ""}`}
        onPointerDown={beginMarquee}
        onClick={(e) => {
          // Click on empty space deselects everything (but keep the selection
          // when a modifier is held, e.g. right after a Shift+drag).
          const t = e.target as HTMLElement;
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !t.closest("[data-note-id]")) {
            onSetSelectedIds(new Set());
          }
        }}
        onDragOver={(e) => {
          if (dragNoteId) {
            e.preventDefault();
            setDropFolder("");
          }
        }}
        onDrop={(e) => {
          if (dragNoteId) {
            e.preventDefault();
            onMoveNote(dragNoteId, "");
          }
          setDropFolder(null);
          setDragNoteId(null);
        }}
      >
        {showNewFolder && (
          <div className="sidebar-new-folder">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setShowNewFolder(false);
              }}
              onBlur={handleCreateFolder}
              placeholder="Folder name..."
              autoFocus
            />
          </div>
        )}
        {tree.length === 0 && !showNewFolder && (
          <div className="sidebar-empty">
            {hasFilter ? "No notes match the current filter" : "No notes yet. Create your first note."}
          </div>
        )}
        {tree.map((node) => (
          <TreeItem
            key={node.path + node.name}
            node={node}
            activeNoteId={activeNoteId}
            selectedIds={selectedIds}
            starredIds={starredIds}
            unsavedNoteId={unsavedNoteId}
            onNoteClick={onNoteClick}
            onNoteContextMenu={onNoteContextMenu}
            dnd={dnd}
            depth={0}
          />
        ))}
      </div>

      {marquee &&
        createPortal(
          <div
            className="tree-marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />,
          document.body,
        )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          items={[
            {
              key: "subfolder",
              label: "New subfolder",
              onClick: () => {
                setNewFolderName(folderMenu.path + "/");
                setShowNewFolder(true);
              },
            },
            {
              key: "delete",
              label: "Delete folder",
              danger: true,
              onClick: () => onDeleteFolder(folderMenu.path),
            },
          ]}
        />
      )}

      {tagCounts.length > 0 && (
        <div className="sidebar-tags">
          <div className="sidebar-tags-label">Tags</div>
          <TagTree
            nodes={tagTree}
            filterTags={filterTags}
            onToggleTag={onToggleTag}
            onRenameTag={onRenameTag}
          />
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
  selectedIds,
  starredIds,
  unsavedNoteId,
  onNoteClick,
  onNoteContextMenu,
  dnd,
  depth,
}: {
  node: TreeNode;
  activeNoteId: string | null;
  selectedIds: Set<string>;
  starredIds: Set<string>;
  unsavedNoteId?: string | null;
  onNoteClick: (e: React.MouseEvent, id: string) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  dnd: TreeDnd;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "folder") {
    const isDropTarget = dnd.dragNoteId !== null && dnd.dropFolder === node.path;
    return (
      <div className="tree-folder">
        <button
          className={`tree-item tree-folder-label${isDropTarget ? " tree-item--drop" : ""}`}
          style={{ paddingLeft: `${8 + depth * 19}px` }}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => dnd.onFolderContextMenu(e, node.path)}
          onDragOver={(e) => {
            if (dnd.dragNoteId) {
              e.preventDefault();
              e.stopPropagation();
              dnd.setDropFolder(node.path);
            }
          }}
          onDrop={(e) => {
            if (dnd.dragNoteId) {
              e.preventDefault();
              e.stopPropagation();
              dnd.onMoveNote(dnd.dragNoteId, node.path);
            }
            dnd.setDropFolder(null);
            dnd.setDragNoteId(null);
          }}
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
              selectedIds={selectedIds}
              starredIds={starredIds}
              unsavedNoteId={unsavedNoteId}
              onNoteClick={onNoteClick}
              onNoteContextMenu={onNoteContextMenu}
              dnd={dnd}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  const isSelected = !!node.noteId && selectedIds.has(node.noteId);
  const isDragging =
    !!dnd.dragNoteId &&
    (dnd.dragNoteId === node.noteId ||
      (isSelected && selectedIds.has(dnd.dragNoteId)));
  return (
    <button
      className={`tree-item tree-note ${node.noteId === activeNoteId ? "active" : ""}${
        isSelected ? " tree-item--selected" : ""
      }${isDragging ? " tree-item--dragging" : ""}`}
      style={{ paddingLeft: `${8 + depth * 19}px` }}
      title={node.name}
      data-note-id={node.noteId}
      draggable={!!node.noteId && !dnd.shiftHeld}
      onDragStart={(e) => {
        if (!node.noteId) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.noteId);
        dnd.setDragNoteId(node.noteId);
      }}
      onDragEnd={() => {
        dnd.setDragNoteId(null);
        dnd.setDropFolder(null);
      }}
      onClick={(e) => node.noteId && onNoteClick(e, node.noteId)}
      onContextMenu={(e) => {
        if (node.noteId && onNoteContextMenu) {
          e.preventDefault();
          onNoteContextMenu(e, node.noteId);
        }
      }}
    >
      <FileIcon />
      <span className="tree-item-name">{node.name}</span>
      {node.noteId && node.noteId === unsavedNoteId && (
        <span className="tree-unsaved-dot" title="Unsaved changes" />
      )}
      {node.noteId && starredIds.has(node.noteId) && (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="tree-pin" aria-label="Starred">
          <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6L8 1.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
