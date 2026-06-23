import { useState, useEffect, useRef, useMemo } from "react";
import type { Note } from "../../lib/types";
import "./QuickSwitcher.css";

interface QuickSwitcherProps {
  notes: Note[];
  onSelect: (noteId: string) => void;
  onClose: () => void;
}

export function QuickSwitcher({ notes, onSelect, onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query) return notes;
    const lower = query.toLowerCase();
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(lower) ||
        n.path.toLowerCase().includes(lower) ||
        n.content.toLowerCase().includes(lower),
    );
  }, [notes, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      onSelect(filtered[selectedIndex].id);
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div className="quick-switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="quick-switcher-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search notes..."
        />
        <div className="quick-switcher-results">
          {filtered.map((note, i) => (
            <button
              key={note.id}
              className={`quick-switcher-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => {
                onSelect(note.id);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="quick-switcher-title">{note.title}</span>
              {note.path && (
                <span className="quick-switcher-path">{note.path}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="quick-switcher-empty">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
