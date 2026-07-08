import { useEffect, useState } from "react";
import { Logo } from "../Logo";
import "./Workspace.css";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface TopBarProps {
  vaultName: string;
  noteTitle: string | null;
  syncStatus: "saved" | "saving" | "unsaved" | "idle";
  leftOpen: boolean;
  rightOpen: boolean;
  onOpenPalette: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

const SYNC_MAP = {
  saved: { color: "var(--success)", label: "Synced", pulse: false },
  idle: { color: "var(--success)", label: "Synced", pulse: false },
  saving: { color: "var(--warning)", label: "Syncing…", pulse: true },
  unsaved: { color: "var(--warning)", label: "Pending", pulse: false },
} as const;

export function TopBar({
  vaultName,
  noteTitle,
  syncStatus,
  leftOpen,
  rightOpen,
  onOpenPalette,
  onToggleLeft,
  onToggleRight,
}: TopBarProps) {
  const sync = SYNC_MAP[syncStatus];

  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="topbar-logo">
        <Logo size={19} variant="animated" />
      </div>
      <div className="topbar-crumbs">
        <span className="topbar-crumb-vault">{vaultName}</span>
        {noteTitle && (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="topbar-crumb-sep">
              <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
        {isTauri && <WindowControls />}
      </div>
    </div>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
    })().catch(() => {});
    return () => unlisten?.();
  }, []);

  const call = (action: "minimize" | "toggleMaximize" | "close") => async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  };

  // Collapsed to dots at rest, morphing to glyphs and widening on hover — the
  // dot span and glyph svg cross-fade via CSS driven by the --on class.
  const cls = `win-controls${hover ? " win-controls--on" : ""}`;
  const dot = <span className="win-dot" />;

  return (
    <>
      <span className="topbar-divider" />
      <div className={cls} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <button className="win-btn" onClick={call("minimize")} title="Minimize">
          {dot}
          <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="2.2" cy="5.5" r="1.3" fill="currentColor" />
            <path d="M4.6 5.5h4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <span className="win-sep" />
        <button className="win-btn" onClick={call("toggleMaximize")} title={maximized ? "Restore" : "Maximize"}>
          {dot}
          <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="2.2" cy="2.2" r="1.3" fill="currentColor" />
            <path
              d={maximized ? "M3.6 3.6h5.2v5.2H3.6z M2.2 7V2.2H7" : "M2.2 2.2h6.6v6.6H2.2z"}
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>
        <span className="win-sep" />
        <button className="win-btn win-btn--close" onClick={call("close")} title="Close">
          {dot}
          <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2.4 2.4l6.2 6.2M8.6 2.4L2.4 8.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
          </svg>
        </button>
      </div>
    </>
  );
}
