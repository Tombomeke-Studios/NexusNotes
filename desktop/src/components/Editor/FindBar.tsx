import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  findMatches,
  matchAtOrAfter,
  matchLabel,
  replaceAllPlan,
  stepMatch,
  type Match,
} from "../../lib/findReplace";
import { editTextarea } from "../../lib/textareaEdit";
import "./FindBar.css";

export interface FindRequest {
  nonce: number;
  /** Text to search for (the editor's single-line selection), if any. */
  query?: string;
}

interface FindBarProps {
  /** The editor's text (decrypted in e2ee vaults). */
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** The highlight layer behind the textarea; absent on very large notes. */
  highlightRef: RefObject<HTMLPreElement>;
  /** Each new nonce focuses the search field (Ctrl+F while the bar is open). */
  request: FindRequest;
  readOnly?: boolean;
  /** Reports the matches and the current one, for the highlight layer. */
  onMarks: (matches: Match[], current: number) => void;
  /** Sets the whole text when the browser cannot insert the edit itself. */
  onReplaceText: (next: string) => void;
  onClose: () => void;
}

/**
 * Where `offset` sits from the top of the textarea's content, for notes too
 * large for the highlight layer: a hidden copy of that layer, holding the
 * text up to the offset, wraps exactly like the textarea.
 */
function measureTop(ta: HTMLTextAreaElement, offset: number): number {
  const parent = ta.parentElement;
  if (!parent) return 0;
  const mirror = document.createElement("pre");
  mirror.className = "editor-highlight";
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.fontSize = ta.style.fontSize;
  mirror.style.visibility = "hidden";
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​"; // zero-width space
  mirror.appendChild(marker);
  parent.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Find and replace in the open note (#547), above the editor's panes. */
export function FindBar({ text, textareaRef, highlightRef, request, readOnly = false, onMarks, onReplaceText, onClose }: FindBarProps) {
  const [query, setQuery] = useState(request.query ?? "");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  // The current match is the first one at or after this offset, so it stays
  // put while the text around it changes.
  const [anchor, setAnchor] = useState(() => textareaRef.current?.selectionStart ?? 0);
  const [reveal, setReveal] = useState(request.query ? 1 : 0);
  const [replaced, setReplaced] = useState<number | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => findMatches(text, query, { caseSensitive, wholeWord }),
    [text, query, caseSensitive, wholeWord],
  );
  const current = matchAtOrAfter(matches, anchor);

  // Open / Ctrl+F again: focus the search field, taking over a selection.
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (lastNonce.current === request.nonce) return;
    const first = lastNonce.current === null;
    lastNonce.current = request.nonce;
    if (!first) {
      setAnchor(textareaRef.current?.selectionStart ?? 0);
      if (request.query) {
        setQuery(request.query);
        setReplaced(null);
        setReveal((n) => n + 1);
      }
    }
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [request, textareaRef]);

  const onMarksRef = useRef(onMarks);
  onMarksRef.current = onMarks;
  useEffect(() => onMarksRef.current(matches, current), [matches, current]);
  useEffect(() => () => onMarksRef.current([], -1), []);

  // Select the current match in the textarea and scroll it into view, after
  // the editor has drawn the marks.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    if (reveal === 0) return;
    const frame = requestAnimationFrame(() => {
      const ta = textareaRef.current;
      const m = matchesRef.current[currentRef.current];
      if (!ta || !m) return;
      ta.setSelectionRange(m.start, m.end);
      const mark = highlightRef.current?.querySelector<HTMLElement>(".find-match--current");
      const top = mark ? mark.offsetTop : measureTop(ta, m.start);
      const height = mark ? mark.offsetHeight : 0;
      if (top < ta.scrollTop || top + height > ta.scrollTop + ta.clientHeight) {
        ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
        if (highlightRef.current) highlightRef.current.scrollTop = ta.scrollTop;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, textareaRef, highlightRef]);

  const go = (dir: 1 | -1) => {
    const next = stepMatch(current, matches.length, dir);
    if (next < 0) return;
    setAnchor(matches[next].start);
    setReplaced(null);
    setReveal((n) => n + 1);
  };

  const changeQuery = (q: string) => {
    setQuery(q);
    setReplaced(null);
    setReveal((n) => n + 1);
  };

  const replaceOne = () => {
    const m = matches[current];
    if (!m || readOnly) return;
    const next = text.slice(0, m.start) + replacement + text.slice(m.end);
    editTextarea(textareaRef.current, m.start, m.end, replacement, next, onReplaceText);
    setAnchor(m.start + replacement.length);
    setReplaced(null);
    setReveal((n) => n + 1);
  };

  const replaceAll = () => {
    if (readOnly) return;
    // Every match, not just the ones counted.
    const all = findMatches(text, query, { caseSensitive, wholeWord }, Infinity);
    const plan = replaceAllPlan(text, all, replacement);
    if (!plan) return;
    editTextarea(textareaRef.current, plan.start, plan.end, plan.insert, plan.text, onReplaceText);
    setReplaced(plan.count);
  };

  const label = replaced !== null ? `Replaced ${replaced}` : matchLabel(query, matches.length, current);
  const noResults = !!query && matches.length === 0 && replaced === null;

  return (
    <div className="find-bar" role="search" aria-label="Find in note">
      <div className="find-bar-row">
        <input
          ref={queryRef}
          className={`find-bar-input${noResults ? " find-bar-input--none" : ""}`}
          value={query}
          placeholder="Find"
          aria-label="Find"
          spellCheck={false}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className={`find-bar-toggle${caseSensitive ? " active" : ""}`}
          aria-pressed={caseSensitive}
          aria-label="Match case"
          title="Match case"
          onClick={() => {
            setCaseSensitive((v) => !v);
            setReplaced(null);
            setReveal((n) => n + 1);
          }}
        >
          Aa
        </button>
        <button
          type="button"
          className={`find-bar-toggle${wholeWord ? " active" : ""}`}
          aria-pressed={wholeWord}
          aria-label="Whole word"
          title="Whole word"
          onClick={() => {
            setWholeWord((v) => !v);
            setReplaced(null);
            setReveal((n) => n + 1);
          }}
        >
          <span className="find-bar-word">ab</span>
        </button>
        <span className="find-bar-count" aria-live="polite">
          {label}
        </span>
        <button type="button" className="find-bar-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={matches.length === 0} onClick={() => go(-1)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 7.5 6 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="find-bar-btn" aria-label="Next match" title="Next match (Enter)" disabled={matches.length === 0} onClick={() => go(1)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="find-bar-btn" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="find-bar-row">
        <input
          className="find-bar-input"
          value={replacement}
          placeholder="Replace"
          aria-label="Replace with"
          spellCheck={false}
          disabled={readOnly}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              replaceOne();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" className="find-bar-action" disabled={readOnly || current < 0} onClick={replaceOne}>
          Replace
        </button>
        <button type="button" className="find-bar-action" disabled={readOnly || matches.length === 0} onClick={replaceAll}>
          Replace all
        </button>
      </div>
    </div>
  );
}
