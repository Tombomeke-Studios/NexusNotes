import { useState, useEffect, useRef, useCallback } from "react";
import { search as searchApi } from "../../lib/api";
import type { SearchHit } from "../../lib/types";
import "./GlobalSearch.css";

interface GlobalSearchProps {
  vaultId: string;
  onSelect: (noteId: string) => void;
  onClose: () => void;
}

export function GlobalSearch({ vaultId, onSelect, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    (q: string, t: string) => {
      if (!q && !t) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError(null);
      searchApi
        .query(vaultId, { q: q || undefined, tag: t || undefined, limit: 30 })
        .then((hits) => {
          setResults(hits);
          setSelectedIndex(0);
        })
        .catch(() => setError("Search unavailable"))
        .finally(() => setLoading(false));
    },
    [vaultId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, tag), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tag, runSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      onSelect(results[selectedIndex].id);
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="global-search-overlay" onClick={onClose}>
      <div className="global-search" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-header">
          <input
            ref={inputRef}
            className="global-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Full-text search…"
          />
          <input
            className="global-search-tag-input"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="#tag filter"
          />
        </div>

        <div className="global-search-results">
          {loading && <div className="global-search-status">Searching…</div>}
          {error && <div className="global-search-status global-search-error">{error}</div>}
          {!loading && !error && results.length === 0 && (query || tag) && (
            <div className="global-search-status">No results</div>
          )}
          {results.map((hit, i) => (
            <button
              key={hit.id}
              className={`global-search-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => { onSelect(hit.id); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="global-search-item-header">
                <span className="global-search-title">{hit.title}</span>
                {hit.path && (
                  <span className="global-search-path">{hit.path}</span>
                )}
              </div>
              {hit.snippet && (
                <div
                  className="global-search-snippet"
                  dangerouslySetInnerHTML={{ __html: hit.snippet }}
                />
              )}
              {hit.tags && hit.tags.length > 0 && (
                <div className="global-search-tags">
                  {hit.tags.map((t) => (
                    <span key={t} className="global-search-tag">#{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
