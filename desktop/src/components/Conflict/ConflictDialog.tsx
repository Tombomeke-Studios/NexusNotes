import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useIsPresent } from "framer-motion";
import { OverlayMotion } from "../motion/OverlayMotion";
import { diffLines, mergeDraft, sideBySide, MERGE_MARKERS, type SideRow } from "../../lib/diff";
import type { ServerVersion } from "../../lib/useNoteSave";
import "./Conflict.css";

interface ConflictDialogProps {
  noteTitle: string;
  /** The user's text, as it is in the editor. */
  mine: string;
  /** The version the other device saved; null while it is still being read. */
  theirs: ServerVersion | null;
  /** The chosen text is being saved: every choice is locked. */
  busy: boolean;
  /** Why the last attempt failed, if it did. */
  error: string | null;
  /**
   * Called with the text the note should end up with and the checksum of the
   * other device's version that choice was made against.
   */
  onResolve: (content: string, basedOn: string) => void;
  onCancel: () => void;
}

/** Unchanged lines kept visible around each change. */
const CONTEXT = 3;
/** Shorter unchanged runs than this are shown in full rather than folded. */
const MIN_FOLD = 4;

interface NumberedRow extends SideRow {
  leftNo: number | null;
  rightNo: number | null;
}

type Segment = { kind: "rows"; rows: NumberedRow[] } | { kind: "fold"; id: number; rows: NumberedRow[] };

const isChanged = (r: SideRow) => !!(r.left?.changed || r.right?.changed);

function numberRows(rows: SideRow[]): NumberedRow[] {
  let l = 0;
  let r = 0;
  return rows.map((row) => ({ ...row, leftNo: row.left ? ++l : null, rightNo: row.right ? ++r : null }));
}

/** Splits the rows into visible stretches and folds of unchanged lines far from any change. */
function segment(rows: NumberedRow[]): Segment[] {
  const out: Segment[] = [];
  const push = (list: NumberedRow[]) => {
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
    const keepHead = start === 0 ? 0 : CONTEXT;
    const keepTail = i === rows.length ? 0 : CONTEXT;
    if (run.length - keepHead - keepTail < MIN_FOLD) {
      push(run);
      continue;
    }
    push(run.slice(0, keepHead));
    out.push({ kind: "fold", id: start + keepHead, rows: run.slice(keepHead, run.length - keepTail) });
    push(run.slice(run.length - keepTail));
  }
  return out;
}

function Cell({ no, cell, side }: { no: number | null; cell: SideRow["left"]; side: "mine" | "theirs" }) {
  if (!cell) {
    return (
      <>
        <td className="conflict-no" />
        <td className="conflict-line conflict-line--empty" />
      </>
    );
  }
  return (
    <>
      <td className="conflict-no">{no}</td>
      <td className="conflict-line" data-changed={cell.changed ? side : undefined}>
        {cell.text || " "}
      </td>
    </>
  );
}

function Row({ row }: { row: NumberedRow }) {
  return (
    <tr>
      <Cell no={row.leftNo} cell={row.left} side="mine" />
      <Cell no={row.rightNo} cell={row.right} side="theirs" />
    </tr>
  );
}

const lines = (text: string) => text.split(/\r?\n/);
const separators = (text: string) => lines(text).filter((line) => line === MERGE_MARKERS.split).length;

/**
 * Whether a merge draft still holds conflict markers: the outer markers, or a
 * "=======" line neither version had (a left-over separator; a heading
 * underline both versions share is fine).
 */
const unresolved = (draft: string, mine: string, theirs: string) =>
  lines(draft).some((line) => line === MERGE_MARKERS.mine || line === MERGE_MARKERS.theirs) ||
  separators(draft) > Math.max(separators(mine), separators(theirs));

/**
 * Resolving a note that was changed on another device while it was being
 * edited here (#225): both versions side by side, then keep mine, use theirs,
 * or merge by hand. Every choice names the version it was made against, so a
 * newer save on the other device is never overwritten unseen.
 */
export function ConflictDialog({ noteTitle, mine, theirs, busy, error, onResolve, onCancel }: ConflictDialogProps) {
  /** The merge draft and the version of the other device it was built from. */
  const [draft, setDraft] = useState<{ text: string; base: ServerVersion } | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  /** The first version of the other device this dialog showed. */
  const [firstSeen, setFirstSeen] = useState<string | null>(theirs?.checksum ?? null);
  const titleRef = useRef<HTMLDivElement>(null);
  const present = useIsPresent();

  const theirsText = theirs?.content ?? null;
  const rows = useMemo(
    () => (theirsText === null ? [] : numberRows(sideBySide(diffLines(mine, theirsText)))),
    [mine, theirsText],
  );
  const segments = useMemo(() => segment(rows), [rows]);
  const differing = rows.filter(isChanged).length;
  const ready = theirs !== null;

  useEffect(() => {
    if (firstSeen === null && theirs) setFirstSeen(theirs.checksum);
  }, [firstSeen, theirs]);
  const savedAgain = !!theirs && firstSeen !== null && theirs.checksum !== firstSeen;
  const draftOutdated = !!draft && !!theirs && draft.base.checksum !== theirs.checksum;

  // Focus the title rather than a button, so a stray Enter can't pick a
  // version by accident; screen readers start reading from there.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    // Once closing (exit animation), Escape belongs to whatever is underneath.
    if (!present) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [present, busy, onCancel]);

  const name = `“${noteTitle || "Untitled"}”`;
  const merging = draft !== null;
  const draftBlocked = !!draft && unresolved(draft.text, mine, draft.base.content);

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={busy ? undefined : onCancel}>
      <OverlayMotion
        preset="dialog"
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-summary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="conflict-head">
          <div className="confirm-title" id="conflict-title" ref={titleRef} tabIndex={-1}>
            {merging ? "Merge by hand" : "Resolve conflict"}
          </div>
          <p className="conflict-summary" id="conflict-summary">
            {merging ? (
              <>
                Both versions are below, between conflict markers. Keep what you want from each and
                remove the markers, then save.
              </>
            ) : (
              <>
                {name} was changed on another device while you were editing it here. Choose the
                version to keep, or merge them by hand.
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="conflict-error" role="alert">
            {error}
          </div>
        )}

        {(draftOutdated || savedAgain) && (
          <div className="conflict-notice-inline" role="status">
            {draftOutdated ? (
              <>
                The other device saved this note again since you started merging. Go{" "}
                <strong>Back to compare</strong> to see its newest version, then merge again.
              </>
            ) : (
              <>The other device saved this note again while this was open. The comparison below shows its newest version.</>
            )}
          </div>
        )}

        {merging ? (
          <div className="conflict-merge">
            <textarea
              id="conflict-merge-text"
              className="conflict-merge-text"
              aria-label="Merged text"
              value={draft.text}
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            {draftBlocked && (
              <p className="conflict-hint">
                Remove the conflict markers (<code>{MERGE_MARKERS.mine}</code>,{" "}
                <code>{MERGE_MARKERS.split}</code> and <code>{MERGE_MARKERS.theirs}</code>) before
                saving.
              </p>
            )}
          </div>
        ) : !ready ? (
          <p className="conflict-status">Loading the other device&rsquo;s version&hellip;</p>
        ) : differing === 0 ? (
          <p className="conflict-status">Both versions are the same. Either choice keeps this text.</p>
        ) : (
          <>
            <div className="conflict-legend">
              <span className="conflict-count">
                {differing} {differing === 1 ? "line differs" : "lines differ"}
              </span>
            </div>
            <div className="conflict-scroll">
              <table className="conflict-table" aria-label="Differences">
                <colgroup>
                  <col className="conflict-col-no" />
                  <col />
                  <col className="conflict-col-no" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2} scope="colgroup" className="conflict-side conflict-side--mine">
                      Your version
                    </th>
                    <th colSpan={2} scope="colgroup" className="conflict-side conflict-side--theirs">
                      Other device
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg, i) =>
                    seg.kind === "rows" || unfolded.has(seg.id) ? (
                      <Fragment key={i}>
                        {seg.rows.map((row, j) => (
                          <Row key={j} row={row} />
                        ))}
                      </Fragment>
                    ) : (
                      <tr key={i} className="conflict-fold">
                        <td colSpan={4}>
                          <button
                            className="conflict-fold-btn"
                            onClick={() => setUnfolded((prev) => new Set(prev).add(seg.id))}
                          >
                            Show {seg.rows.length} unchanged lines
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="conflict-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className="conflict-actions-gap" />
          {merging ? (
            <>
              <button className="confirm-btn" onClick={() => setDraft(null)} disabled={busy}>
                Back to compare
              </button>
              <button
                className="confirm-btn confirm-btn--primary"
                onClick={() => draft && !draftOutdated && onResolve(draft.text, draft.base.checksum)}
                disabled={busy || draftBlocked || draftOutdated}
              >
                Save merged
              </button>
            </>
          ) : (
            <>
              <button
                className="confirm-btn"
                onClick={() => theirs && setDraft({ text: mergeDraft(mine, theirs.content), base: theirs })}
                disabled={busy || !ready}
              >
                Merge by hand&hellip;
              </button>
              <button
                className="confirm-btn"
                onClick={() => theirs && onResolve(theirs.content, theirs.checksum)}
                disabled={busy || !ready}
                title="Replace your text with the other device's version"
              >
                Use theirs
              </button>
              <button
                className="confirm-btn confirm-btn--primary"
                onClick={() => theirs && onResolve(mine, theirs.checksum)}
                disabled={busy || !ready}
                title="Save your version over the other device's changes"
              >
                Keep mine
              </button>
            </>
          )}
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
