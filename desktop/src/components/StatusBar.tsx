import { useMemo } from "react";
import { extractTags } from "../lib/tags";

interface StatusBarProps {
  content: string;
  saveStatus: "saved" | "saving" | "unsaved" | "idle";
  noteTitle: string | null;
  onTagClick?: (tag: string) => void;
}

export function StatusBar({ content, saveStatus, noteTitle, onTagClick }: StatusBarProps) {
  const stats = useMemo(() => {
    if (!noteTitle) return null;
    const lines = content.split("\n").length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    return { lines, words, chars };
  }, [content, noteTitle]);

  const tags = useMemo(() => (noteTitle ? extractTags(content) : []), [content, noteTitle]);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {noteTitle && (
          <span className={`status-indicator status-indicator--${saveStatus}`}>
            <span className="status-dot" />
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "unsaved" && "Unsaved"}
            {saveStatus === "idle" && "Ready"}
          </span>
        )}
        {tags.length > 0 && (
          <div className="status-tags">
            {tags.map((tag) => (
              <button
                key={tag}
                className="status-tag"
                onClick={() => onTagClick?.(tag)}
                title={`Filter by #${tag}`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="status-bar-right">
        {stats && (
          <>
            <span className="status-stat">{stats.words} words</span>
            <span className="status-stat">{stats.chars} chars</span>
            <span className="status-stat">{stats.lines} lines</span>
          </>
        )}
      </div>
    </div>
  );
}
