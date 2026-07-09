import { Fragment } from "react";
import { Logo } from "../Logo";
import { WindowControls } from "./WindowControls";
import { isTauriWindow } from "../../lib/platform";
import "./Workspace.css";

interface TopBarProps {
  vaultName: string;
  noteTitle: string | null;
  /** Folder path of the active note ("" = root); shown between vault and title. */
  notePath?: string;
  syncStatus: "saved" | "saving" | "unsaved" | "idle";
  leftOpen: boolean;
  rightOpen: boolean;
  onOpenPalette: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onRequestClose?: () => void;
}

const CrumbSep = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="topbar-crumb-sep">
    <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SYNC_MAP = {
  saved: { color: "var(--success)", label: "Synced", pulse: false },
  idle: { color: "var(--success)", label: "Synced", pulse: false },
  saving: { color: "var(--warning)", label: "Syncing…", pulse: true },
  unsaved: { color: "var(--warning)", label: "Pending", pulse: false },
} as const;

export function TopBar({
  vaultName,
  noteTitle,
  notePath,
  syncStatus,
  leftOpen,
  rightOpen,
  onOpenPalette,
  onToggleLeft,
  onToggleRight,
  onRequestClose,
}: TopBarProps) {
  const sync = SYNC_MAP[syncStatus];
  const folderSegments = notePath ? notePath.split("/").filter(Boolean) : [];

  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="topbar-logo">
        <Logo size={19} variant="animated" />
      </div>
      <div className="topbar-crumbs">
        <span className="topbar-crumb-vault">{vaultName}</span>
        {noteTitle &&
          folderSegments.map((seg, i) => (
            <Fragment key={i}>
              <CrumbSep />
              <span className="topbar-crumb-folder">{seg}</span>
            </Fragment>
          ))}
        {noteTitle && (
          <>
            <CrumbSep />
            <span className="topbar-crumb-note">{noteTitle}</span>
          </>
        )}
      </div>

      <button className="topbar-search" onClick={onOpenPalette}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="topbar-search-label">Search notes and commands</span>
        <span className="topbar-kbd">Ctrl+P</span>
      </button>

      <div className="topbar-right">
        <span className="topbar-sync">
          <span
            className={`topbar-sync-dot${sync.pulse ? " topbar-sync-dot--pulse" : ""}`}
            style={{ background: sync.color }}
          />
          {sync.label}
        </span>
        <span className="topbar-divider" />
        <button
          className={`topbar-btn${leftOpen ? " topbar-btn--on" : ""}`}
          onClick={onToggleLeft}
          title="Toggle sidebar (Ctrl+B)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
            <rect x="2.5" y="3.5" width="2.6" height="9" rx="1" fill={leftOpen ? "currentColor" : "none"} />
          </svg>
        </button>
        <button
          className={`topbar-btn${rightOpen ? " topbar-btn--on" : ""}`}
          onClick={onToggleRight}
          title="Toggle side panel (Ctrl+.)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10 2.5v11" stroke="currentColor" strokeWidth="1.3" />
            <rect x="10.9" y="3.5" width="2.6" height="9" rx="1" fill={rightOpen ? "currentColor" : "none"} />
          </svg>
        </button>
        {isTauriWindow && (
          <>
            <span className="topbar-divider" />
            <WindowControls onRequestClose={onRequestClose} />
          </>
        )}
      </div>
    </div>
  );
}
