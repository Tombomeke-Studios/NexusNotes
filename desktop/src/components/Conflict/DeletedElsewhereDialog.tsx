import { OverlayMotion } from "../motion/OverlayMotion";

interface DeletedElsewhereDialogProps {
  noteTitle: string;
  /** It was moved to the Trash (#569) rather than deleted for good. */
  trashed?: boolean;
  /** The new note is being created: both choices wait for it. */
  busy: boolean;
  /** Why "Keep as new note" failed; the text is still in the editor. */
  error: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}

/**
 * Asked when another device deleted the open note while it held text the
 * server never confirmed (#561). It has no cancel: closing it either way
 * would leave an editor on a note that no longer exists. "Keep as new note"
 * is the default (focused) choice; only "Discard" drops the text.
 */
export function DeletedElsewhereDialog({ noteTitle, trashed = false, busy, error, onKeep, onDiscard }: DeletedElsewhereDialogProps) {
  const name = `"${noteTitle || "Untitled"}"`;
  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay">
      <OverlayMotion
        preset="dialog"
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="deleted-elsewhere-title"
        aria-describedby="deleted-elsewhere-body"
      >
        <div className="confirm-title" id="deleted-elsewhere-title">
          {trashed ? "Note moved to the Trash elsewhere" : "Note deleted elsewhere"}
        </div>
        <div className="confirm-body" id="deleted-elsewhere-body">
          {name} was {trashed ? "moved to the Trash" : "deleted"} on another device. Your unsaved text is still here: keep it as a new
          note, or discard it.
          {error && (
            <span className="confirm-detail" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--danger" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          <button className="confirm-btn confirm-btn--primary" onClick={onKeep} disabled={busy} autoFocus>
            {busy ? "Creating…" : "Keep as new note"}
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
