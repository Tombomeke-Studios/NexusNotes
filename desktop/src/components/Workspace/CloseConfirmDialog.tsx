import type { SaveError, SaveErrorKind } from "../../lib/useNoteSave";

interface CloseConfirmDialogProps {
  /** Title of the note with unsaved changes; null when unknown. */
  noteTitle: string | null;
  kind: "window" | "tab";
  /** A save is in flight: every choice is locked until it settles. */
  saving: boolean;
  /** Why the last save before closing failed; switches the dialog to its error form. */
  error: SaveError | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

const FAILURE_TEXT: Record<SaveErrorKind, (name: string) => string> = {
  network: (name) => `${name} couldn't be saved because the server can't be reached.`,
  conflict: (name) => `${name} was changed elsewhere since you opened it, so your version wasn't saved.`,
  failed: (name) => `${name} couldn't be saved.`,
};

/**
 * The unsaved-changes dialog shown before closing a note tab or the window
 * (#283). Its error form stays up after a failed "Save & close" so the text
 * is never lost without an explicit "Close without saving".
 */
export function CloseConfirmDialog({
  noteTitle,
  kind,
  saving,
  error,
  onCancel,
  onDiscard,
  onSave,
}: CloseConfirmDialogProps) {
  const name = noteTitle !== null ? `"${noteTitle || "Untitled"}"` : "This note";

  return (
    <div className="confirm-overlay" onClick={saving ? undefined : onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        aria-describedby="close-confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-title" id="close-confirm-title">
          {error ? "Couldn't save your changes" : "Unsaved changes"}
        </div>
        <div className="confirm-body" id="close-confirm-body">
          {error ? (
            <>
              {FAILURE_TEXT[error.kind](name)} Your text is still here; closing without saving
              discards it.
              {error.kind === "failed" && <span className="confirm-detail">{error.message}</span>}
            </>
          ) : (
            <>
              {name} has changes that haven&rsquo;t been saved. What would you like to do
              {kind === "window" ? " before closing" : ""}?
            </>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={saving}>
            {error ? "Keep editing" : "Cancel"}
          </button>
          <button className="confirm-btn confirm-btn--danger" onClick={onDiscard} disabled={saving}>
            Close without saving
          </button>
          <button className="confirm-btn confirm-btn--primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : error ? "Retry" : "Save & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
