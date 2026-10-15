import { OverlayMotion } from "../motion/OverlayMotion";

/** How many titles a multi-delete lists before "and N more". */
const LISTED_TITLES = 5;

interface DeleteConfirmDialogProps {
  /** Titles of the notes about to be deleted (one or more). */
  noteTitles: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asked before any note is deleted (#568): deleting is permanent until there
 * is a Trash. Names the note, or gives the count for several; Cancel is the
 * focused default, and Escape or a click outside cancels.
 */
export function DeleteConfirmDialog({ noteTitles, busy, error, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  const count = noteTitles.length;
  const single = count === 1;
  const subject = single ? (noteTitles[0] ? `"${noteTitles[0]}"` : "this note") : `${count} notes`;
  // A multi-delete names what goes: the first titles, then a count (#586).
  const shown = single ? [] : noteTitles.slice(0, LISTED_TITLES);
  const more = count - shown.length;

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={busy ? undefined : onCancel}>
      <OverlayMotion
        preset="dialog"
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="confirm-title" id="delete-confirm-title">
          Delete {subject}?
        </div>
        <div className="confirm-body" id="delete-confirm-body">
          {single ? "This note" : "These notes"} and {single ? "its" : "their"} version history will be
          deleted for everyone with access to this vault. This can&rsquo;t be undone.
          {shown.length > 0 && (
            <ul className="delete-confirm-list">
              {shown.map((title, i) => (
                <li key={i}>{title || "Untitled"}</li>
              ))}
              {more > 0 && <li className="delete-confirm-more">and {more} more</li>}
            </ul>
          )}
          {error && (
            <span className="confirm-detail" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn--danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : single ? "Delete note" : `Delete ${count} notes`}
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
