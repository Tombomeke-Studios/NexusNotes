import { OverlayMotion } from "../motion/OverlayMotion";

/** How many titles a multi-delete lists before "and N more". */
const LISTED_TITLES = 5;

interface DeleteConfirmDialogProps {
  /** Titles of the notes about to be moved to the Trash (one or more). */
  noteTitles: string[];
  /** The folder being deleted, when these are its notes. */
  folder?: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asked before any note is deleted (#568). Deleting moves notes to the
 * vault's Trash, where they can be restored for 30 days (#569), so the
 * button is the normal primary one. Names the note, the folder, or gives
 * the count for several; Cancel is the focused default, and Escape or a
 * click outside cancels.
 */
export function DeleteConfirmDialog({ noteTitles, folder = null, busy, error, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  const count = noteTitles.length;
  const single = count === 1 && folder === null;
  const folderName = folder?.split("/").pop() || folder;
  const subject =
    folder !== null
      ? `the folder "${folderName}"`
      : single
        ? noteTitles[0]
          ? `"${noteTitles[0]}"`
          : "this note"
        : `${count} notes`;
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
          Move {subject} to the Trash?
        </div>
        <div className="confirm-body" id="delete-confirm-body">
          {folder !== null
            ? `Its ${count === 1 ? "note goes" : `${count} notes go`} to the Trash, for everyone with access to this vault. You can restore ${count === 1 ? "it" : "them"} for 30 days.`
            : `${single ? "It is" : "They are"} removed for everyone with access to this vault. You can restore ${single ? "it" : "them"} for 30 days.`}
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
          <button className="confirm-btn confirm-btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
