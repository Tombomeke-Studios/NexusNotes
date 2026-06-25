import { useState, useEffect } from "react";
import { notes as notesApi } from "../../lib/api";
import type { BacklinkNote } from "../../lib/types";

interface BacklinksPanelProps {
  noteId: string | null;
  onNavigate: (noteId: string) => void;
}

export function BacklinksPanel({ noteId, onNavigate }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkNote[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId) {
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    notesApi
      .backlinks(noteId)
      .then((result) => {
        if (!cancelled) setBacklinks(result ?? []);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (!noteId) return null;

  return (
    <div className="backlinks-panel">
      <button
        className="backlinks-panel__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <svg
          className={`backlinks-panel__chevron${expanded ? " expanded" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Backlinks</span>
        {!loading && (
          <span className="backlinks-panel__count">{backlinks.length}</span>
        )}
      </button>

      {expanded && (
        <div className="backlinks-panel__body">
          {loading ? (
            <span className="backlinks-panel__empty">Loading…</span>
          ) : backlinks.length === 0 ? (
            <span className="backlinks-panel__empty">No backlinks</span>
          ) : (
            <ul className="backlinks-panel__list">
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <button
                    className="backlinks-panel__item"
                    onClick={() => onNavigate(bl.id)}
                    title={bl.path || bl.title}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M7 2H10V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 2L5.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      <path d="M5 3H2v7h7V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {bl.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
