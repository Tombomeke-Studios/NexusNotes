import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useIsPresent } from "framer-motion";
import { OverlayMotion } from "../motion/OverlayMotion";
import { notes as notesApi } from "../../lib/api";
import {
  diffLines,
  foldUnchanged,
  isChangedRow,
  numberSideRows,
  sideBySide,
  type DiffLine,
  type NumberedSideRow,
} from "../../lib/diff";
import { deviceLabel, diffSummary, groupByDay, loadVersionText } from "../../lib/versionHistory";
import type { VaultLike } from "../../lib/vaultKeys";
import type { Note, NoteVersionInfo } from "../../lib/types";
import "../Conflict/Conflict.css";
import "./VersionHistory.css";

interface VersionHistoryDialogProps {
  /** The open note (plaintext state). */
  note: Note;
  vault: VaultLike;
  /** The editor's text, which "Current text" compares against. */
  currentText: string;
  /** Owners and editors may restore; viewers only browse. */
  canWrite: boolean;
  thisDeviceId: string;
  deviceNames: Map<string, string>;
  /** Restores a version; resolves with an error message, or null on success. */
  onRestore: (versionId: string) => Promise<string | null>;
  onClose: () => void;
  listVersions?: (noteId: string) => Promise<NoteVersionInfo[]>;
  loadText?: (vault: VaultLike, noteId: string, versionId: string) => Promise<string>;
}

const CURRENT = "current";

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeOf = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Version history of a note (#415-#417), like Obsidian's file recovery: the
 * snapshots the server keeps per device every few minutes, a diff of the
 * selected one against the current text or another version (side by side or
 * inline), and restoring it. Restoring happens on the server as a new
 * version, so the text it replaces stays in the history.
 */
export function VersionHistoryDialog({
  note,
  vault,
  currentText,
  canWrite,
  thisDeviceId,
  deviceNames,
  onRestore,
  onClose,
  listVersions = notesApi.versions,
  loadText = loadVersionText,
}: VersionHistoryDialogProps) {
  const present = useIsPresent();
  const [versions, setVersions] = useState<NoteVersionInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string>(CURRENT);
  const [mode, setMode] = useState<"split" | "inline">("split");
  const [texts, setTexts] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const titleRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    listVersions(note.id)
      .then((list) => {
        if (!active) return;
        setVersions(list);
        // Open on the newest version that differs from the saved note.
        const first = list.find((v) => v.checksum !== note.checksum) ?? list[0];
        setSelected(first?.id ?? null);
      })
      .catch(() => active && setListError("Couldn't load the version history."));
    return () => {
      active = false;
    };
    // Loaded once per opened note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Load the texts the diff needs, once each.
  const needed = [selected, compareTo === CURRENT ? null : compareTo].filter((id): id is string => !!id);
  const missing = needed.filter((id) => !texts.has(id)).join(",");
  useEffect(() => {
    if (!missing) return;
    let active = true;
    for (const id of missing.split(",")) {
      loadText(vault, note.id, id)
        .then((text) => active && setTexts((prev) => new Map(prev).set(id, text)))
        .catch(() => active && setLoadError("Couldn't load this version."));
    }
    return () => {
      active = false;
    };
    // `missing` names exactly what to fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  useEffect(() => {
    if (!present) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [present, busy, onClose]);

  const left = selected ? texts.get(selected) : undefined;
  const right = compareTo === CURRENT ? currentText : texts.get(compareTo);
  const lines: DiffLine[] | null = useMemo(
    () => (left === undefined || right === undefined ? null : diffLines(left, right)),
    [left, right],
  );
  const rows = useMemo(() => (lines ? numberSideRows(sideBySide(lines)) : []), [lines]);
  const segments = useMemo(() => foldUnchanged<NumberedSideRow>(rows, isChangedRow), [rows]);
  const inlineSegments = useMemo(
    () => (lines ? foldUnchanged(lines, (l) => l.kind !== "same") : []),
    [lines],
  );
  const summary = lines ? diffSummary(lines) : null;
  const identical = !!summary && summary.onlyLeft === 0 && summary.onlyRight === 0;
  const sameAsCurrent = left !== undefined && left === currentText;

  useEffect(() => setUnfolded(new Set()), [selected, compareTo, mode]);

  const groups = useMemo(() => (versions ? groupByDay(versions) : []), [versions]);
  const currentId = versions?.find((v) => v.checksum === note.checksum)?.id;
  const selectedInfo = versions?.find((v) => v.id === selected);
  const rightLabel =
    compareTo === CURRENT
      ? "Current text"
      : `Version of ${dateTimeOf(versions?.find((v) => v.id === compareTo)?.updated_at ?? "")}`;

  const restore = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setRestoreError(null);
    const error = await onRestore(selected);
    setBusy(false);
    if (error) setRestoreError(error);
    else onClose();
  };

  // Up/Down move through the list like a native listbox.
  const onListKey = (e: React.KeyboardEvent) => {
    if (!versions || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const i = versions.findIndex((v) => v.id === selected);
    const next = versions[Math.max(0, Math.min(versions.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      setSelected(next.id);
      listRef.current?.querySelector<HTMLElement>(`[data-version-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  };

  const fold = (id: number, count: number, cols: number) => (
    <tr key={`f${id}`} className="conflict-fold">
      <td colSpan={cols}>
        <button className="conflict-fold-btn" onClick={() => setUnfolded((prev) => new Set(prev).add(id))}>
          Show {count} unchanged lines
        </button>
      </td>
    </tr>
  );

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={busy ? undefined : onClose}>
      <OverlayMotion
        preset="dialog"
        className="conflict-dialog vh-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vh-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vh-head">
          <div className="confirm-title" id="vh-title" ref={titleRef} tabIndex={-1}>
            Version history
          </div>
          <span className="vh-note">{note.title || "Untitled"}</span>
        </div>

        {listError ? (
          <p className="conflict-status">{listError}</p>
        ) : versions === null ? (
          <p className="conflict-status">Loading versions&hellip;</p>
        ) : versions.length === 0 ? (
          <p className="conflict-status">
            No saved versions yet. A version is kept every few minutes while you edit.
          </p>
        ) : (
          <div className="vh-body">
            <div
              className="vh-list"
              role="listbox"
              aria-label="Versions"
              tabIndex={0}
              ref={listRef}
              onKeyDown={onListKey}
              aria-activedescendant={selected ? `vh-${selected}` : undefined}
            >
              {groups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <div className="vh-day">{group.label}</div>
                  {group.items.map((v) => (
                    <div
                      key={v.id}
                      id={`vh-${v.id}`}
                      data-version-id={v.id}
                      role="option"
                      aria-selected={v.id === selected}
                      className={`vh-item${v.id === selected ? " vh-item--active" : ""}`}
                      onClick={() => setSelected(v.id)}
                    >
                      <span className="vh-time">{timeOf(v.updated_at)}</span>
                      <span className="vh-device">{deviceLabel(v.device_id, thisDeviceId, deviceNames)}</span>
                      {v.id === currentId && <span className="vh-badge">Current</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="vh-main">
              <div className="vh-toolbar">
                <label className="vh-compare">
                  <span>Compare with</span>
                  <select
                    aria-label="Compare with"
                    value={compareTo}
                    onChange={(e) => setCompareTo(e.target.value)}
                  >
                    <option value={CURRENT}>Current text</option>
                    {versions
                      .filter((v) => v.id !== selected)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {dateTimeOf(v.updated_at)}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="vh-mode" role="group" aria-label="Diff layout">
                  <button
                    className={`vh-mode-btn${mode === "split" ? " vh-mode-btn--on" : ""}`}
                    aria-pressed={mode === "split"}
                    onClick={() => setMode("split")}
                  >
                    Side by side
                  </button>
                  <button
                    className={`vh-mode-btn${mode === "inline" ? " vh-mode-btn--on" : ""}`}
                    aria-pressed={mode === "inline"}
                    onClick={() => setMode("inline")}
                  >
                    Inline
                  </button>
                </div>
              </div>

              {loadError ? (
                <p className="conflict-status">{loadError}</p>
              ) : !lines ? (
                <p className="conflict-status">Loading this version&hellip;</p>
              ) : identical ? (
                <p className="conflict-status">
                  {compareTo === CURRENT
                    ? "This version is the same as the current text."
                    : "These two versions are the same."}
                </p>
              ) : (
                <>
                  <div className="conflict-legend">
                    <span className="conflict-count">
                      {plural(summary!.onlyLeft, "line", "lines")} only in this version ·{" "}
                      {plural(summary!.onlyRight, "line", "lines")} only in{" "}
                      {compareTo === CURRENT ? "the current text" : "the other version"}
                    </span>
                  </div>
                  <div className="conflict-scroll">
                    {mode === "split" ? (
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
                              {selectedInfo ? `This version (${dateTimeOf(selectedInfo.updated_at)})` : "This version"}
                            </th>
                            <th colSpan={2} scope="colgroup" className="conflict-side conflict-side--theirs">
                              {rightLabel}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {segments.map((seg, i) =>
                            seg.kind === "rows" || unfolded.has(seg.id) ? (
                              <Fragment key={i}>
                                {seg.rows.map((row, j) => (
                                  <tr key={j}>
                                    <SideCellView no={row.leftNo} cell={row.left} side="mine" />
                                    <SideCellView no={row.rightNo} cell={row.right} side="theirs" />
                                  </tr>
                                ))}
                              </Fragment>
                            ) : (
                              fold(seg.id, seg.rows.length, 4)
                            ),
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <ul className="vh-inline" aria-label="Differences">
                        {inlineSegments.map((seg, i) =>
                          seg.kind === "rows" || unfolded.has(seg.id) ? (
                            <Fragment key={i}>
                              {seg.rows.map((line, j) => (
                                <li
                                  key={j}
                                  className="conflict-line vh-inline-line"
                                  data-changed={line.kind === "same" ? undefined : line.kind}
                                >
                                  <span className="vh-sign" aria-hidden="true">
                                    {line.kind === "mine" ? "−" : line.kind === "theirs" ? "+" : " "}
                                  </span>
                                  {line.text || " "}
                                </li>
                              ))}
                            </Fragment>
                          ) : (
                            <li key={i} className="vh-inline-fold">
                              <button
                                className="conflict-fold-btn"
                                onClick={() => setUnfolded((prev) => new Set(prev).add(seg.id))}
                              >
                                Show {seg.rows.length} unchanged lines
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {restoreError && (
          <div className="conflict-error" role="alert">
            {restoreError}
          </div>
        )}

        <div className="conflict-actions">
          <span className="vh-hint">
            {canWrite
              ? "Restoring keeps the current text in the history."
              : "You can view this history but not restore versions."}
          </span>
          <span className="conflict-actions-gap" />
          <button className="confirm-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="confirm-btn confirm-btn--primary"
            onClick={restore}
            disabled={!canWrite || busy || !selected || left === undefined || sameAsCurrent}
          >
            {busy ? "Restoring…" : "Restore this version"}
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}

function SideCellView({ no, cell, side }: { no: number | null; cell: NumberedSideRow["left"]; side: "mine" | "theirs" }) {
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
        {cell.text || " "}
      </td>
    </>
  );
}
