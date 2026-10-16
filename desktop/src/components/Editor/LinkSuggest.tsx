import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { detectLinkTrigger, linkInsertion, linkOptions, type LinkOption, type LinkTrigger } from "../../lib/linkSuggest";
import { editTextarea } from "../../lib/textareaEdit";
import type { Note } from "../../lib/types";
import "./LinkSuggest.css";

const GAP = 4;
const WIDTH = 300;

interface LinkSuggestProps {
  /** The editor's source textarea; the popup follows its caret. */
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** The vault's notes as the app holds them (decrypted in e2ee vaults). */
  notes: Note[];
  /** The open note: left out of the title suggestions. */
  noteId: string;
  readOnly?: boolean;
  /** Sets the whole text when the browser cannot insert the link itself. */
  onReplaceText: (next: string) => void;
}

interface CaretBox {
  left: number;
  top: number;
  bottom: number;
}

/**
 * Where the character at `offset` sits on screen: a hidden copy of the
 * highlight layer (which wraps exactly like the textarea) holds the text up
 * to the offset, and a marker at its end is measured.
 */
function caretBox(ta: HTMLTextAreaElement, offset: number): CaretBox {
  const parent = ta.parentElement;
  if (!parent) return { left: 0, top: 0, bottom: 0 };
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
  const r = marker.getBoundingClientRect();
  mirror.remove();
  return { left: r.left, top: r.top - ta.scrollTop, bottom: r.bottom - ta.scrollTop };
}

/**
 * [[link]] autocomplete (#548): typing `[[` in the source pane opens a list of
 * matching notes at the caret (after `Title#`, that note's headings). ↑/↓
 * choose, Enter or Tab insert `[[Title]]` as one undoable edit, Esc closes;
 * a typed `]]` or moving the caret out of the link closes it too. Focus stays
 * in the textarea throughout; the list is tied to it by aria-activedescendant.
 */
export function LinkSuggest({ textareaRef, notes, noteId, readOnly = false, onReplaceText }: LinkSuggestProps) {
  const [trigger, setTrigger] = useState<LinkTrigger | null>(null);
  const [caret, setCaret] = useState<CaretBox | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo(
    () => (trigger ? linkOptions(notes, trigger.query, { excludeId: noteId }) : []),
    [notes, trigger, noteId],
  );
  const open = trigger !== null && options.length > 0 && !readOnly;
  const current = Math.min(active, options.length - 1);
  const optionId = (o: LinkOption) => `${listId}-${o.key}`;

  // The native listeners below read the latest state through refs.
  const state = useRef({ trigger, options, open, current, readOnly });
  state.current = { trigger, options, open, current, readOnly };
  const onReplaceTextRef = useRef(onReplaceText);
  onReplaceTextRef.current = onReplaceText;
  // A link closed with Esc stays closed until the caret leaves it.
  const dismissedAt = useRef<number | null>(null);
  // Our own insertion fires an input event; it must not reopen the list.
  const inserting = useRef(false);

  const close = useCallback(() => {
    setTrigger(null);
    setCaret(null);
  }, []);

  const insert = useCallback(
    (option: LinkOption) => {
      const ta = textareaRef.current;
      const t = state.current.trigger;
      if (!ta || !t || state.current.readOnly) return;
      const edit = linkInsertion(ta.value, t, ta.selectionStart, option.target);
      inserting.current = true;
      try {
        editTextarea(ta, edit.start, edit.end, edit.insert, edit.text, onReplaceTextRef.current);
      } finally {
        inserting.current = false;
      }
      close();
      // The fallback re-renders the textarea with the new text, which moves
      // the caret to the end; put it after the link once that has happened.
      ta.setSelectionRange(edit.caret, edit.caret);
      requestAnimationFrame(() => {
        if (ta.value === edit.text && ta.selectionStart !== edit.caret) ta.setSelectionRange(edit.caret, edit.caret);
      });
    },
    [textareaRef, close],
  );
  const insertRef = useRef(insert);
  insertRef.current = insert;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    // Re-reads the link around the caret. Only typing opens the list;
    // moving the caret can keep it open (or close it), never open it.
    const refresh = (typed: boolean) => {
      const { trigger: was, readOnly: ro } = state.current;
      if (ro || ta.selectionStart !== ta.selectionEnd) return close();
      const t = detectLinkTrigger(ta.value, ta.selectionStart);
      if (!t) {
        dismissedAt.current = null;
        return close();
      }
      if (dismissedAt.current === t.from) return close();
      if (!typed && (!was || was.from !== t.from)) return close();
      if (!was || was.query !== t.query || was.from !== t.from) {
        setTrigger(t);
        setActive(0);
      }
      setCaret(caretBox(ta, ta.selectionStart));
    };

    const onInput = (e: Event) => {
      if (inserting.current) return;
      // Undo and redo only restore text; they do not start a link.
      if ((e as InputEvent).inputType?.startsWith("history")) return close();
      refresh(true);
    };
    const onMove = () => {
      if (state.current.trigger) refresh(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const { open: isOpen, options: opts, current: cur, trigger: t } = state.current;
      if (!isOpen || e.isComposing) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      let handled = true;
      if (e.key === "ArrowDown" && plain) setActive((cur + 1) % opts.length);
      else if (e.key === "ArrowUp" && plain) setActive((cur - 1 + opts.length) % opts.length);
      else if ((e.key === "Enter" || e.key === "Tab") && plain && !e.shiftKey) insertRef.current(opts[cur]);
      else if (e.key === "Escape") {
        dismissedAt.current = t?.from ?? null;
        close();
      } else handled = false;
      if (handled) {
        e.preventDefault();
        // The workspace's own Esc / Enter handlers must not see this key.
        e.stopPropagation();
      }
    };
    const onScroll = () => {
      if (state.current.trigger) setCaret(caretBox(ta, ta.selectionStart));
    };

    ta.addEventListener("input", onInput);
    ta.addEventListener("keydown", onKeyDown);
    ta.addEventListener("keyup", onMove);
    ta.addEventListener("mouseup", onMove);
    ta.addEventListener("select", onMove);
    ta.addEventListener("blur", close);
    ta.addEventListener("scroll", onScroll);
    return () => {
      ta.removeEventListener("input", onInput);
      ta.removeEventListener("keydown", onKeyDown);
      ta.removeEventListener("keyup", onMove);
      ta.removeEventListener("mouseup", onMove);
      ta.removeEventListener("select", onMove);
      ta.removeEventListener("blur", close);
      ta.removeEventListener("scroll", onScroll);
    };
  }, [textareaRef, close]);

  useEffect(() => {
    if (readOnly) close();
  }, [readOnly, close]);

  // Tie the list to the textarea, which keeps focus while it is open.
  const activeId = open ? optionId(options[current]) : null;
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (activeId) {
      ta.setAttribute("aria-autocomplete", "list");
      ta.setAttribute("aria-controls", listId);
      ta.setAttribute("aria-activedescendant", activeId);
    } else {
      ta.removeAttribute("aria-autocomplete");
      ta.removeAttribute("aria-controls");
      ta.removeAttribute("aria-activedescendant");
    }
  }, [textareaRef, activeId, listId]);

  // Below the caret, or above it when there is no room underneath.
  const popupRef = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    if (!caret) return;
    const height = popupRef.current?.offsetHeight ?? 0;
    setAbove(caret.bottom + GAP + height > window.innerHeight && caret.top - GAP - height > 0);
  }, [caret, options.length]);

  if (!open || !caret) return null;
  const left = Math.max(GAP, Math.min(caret.left, window.innerWidth - WIDTH - GAP));
  const style = above ? { left, bottom: window.innerHeight - caret.top + GAP } : { left, top: caret.bottom + GAP };

  return createPortal(
    <div ref={popupRef} className="link-suggest" style={style}>
      <ul id={listId} className="link-suggest-list" role="listbox" aria-label="Link suggestions" aria-activedescendant={activeId ?? undefined}>
        {options.map((o, i) => (
          <li
            key={o.key}
            id={optionId(o)}
            role="option"
            aria-selected={i === current}
            className={`link-suggest-option link-suggest-option--${o.kind}${i === current ? " link-suggest-option--active" : ""}`}
            // Keep the caret (and focus) in the textarea.
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => i !== current && setActive(i)}
            onClick={() => insert(o)}
          >
            {o.kind === "create" ? (
              <span className="link-suggest-label">{`Create link to '${o.label}'`}</span>
            ) : (
              <span className="link-suggest-label">{o.label}</span>
            )}
            {o.hint && <span className="link-suggest-hint">{o.hint}</span>}
          </li>
        ))}
      </ul>
      <div className="link-suggest-footer" aria-hidden="true">
        <kbd>↑</kbd>
        <kbd>↓</kbd> choose · <kbd>Enter</kbd> insert · <kbd>Esc</kbd> close
      </div>
    </div>,
    document.body,
  );
}
