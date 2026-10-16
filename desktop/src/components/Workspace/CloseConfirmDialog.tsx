import type { SaveError, SaveErrorKind } from "../../lib/useNoteSave";
import { OverlayMotion } from "../motion/OverlayMotion";

interface CloseConfirmDialogProps {
  /** Title of the note with unsaved changes; null when unknown. */
  /**
   * Titles of every note with unsaved text (the open one and any note left
   * behind); in the error form, the note whose save failed.
   */
  noteTitles: string[];
  /** What is being left. "lock" (an e2ee vault, #545) never offers to drop the text. */
  kind: "window" | "tab" | "signout" | "lock";
  /** A save is in flight: every choice is locked until it settles. */
  saving: boolean;
  /** Why the last save before closing failed; switches the dialog to its error form. */
  error: SaveError | null;
  /** Nothing failed: newer edits arrived while saving before a vault lock (#545). */
  edited?: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

const FAILURE_TEXT: Record<SaveErrorKind, (name: string) => string> = {
  network: (name) => `${name} couldn't be saved because the server can't be reached.`,
  conflict: (name) => `${name} was changed elsewhere since you opened it, so your version wasn't saved.`,
  failed: (name) => `${name} couldn't be saved.`,
};

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"`, or `N notes` beyond three. */
function describeNotes(titles: string[]): string {
  if (titles.length === 0) return "This note";
  if (titles.length > 3) return `${titles.length} notes`;
  const quoted = titles.map((t) => `"${t || "Untitled"}"`);
  return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

const LABELS = {
  window: { when: " before closing", save: "Save & close", discard: "Close without saving" },
  tab: { when: "", save: "Save & close", discard: "Close without saving" },
  signout: { when: " before signing out", save: "Save & sign out", discard: "Sign out without saving" },
  // Locking drops the key, so unsaved text could never be encrypted again:
  // there is no "without saving" (#545).
  lock: { when: " before locking", save: "Save & lock", discard: null },
} as const;

/**
 * The unsaved-changes dialog shown before closing a note tab or the window
 * (#283). Its error form stays up after a failed "Save & close" so the text
 * is never lost without an explicit "Close without saving".
 */
export function CloseConfirmDialog({
  noteTitles,
  kind,
  saving,
  error,
  edited = false,
  onCancel,
  onDiscard,
  onSave,
}: CloseConfirmDialogProps) {
  const name = describeNotes(noteTitles);
  const plural = noteTitles.length > 1;
  const discardLabel = LABELS[kind].discard;
  if (error && edited) {
    // Not a failure: the text changed while it was being saved.
    return (
      <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={saving ? undefined : onCancel}>
        <OverlayMotion
          preset="dialog"
          className="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="close-confirm-title"
          aria-describedby="close-confirm-body"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="confirm-title" id="close-confirm-title">
            Your newest changes aren&rsquo;t saved yet
          </div>
          <div className="confirm-body" id="close-confirm-body">
            New edits arrived while the vault was locking, so it stays unlocked until they are saved.
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn" onClick={onCancel} disabled={saving}>
              Keep editing
            </button>
            <button className="confirm-btn confirm-btn--primary" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : LABELS[kind].save}
            </button>
          </div>
        </OverlayMotion>
      </OverlayMotion>
    );
  }

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={saving ? undefined : onCancel}>
      <OverlayMotion
        preset="dialog"
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
              {FAILURE_TEXT[error.kind](name)}{" "}
              {discardLabel
                ? "Your text is still here; closing without saving discards it."
                : "Your text is still here, and the vault stays unlocked until it's saved."}
              {error.kind === "failed" && <span className="confirm-detail">{error.message}</span>}
            </>
          ) : (
            <>
              {name} {plural ? "have" : "has"} changes that haven&rsquo;t been saved. What would
              you like to do{LABELS[kind].when}?
              {discardLabel && <> &ldquo;{discardLabel}&rdquo; loses these changes.</>}
            </>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={saving}>
            {error ? "Keep editing" : "Cancel"}
          </button>
          {discardLabel && (
            <button className="confirm-btn confirm-btn--danger" onClick={onDiscard} disabled={saving}>
              {discardLabel}
            </button>
          )}
          <button className="confirm-btn confirm-btn--primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : error ? "Retry" : LABELS[kind].save}
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
