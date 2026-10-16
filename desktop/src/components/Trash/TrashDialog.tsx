import { useState } from "react";
import { trashAgeLabel, trashFolderLabel } from "../../lib/trash";
import type { TrashEntry } from "../../lib/useTrash";
import { EmptyState } from "../EmptyState";
import { OverlayMotion } from "../motion/OverlayMotion";
import "./Trash.css";

interface TrashDialogProps {
  vaultName: string;
  entries: TrashEntry[];
  loading: boolean;
  error: string | null;
  /** Notes with a restore or delete running. */
  busyIds: ReadonlySet<string>;
  emptying: boolean;
  /** Owner or editor. */
  canRestore: boolean;
  /** Owner only: delete for good and empty. */
  canPurge: boolean;
  onRestore: (noteId: string) => void;
  onPurge: (noteId: string) => void;
  onEmpty: () => void;
  onClose: () => void;
  /** The clock for the age labels (tests). */
  now?: Date;
}

const ENCRYPTED = "Encrypted note";

type Confirming = { kind: "purge"; id: string; title: string } | { kind: "empty" };

/**
 * The vault's Trash (#569): deleted notes, with when they were deleted and
 * when they go for good. Restore puts a note back at its original path;
 * "Delete permanently" and "Empty Trash" (owner only) ask first, in the
 * danger style, since those can't be undone. Actions the role doesn't allow
 * are not shown.
 */
export function TrashDialog({
  vaultName,
  entries,
  loading,
  error,
  busyIds,
  emptying,
  canRestore,
  canPurge,
  onRestore,
  onPurge,
  onEmpty,
  onClose,
  now,
}: TrashDialogProps) {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const count = entries.length;
  const clock = now ?? new Date();

  const confirm = () => {
    if (!confirming) return;
    if (confirming.kind === "purge") onPurge(confirming.id);
    else onEmpty();
    setConfirming(null);
  };

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={onClose}>
      <OverlayMotion
        preset="dialog"
        className="confirm-dialog trash-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (confirming) setConfirming(null);
          else onClose();
        }}
      >
        <div className="trash-head">
          <div>
            <div className="confirm-title">Trash</div>
            <div className="trash-sub">
              Deleted notes from &ldquo;{vaultName}&rdquo; stay here for 30 days, then they&rsquo;re deleted for good.
            </div>
          </div>
          <button className="trash-close" aria-label="Close Trash" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="enc-error" role="alert">
            {error}
          </div>
        )}

        {count === 0 ? (
          loading ? (
            <div className="trash-loading">Loading…</div>
          ) : (
            <EmptyState compact art="trash" title="The Trash is empty">
              Notes you delete show up here for 30 days.
            </EmptyState>
          )
        ) : (
          <ul className="trash-list">
            {entries.map((entry) => {
              const title = entry.title === null ? ENCRYPTED : entry.title || "Untitled";
              const folder = trashFolderLabel(entry.folder);
              const busy = busyIds.has(entry.id) || emptying;
              return (
                <li key={entry.id} className="trash-item" aria-label={title}>
                  <svg className="trash-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  <div className="trash-item-text">
                    <span className={`trash-item-title${entry.title === null ? " trash-item-title--sealed" : ""}`} title={title}>
                      {title}
                    </span>
                    <span className="trash-item-meta">
                      {folder !== null && <span className="trash-item-folder">{folder}</span>}
                      <span>{trashAgeLabel(entry.deletedAt, entry.purgeAt, clock)}</span>
                    </span>
                  </div>
                  <div className="trash-item-actions">
                    {canRestore && (
                      <button className="confirm-btn trash-restore" onClick={() => onRestore(entry.id)} disabled={busy}>
                        {busyIds.has(entry.id) ? "Restoring…" : "Restore"}
                      </button>
                    )}
                    {canPurge && (
                      <button
                        className="trash-purge"
                        aria-label="Delete permanently"
                        title="Delete permanently"
                        onClick={() => setConfirming({ kind: "purge", id: entry.id, title })}
                        disabled={busy}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.2a1 1 0 001 .8h4.6a1 1 0 001-.8L12 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {confirming ? (
          <div className="trash-confirm" role="alertdialog" aria-labelledby="trash-confirm-title" aria-describedby="trash-confirm-body">
            <div className="trash-confirm-title" id="trash-confirm-title">
              {confirming.kind === "purge" ? `Delete "${confirming.title}" permanently?` : "Empty the Trash?"}
            </div>
            <div className="trash-confirm-body" id="trash-confirm-body">
              {confirming.kind === "purge"
                ? "The note, its version history and its attachments are deleted for good. This can't be undone."
                : `All ${count} ${count === 1 ? "note" : "notes"} in the Trash are deleted for good, with their history and attachments. This can't be undone.`}
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn" onClick={() => setConfirming(null)} autoFocus>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn--danger-solid" onClick={confirm}>
                {confirming.kind === "purge" ? "Delete permanently" : "Empty Trash"}
              </button>
            </div>
          </div>
        ) : (
          count > 0 && (
            <div className="trash-foot">
              <span className="trash-count">
                {count} {count === 1 ? "note" : "notes"}
              </span>
              {canPurge && (
                <button className="confirm-btn confirm-btn--danger" onClick={() => setConfirming({ kind: "empty" })} disabled={emptying}>
                  {emptying ? "Emptying…" : "Empty Trash"}
                </button>
              )}
            </div>
          )
        )}
      </OverlayMotion>
    </OverlayMotion>
  );
}
