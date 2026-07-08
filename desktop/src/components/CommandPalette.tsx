import { useState, useEffect, useRef, useMemo } from "react";
import type { Note } from "../lib/types";
import { buildPaletteGroups, isCommandQuery } from "../lib/palette";
import type { PaletteCommand, PaletteItem } from "../lib/palette";
import "./CommandPalette.css";

interface CommandPaletteProps {
  notes: Note[];
  commands: PaletteCommand[];
  initialQuery?: string;
  onSelectNote: (noteId: string) => void;
  onClose: () => void;
}

const NoteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CommandIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M3 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 13h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function CommandPalette({
  notes,
  commands,
  initialQuery = "",
  onSelectNote,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = useMemo(
    () => buildPaletteGroups(notes, commands, query),
    [notes, commands, query],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const run = (item: PaletteItem) => {
    if (item.kind === "note") {
      onSelectNote(item.id);
    } else {
      commands.find((c) => c.id === item.id)?.action();
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[selectedIndex]) {
      e.preventDefault();
      run(flat[selectedIndex]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let flatIndex = -1;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCommandQuery(query) ? "Run a command…" : "Search notes, or type > for commands…"
            }
          />
          <span className="palette-kbd">esc</span>
        </div>
        <div className="palette-list">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="palette-group-label">{group.label}</div>
              {group.items.map((item) => {
                flatIndex++;
                const i = flatIndex;
                const selected = i === selectedIndex;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    className={`palette-item${selected ? " palette-item--selected" : ""}`}
                    onClick={() => run(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span className="palette-item-icon">
                      {item.kind === "note" ? <NoteIcon /> : <CommandIcon />}
                    </span>
                    <span className="palette-item-text">
                      <span className="palette-item-title">{item.title}</span>
                      {item.sub && <span className="palette-item-sub">{item.sub}</span>}
                    </span>
                    {item.shortcut && <span className="palette-kbd">{item.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="palette-empty">No matches for &ldquo;{query}&rdquo;</div>
          )}
        </div>
        <div className="palette-foot">
          <span>
            <span className="palette-foot-kbd">↕</span> navigate
          </span>
          <span>
            <span className="palette-foot-kbd">⏎</span> open
          </span>
          <span>
            <span className="palette-foot-kbd">&gt;</span> commands
          </span>
        </div>
      </div>
    </div>
  );
}
