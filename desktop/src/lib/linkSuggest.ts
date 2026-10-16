/**
 * [[link]] autocomplete (#548). Pure helpers: noticing that the caret sits in
 * an open `[[` link, ranking note titles (and, after `#`, a note's headings)
 * against what was typed, and building the text edit that inserts the pick.
 * It works on the notes the app already holds (decrypted in e2ee vaults), so
 * nothing here ever asks the server.
 */
import { parseOutline } from "./outline";
import type { Note } from "./types";

/** The popup shows at most this many results. */
export const MAX_OPTIONS = 8;

/** Longer fragments are not a link being typed. */
const MAX_QUERY = 200;

/** An open `[[` before the caret: where it starts and what follows it. */
export interface LinkTrigger {
  /** Offset of the `[[`. */
  from: number;
  /** The text between `[[` and the caret. */
  query: string;
}

/**
 * The open link the caret is in, or null. The fragment between `[[` and the
 * caret must stay on one line and hold no `[`, `]` or `|`: a typed `]]` (or
 * an alias bar) ends the suggestion. `![[` embeds attachments, not notes.
 */
export function detectLinkTrigger(text: string, caret: number): LinkTrigger | null {
  if (caret < 2) return null;
  const from = text.lastIndexOf("[[", caret - 2);
  if (from < 0 || caret - from - 2 > MAX_QUERY) return null;
  const query = text.slice(from + 2, caret);
  if (/[[\]|\n]/.test(query)) return null;
  if (from > 0 && text[from - 1] === "!") return null;
  return { from, query };
}

/**
 * How well `candidate` matches `query`, case-insensitively: exact (1000) >
 * prefix (800-900, shorter first) > at the start of a word (600-700) >
 * anywhere (400-500) > letters in order with gaps (1-300). -1 means no match;
 * an empty query matches everything with 0.
 */
export function matchScore(candidate: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const c = candidate.trim().toLowerCase();
  if (c === q) return 1000;
  if (c.startsWith(q)) return 900 - Math.min(c.length - q.length, 99);
  const idx = c.indexOf(q);
  if (idx >= 0) {
    const wordStart = /[\s\-_/.(]/.test(c[idx - 1]);
    return (wordStart ? 700 : 500) - Math.min(idx, 99);
  }
  let from = 0;
  let first = -1;
  let last = -1;
  let gaps = 0;
  for (const ch of q) {
    const pos = c.indexOf(ch, from);
    if (pos < 0) return -1;
    if (first < 0) first = pos;
    if (last >= 0) gaps += pos - last - 1;
    last = pos;
    from = pos + ch.length;
  }
  return Math.max(1, 300 - gaps * 5 - Math.min(first, 50));
}

export interface LinkOption {
  kind: "note" | "heading" | "create";
  /** Stable React key and element id suffix. */
  key: string;
  /** What the row shows. */
  label: string;
  /** Shown dimmed: the note's folder, or the heading level ("H2"). */
  hint: string;
  /** What goes between the brackets. */
  target: string;
  noteId?: string;
}

/** Text that cannot sit inside `[[ ]]` without breaking the link. */
function linkable(s: string): boolean {
  return s.trim() !== "" && !/[[\]|\n]/.test(s);
}

function ranked<T>(items: T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: matchScore(text(item), query) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        text(a.item).length - text(b.item).length ||
        text(a.item).localeCompare(text(b.item)),
    )
    .map((r) => r.item);
}

function createOption(query: string): LinkOption[] {
  const text = query.trim();
  return text ? [{ kind: "create", key: "create", label: text, hint: "", target: text }] : [];
}

/**
 * The popup's rows for the fragment typed after `[[`: matching note titles
 * (with their folder), or after `Title#` that note's headings. An empty
 * fragment lists the most recently edited notes. Without any match the one
 * row offers to link the typed text as it is (the note need not exist yet).
 */
export function linkOptions(notes: Note[], query: string, opts: { excludeId?: string } = {}): LinkOption[] {
  const hash = query.indexOf("#");
  if (hash >= 0) {
    const title = query.slice(0, hash).trim().toLowerCase();
    const target = notes.find((n) => n.title.trim().toLowerCase() === title && linkable(n.title));
    if (!target) return createOption(query);
    const seen = new Set<string>();
    const headings = parseOutline(target.content).filter((h) => {
      if (!linkable(h.text) || h.text.includes("#") || seen.has(h.text)) return false;
      seen.add(h.text);
      return true;
    });
    const hq = query.slice(hash + 1);
    const hits = hq.trim() ? ranked(headings, hq, (h) => h.text) : headings;
    if (hits.length === 0) return createOption(query);
    return hits.slice(0, MAX_OPTIONS).map((h) => ({
      kind: "heading",
      key: `h${h.index}`,
      label: h.text,
      hint: `H${h.level}`,
      target: `${target.title}#${h.text}`,
      noteId: target.id,
    }));
  }

  const candidates = notes.filter((n) => n.id !== opts.excludeId && linkable(n.title) && !n.title.includes("#"));
  const hits = query.trim()
    ? ranked(candidates, query, (n) => n.title)
    : [...candidates].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (hits.length === 0) return createOption(query);
  return hits.slice(0, MAX_OPTIONS).map((n) => ({
    kind: "note",
    key: `n${n.id}`,
    label: n.title,
    hint: n.path,
    target: n.title,
    noteId: n.id,
  }));
}

export interface LinkEdit {
  /** The replaced range of the old text, [start, end)... */
  start: number;
  end: number;
  /** ...and what goes there, so the edit can go in as one undoable step. */
  insert: string;
  /** The whole text after the edit. */
  text: string;
  /** Where the caret goes: after the closing brackets. */
  caret: number;
}

/**
 * Replaces `[[fragment` with `[[target]]`. When the caret is inside a link
 * that is already closed (`[[Pla|n]]`), the rest of its name and its `]]`
 * are replaced too; an alias (`|…`) or heading (`#…`) after the name is kept.
 */
export function linkInsertion(text: string, trigger: LinkTrigger, caret: number, target: string): LinkEdit {
  const rest = text.slice(caret);
  const word = (target.includes("#") ? /^[^[\]|\n]*/ : /^[^[\]|#\n]*/).exec(rest)![0];
  const after = rest.slice(word.length);
  let end = caret;
  let insert = `[[${target}]]`;
  if (after.startsWith("]]")) {
    end = caret + word.length + 2;
  } else if (after.startsWith("|") || after.startsWith("#")) {
    end = caret + word.length;
    insert = `[[${target}`;
  }
  const start = trigger.from;
  return { start, end, insert, text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
