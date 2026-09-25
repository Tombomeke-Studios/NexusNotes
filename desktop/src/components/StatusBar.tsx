import { useMemo } from "react";
import { wordCount } from "../lib/stats";
import type { ViewMode } from "../lib/prefs";
import type { SaveError, SaveErrorKind, SaveStatus } from "../lib/useNoteSave";

interface StatusBarProps {
  content: string;
  saveStatus: SaveStatus;
  /** Why the open note's last save failed; the full message is the tooltip. */
  saveError?: SaveError | null;
  hasNote: boolean;
  lastSyncLabel: string | null;
  line: number;
  col: number;
  viewMode: ViewMode;
  onCycleView: () => void;
}

const MODE_LABELS: Record<ViewMode, string> = {
  edit: "Edit",
  split: "Split",
  preview: "Reading",
};

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved",
  conflict: "Conflict",
  idle: "Ready",
};

const ERROR_HINTS: Record<SaveErrorKind, string> = {
  conflict: "Not saved",
  network: "Offline, retrying",
  failed: "Save failed",
};

export function StatusBar({
  content,
  saveStatus,
  saveError = null,
  hasNote,
  lastSyncLabel,
  line,
  col,
  viewMode,
  onCycleView,
}: StatusBarProps) {
  const words = useMemo(() => (hasNote ? wordCount(content) : 0), [content, hasNote]);
  // A retry in flight shows plain "Saving…"; the hint returns if it fails again.
  const hint =
    saveError && (saveStatus === "unsaved" || saveStatus === "conflict") ? ERROR_HINTS[saveError.kind] : null;

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {hasNote && (
          <span
            className={`status-indicator status-indicator--${saveStatus}`}
            title={hint ? saveError?.message : undefined}
          >
            <span className="status-dot" key={saveStatus} />
            {SAVE_LABELS[saveStatus]}
            {hint && <span className="status-indicator-hint">&middot; {hint}</span>}
          </span>
        )}
        {lastSyncLabel && (
          <>
            <span className="status-sep">&middot;</span>
            <span className="status-stat">Synced {lastSyncLabel}</span>
          </>
        )}
      </div>
      <div className="status-bar-right">
        {hasNote && (
          <>
            <span className="status-stat">
              Ln {line}, Col {col}
            </span>
            <span className="status-stat">{words} words</span>
            <span className="status-stat">{content.length} chars</span>
            <button
              className="status-mode-btn"
              onClick={onCycleView}
              title="Cycle view (Ctrl+E)"
            >
              {MODE_LABELS[viewMode]}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
