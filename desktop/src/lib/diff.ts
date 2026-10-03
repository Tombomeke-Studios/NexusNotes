/**
 * Line diff between the user's version of a note ("mine") and the version
 * another device saved ("theirs"), for the conflict resolution dialog (#225).
 *
 * Myers' O((N+M)·D) algorithm on the lines left after trimming the common
 * start and end. Past MAX_DIFF_LINES of differing middle it falls back to one
 * removed block and one added block, which keeps memory bounded on huge,
 * completely rewritten notes (the trace grows with the edit distance).
 */

export type DiffKind = "same" | "mine" | "theirs";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

const MAX_DIFF_LINES = 4000;

// A note saved on Windows may use CRLF; the same line must compare equal.
const splitLines = (text: string): string[] => (text === "" ? [] : text.split(/\r?\n/));

export function diffLines(mine: string, theirs: string): DiffLine[] {
  const a = splitLines(mine);
  const b = splitLines(theirs);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head = a.slice(0, start).map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const middle =
    midA.length + midB.length > MAX_DIFF_LINES
      ? [
          ...midA.map((text): DiffLine => ({ kind: "mine", text })),
          ...midB.map((text): DiffLine => ({ kind: "theirs", text })),
        ]
      : myers(midA, midB);
  return [...head, ...middle, ...tail];
}

function myers(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v: Int32Array = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Walk the trace back from (n, m) to (0, 0), collecting the edit script.
  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ kind: "same", text: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ kind: "theirs", text: b[y - 1] });
      else out.push({ kind: "mine", text: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

export interface SideCell {
  text: string;
  changed: boolean;
}

export interface SideRow {
  left: SideCell | null;
  right: SideCell | null;
}

/** A side-by-side row with each side's line number (null where a side has no line). */
export interface NumberedSideRow extends SideRow {
  leftNo: number | null;
  rightNo: number | null;
}

export function numberSideRows(rows: SideRow[]): NumberedSideRow[] {
  let l = 0;
  let r = 0;
  return rows.map((row) => ({ ...row, leftNo: row.left ? ++l : null, rightNo: row.right ? ++r : null }));
}

export const isChangedRow = (r: SideRow) => !!(r.left?.changed || r.right?.changed);

/** A visible stretch of rows, or a fold of unchanged rows far from any change. */
export type DiffSegment<T> = { kind: "rows"; rows: T[] } | { kind: "fold"; id: number; rows: T[] };

/**
 * Splits diff rows into visible stretches and folds: unchanged runs keep
 * `context` rows next to each change, and a run is only folded when that
 * hides at least `minFold` rows.
 */
export function foldUnchanged<T>(rows: T[], isChanged: (row: T) => boolean, context = 3, minFold = 4): DiffSegment<T>[] {
  const out: DiffSegment<T>[] = [];
  const push = (list: T[]) => {
    if (list.length === 0) return;
    const last = out[out.length - 1];
    if (last?.kind === "rows") last.rows.push(...list);
    else out.push({ kind: "rows", rows: [...list] });
  };
  let i = 0;
  while (i < rows.length) {
    if (isChanged(rows[i])) {
      push([rows[i]]);
      i++;
      continue;
    }
    const start = i;
    while (i < rows.length && !isChanged(rows[i])) i++;
    const run = rows.slice(start, i);
    const keepHead = start === 0 ? 0 : context;
    const keepTail = i === rows.length ? 0 : context;
    if (run.length - keepHead - keepTail < minFold) {
      push(run);
      continue;
    }
    push(run.slice(0, keepHead));
    out.push({ kind: "fold", id: start + keepHead, rows: run.slice(keepHead, run.length - keepTail) });
    push(run.slice(run.length - keepTail));
  }
  return out;
}

/**
 * Rows for a two-column view: common lines sit on both sides, and each run of
 * changes pairs its "mine" lines with its "theirs" lines row by row.
 */
export function sideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "same") {
      const cell = { text: lines[i].text, changed: false };
      rows.push({ left: cell, right: { ...cell } });
      i++;
      continue;
    }
    const mine: string[] = [];
    const theirs: string[] = [];
    while (i < lines.length && lines[i].kind !== "same") {
      (lines[i].kind === "mine" ? mine : theirs).push(lines[i].text);
      i++;
    }
    for (let r = 0; r < Math.max(mine.length, theirs.length); r++) {
      rows.push({
        left: r < mine.length ? { text: mine[r], changed: true } : null,
        right: r < theirs.length ? { text: theirs[r], changed: true } : null,
      });
    }
  }
  return rows;
}

export const MERGE_MARKERS = {
  mine: "<<<<<<< Your version",
  split: "=======",
  theirs: ">>>>>>> Other device",
} as const;

/**
 * A starting point for resolving by hand: common lines once, and every
 * difference as both versions between Git-style conflict markers.
 */
export function mergeDraft(mine: string, theirs: string): string {
  const lines = diffLines(mine, theirs);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "same") {
      out.push(lines[i].text);
      i++;
      continue;
    }
    const m: string[] = [];
    const t: string[] = [];
    while (i < lines.length && lines[i].kind !== "same") {
      (lines[i].kind === "mine" ? m : t).push(lines[i].text);
      i++;
    }
    out.push(MERGE_MARKERS.mine, ...m, MERGE_MARKERS.split, ...t, MERGE_MARKERS.theirs);
  }
  return out.join("\n");
}
