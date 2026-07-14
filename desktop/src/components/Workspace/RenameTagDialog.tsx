import { useState } from "react";
import { normalizeTag } from "../../lib/tagRename";

interface RenameTagDialogProps {
  tag: string;
  /** Number of notes that will be rewritten (tag + descendants). */
  affectedCount: number;
  onRename: (oldTag: string, newTag: string) => void;
  onClose: () => void;
}

/**
 * Rename a tag across the vault (#154). Renaming a parent tag cascades to its
 * nested children, so the dialog states how many notes will change.
 */
export function RenameTagDialog({ tag, affectedCount, onRename, onClose }: RenameTagDialogProps) {
  const [value, setValue] = useState(tag);
  const next = normalizeTag(value);
  const valid = next.length > 0 && next !== tag;

  const submit = () => {
    if (valid) onRename(tag, next);
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-label={`Rename #${tag}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="confirm-title">Rename #{tag}</div>
        <div className="confirm-body">
          Renames the tag in {affectedCount} note{affectedCount === 1 ? "" : "s"}
          {tag.includes("/") ? "" : " (including any nested tags)"}.
        </div>
        <input
          className="enc-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="New tag name"
          autoFocus
          spellCheck={false}
        />
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn--primary" disabled={!valid} onClick={submit}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
