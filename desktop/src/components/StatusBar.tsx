import { useMemo } from "react";
import { wordCount } from "../lib/stats";
import type { ViewMode } from "../lib/prefs";

interface StatusBarProps {
  content: string;
  saveStatus: "saved" | "saving" | "unsaved" | "idle";
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

export function StatusBar({
  content,
  saveStatus,
  hasNote,
  lastSyncLabel,
  line,
  col,
  viewMode,
  onCycleView,
}: StatusBarProps) {
  const words = useMemo(() => (hasNote ? wordCount(content) : 0), [content, hasNote]);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {hasNote && (
          <span className={`status-indicator status-indicator--${saveStatus}`}>
            <span className="status-dot" key={saveStatus} />
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "unsaved" && "Unsaved"}
            {saveStatus === "idle" && "Ready"}
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
