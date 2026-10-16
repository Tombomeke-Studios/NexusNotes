/**
 * Find and replace in the open note (#547). Pure helpers: matching, moving
 * between matches, the replace-all edit and the match marks for the editor's
 * highlight layer. The editor works on its decrypted text only, so this runs
 * the same in e2ee vaults.
 */
import type { Segment } from "./mdHighlight";

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** A match as offsets into the text: [start, end). */
export interface Match {
  start: number;
  end: number;
}

/** Matching stops here; the count then reads "N+". */
export const MAX_MATCHES = 10_000;

// Characters that count as part of a word for "whole word".
const WORD = "[\\p{L}\\p{N}_]";

/** Escapes the query so it is matched literally. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every occurrence of `query` in `text`, left to right and not overlapping.
 * The query is literal text, not a pattern. Case-insensitive unless asked.
 */
export function findMatches(text: string, query: string, opts: FindOptions = {}, limit = MAX_MATCHES): Match[] {
  if (!query) return [];
  let source = escapeRegExp(query);
  if (opts.wholeWord) source = `(?<!${WORD})${source}(?!${WORD})`;
  // A regex (not lowercased copies) keeps offsets pointing into the original
  // text, even for letters whose lower case is longer.
  const re = new RegExp(source, opts.caseSensitive ? "gu" : "giu");
  const out: Match[] = [];
  let m: RegExpExecArray | null;
  while (out.length < limit && (m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * The first match that starts at or after `offset`, wrapping to the first
 * match; -1 without matches. Keeps "the current match" stable while the text
 * around it changes.
 */
export function matchAtOrAfter(matches: Match[], offset: number): number {
  if (matches.length === 0) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].start < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

/** The next (dir 1) or previous (dir -1) match index, wrapping around. */
export function stepMatch(index: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (index < 0) return dir === 1 ? 0 : count - 1;
  return (index + dir + count) % count;
}

export interface ReplacePlan {
  /** The whole text after the replacement. */
  text: string;
  /** The changed range in the old text (first match start to last match end)... */
  start: number;
  end: number;
  /** ...and what replaces it, so the edit can go in as one undoable step. */
  insert: string;
  count: number;
}

/** Replaces every match with `replacement` (taken literally); null without matches. */
export function replaceAllPlan(text: string, matches: Match[], replacement: string): ReplacePlan | null {
  if (matches.length === 0) return null;
  const start = matches[0].start;
  const end = matches[matches.length - 1].end;
  let insert = "";
  let at = start;
  for (const m of matches) {
    insert += text.slice(at, m.start) + replacement;
    at = m.end;
  }
  return { text: text.slice(0, start) + insert + text.slice(end), start, end, insert, count: matches.length };
}

/** The find bar's count: "3 of 12", "12 results", "No results", or "" before typing. */
export function matchLabel(query: string, count: number, current: number): string {
  if (!query) return "";
  if (count === 0) return "No results";
  const total = count >= MAX_MATCHES ? `${count}+` : `${count}`;
  return current >= 0 ? `${current + 1} of ${total}` : `${total} results`;
}

/**
 * Splits highlighted lines (from highlightMarkdown) where matches start and
 * end, adding `find-match` (and `find-match--current` for the current one) to
 * the class. Every character stays in order, so the layer keeps lining up
 * with the textarea. Lines without a match are returned as they were.
 */
export function markMatches(lines: Segment[][], matches: Match[], current: number): Segment[][] {
  if (matches.length === 0) return lines;
  const withClass = (seg: Segment, text: string, extra?: string): Segment => {
    const cls = [seg.cls, extra].filter(Boolean).join(" ");
    return cls ? { cls, text } : { text };
  };
  let mi = 0;
  let offset = 0;
  return lines.map((line) => {
    const lineStart = offset;
    let lineLen = 0;
    for (const seg of line) lineLen += seg.text.length;
    offset += lineLen + 1; // the "\n" after the line
    while (mi < matches.length && matches[mi].end <= lineStart) mi++;
    if (mi >= matches.length || matches[mi].start >= lineStart + lineLen) return line;

    const out: Segment[] = [];
    let segStart = lineStart;
    for (const seg of line) {
      const segEnd = segStart + seg.text.length;
      let p = segStart;
      while (mi < matches.length && matches[mi].start < segEnd) {
        const m = matches[mi];
        if (m.start > p) out.push(withClass(seg, seg.text.slice(p - segStart, m.start - segStart)));
        const from = Math.max(m.start, p);
        const to = Math.min(m.end, segEnd);
        out.push(withClass(seg, seg.text.slice(from - segStart, to - segStart), mi === current ? "find-match find-match--current" : "find-match"));
        p = to;
        if (m.end <= segEnd) mi++;
        else break; // the match continues into the next segment
      }
      if (p < segEnd) out.push(withClass(seg, seg.text.slice(p - segStart)));
      segStart = segEnd;
    }
    return out;
  });
}
