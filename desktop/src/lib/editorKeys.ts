/**
 * Editor basics (#571): what Enter, Tab and the formatting shortcuts do in
 * the source pane. Pure: each function looks at the text and the selection
 * and returns the edit to make (or null to leave the key to the browser).
 * The editor applies it through `editTextarea`, so Ctrl+Z undoes it.
 */

/** Replace `text[start, end)` with `insert`, then select `[selStart, selEnd)`. */
export interface TextEdit {
  start: number;
  end: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

/** One level of indentation: enough to nest under both "- " and "1. " items. */
export const INDENT = "    ";

/** The text after an edit. */
export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
}

const lineStartOf = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
const lineEndOf = (text: string, at: number) => {
  const end = text.indexOf("\n", at);
  return end < 0 ? text.length : end;
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Whether `at` sits inside a fenced code block, where the keys keep their plain meaning. */
export function inCodeFence(text: string, at: number): boolean {
  let fence = "";
  const before = text.slice(0, lineStartOf(text, at)).split("\n");
  before.pop(); // the empty piece after the last newline
  for (const line of before) {
    const marker = line.match(FENCE)?.[1];
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = "";
  }
  return fence !== "";
}

// indent, quote markers, list marker ("-", "*", "+", "1." or "1)"), task box.
const ITEM = /^(\s*)((?:>\s?)*)(?:([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?)?/;

interface Prefix {
  indent: string;
  quote: string;
  /** "-", "*", "+" or the full "12." of a numbered item; "" for none. */
  marker: string;
  number: number | null;
  delimiter: string;
  gap: string;
  task: boolean;
  /** Length of the whole prefix in the line. */
  length: number;
}

function prefixOf(line: string): Prefix | null {
  const m = line.match(ITEM);
  if (!m || (!m[2] && !m[3])) return null;
  return {
    indent: m[1],
    quote: m[2],
    marker: m[3] ?? "",
    number: m[4] !== undefined ? Number(m[4]) : null,
    delimiter: m[5] ?? "",
    gap: m[6] ?? "",
    task: m[7] !== undefined,
    length: m[0].length,
  };
}

/**
 * Enter in a list item, task or quote starts the next one (numbers count
 * up, a task starts unticked). Enter on an empty item ends the list instead:
 * the marker is removed. Null anywhere else, in a code block, or with the
 * caret inside the marker.
 */
export function continueList(text: string, selStart: number, selEnd: number): TextEdit | null {
  if (inCodeFence(text, selStart)) return null;
  const lineStart = lineStartOf(text, selStart);
  const lineEnd = lineEndOf(text, selStart);
  const line = text.slice(lineStart, lineEnd);
  const prefix = prefixOf(line);
  if (!prefix || selStart - lineStart < prefix.length) return null;

  if (line.slice(prefix.length).trim() === "" && selStart === selEnd) {
    return { start: lineStart, end: lineEnd, insert: "", selStart: lineStart, selEnd: lineStart };
  }

  const marker = prefix.number !== null ? `${prefix.number + 1}${prefix.delimiter}` : prefix.marker;
  const next = prefix.indent + prefix.quote + (marker ? marker + prefix.gap + (prefix.task ? "[ ] " : "") : "");
  const insert = "\n" + next;
  const caret = selStart + insert.length;
  return { start: selStart, end: selEnd, insert, selStart: caret, selEnd: caret };
}

/** How much leading whitespace Shift+Tab takes off a line: one tab, or up to one indent of spaces. */
function outdentLength(line: string): number {
  if (line.startsWith("\t")) return 1;
  const spaces = line.match(/^ */)![0].length;
  return Math.min(spaces, INDENT.length);
}

/**
 * Tab / Shift+Tab: indents or outdents the selected lines, or the line of
 * the caret when that is a list item. Tab with the caret in ordinary text
 * inserts an indent at the caret. Null when there is nothing to outdent.
 */
export function indentLines(text: string, selStart: number, selEnd: number, outdent: boolean): TextEdit | null {
  const collapsed = selStart === selEnd;
  const blockStart = lineStartOf(text, selStart);
  // A selection ending right after a newline does not include the next line.
  const lastChar = !collapsed && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
  const blockEnd = lineEndOf(text, lastChar);
  const block = text.slice(blockStart, blockEnd);

  if (collapsed && !outdent && (!prefixOf(block)?.marker || inCodeFence(text, selStart))) {
    const caret = selStart + INDENT.length;
    return { start: selStart, end: selEnd, insert: INDENT, selStart: caret, selEnd: caret };
  }

  const lines = block.split("\n");
  const deltas = lines.map((line) => (outdent ? -outdentLength(line) : line.trim() === "" && !collapsed ? 0 : INDENT.length));
  if (deltas.every((d) => d === 0)) return null;
  const insert = lines.map((line, i) => (deltas[i] >= 0 ? INDENT.slice(0, deltas[i]) + line : line.slice(-deltas[i]))).join("\n");

  // A caret moves with its text and never leaves its line; a selection
  // grows to the whole lines that changed.
  if (collapsed) {
    const caret = Math.max(blockStart, selStart + deltas[0]);
    return { start: blockStart, end: blockEnd, insert, selStart: caret, selEnd: caret };
  }
  return { start: blockStart, end: blockEnd, insert, selStart: blockStart, selEnd: blockStart + insert.length };
}

/**
 * Ctrl+I and friends: wraps the selection in `marker` ("*" for italic), or
 * unwraps it when it already is (markers inside or just outside the
 * selection). With nothing selected the markers go in with the caret between.
 */
export function toggleWrap(text: string, selStart: number, selEnd: number, marker: string): TextEdit {
  const n = marker.length;
  const selected = text.slice(selStart, selEnd);
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, -n);
    return { start: selStart, end: selEnd, insert: inner, selStart, selEnd: selStart + inner.length };
  }
  if (text.slice(selStart - n, selStart) === marker && text.slice(selEnd, selEnd + n) === marker) {
    return { start: selStart - n, end: selEnd + n, insert: selected, selStart: selStart - n, selEnd: selEnd - n };
  }
  return {
    start: selStart,
    end: selEnd,
    insert: marker + selected + marker,
    selStart: selStart + n,
    selEnd: selEnd + n,
  };
}

/**
 * Ctrl+K: turns the selection into a link. A selected address becomes the
 * target with the caret in the text; selected words become the text with
 * the caret in the (empty) target.
 */
export function insertLink(text: string, selStart: number, selEnd: number): TextEdit {
  const selected = text.slice(selStart, selEnd);
  if (/^(https?:\/\/|mailto:)\S+$/i.test(selected)) {
    return { start: selStart, end: selEnd, insert: `[](${selected})`, selStart: selStart + 1, selEnd: selStart + 1 };
  }
  const caret = selStart + selected.length + 3;
  return { start: selStart, end: selEnd, insert: `[${selected}]()`, selStart: caret, selEnd: caret };
}

/** The part of a key press the editor's shortcuts look at. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The edit a key press makes in the source pane, or null to let the browser
 * (or another handler) have the key. `tabMovesFocus` is true right after
 * Esc, so the keyboard can always leave the editor with Esc, then Tab.
 */
export function editForKey(
  e: KeyPress,
  text: string,
  selStart: number,
  selEnd: number,
  tabMovesFocus = false,
): TextEdit | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (!mod && e.key === "Enter" && !e.shiftKey) return continueList(text, selStart, selEnd);
  if (!mod && e.key === "Tab") return tabMovesFocus ? null : indentLines(text, selStart, selEnd, e.shiftKey);
  if (mod && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === "i") return toggleWrap(text, selStart, selEnd, "*");
    if (key === "k") return insertLink(text, selStart, selEnd);
  }
  return null;
}
