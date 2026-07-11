import { useState } from "react";
import "./Encryption.css";

interface RecoveryCodeDialogProps {
  code: string;
  onDone: () => void;
}

/**
 * One-time display of the vault recovery code (docs/encryption.md). This is
 * the only moment the code exists in readable form — it never reaches the
 * server — so the dialog cannot be dismissed until the user confirms they
 * saved it. No overlay-click or Escape close on purpose.
 */
export function RecoveryCodeDialog({ code, onDone }: RecoveryCodeDialogProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the code is still selectable */
    }
  };

  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog enc-recovery" role="dialog" aria-label="Save your recovery code">
        <div className="confirm-title">Save your recovery code</div>
        <div className="confirm-body">
          This code is the <strong>only</strong> way back into this vault if
          you forget the passphrase. It is shown once and never stored
          anywhere — write it down or keep it in a password manager.
        </div>
        <div className="enc-code" data-testid="recovery-code">{code}</div>
        <button className="enc-copy" onClick={copy}>
          {copied ? "Copied" : "Copy to clipboard"}
        </button>
        <label className="enc-saved-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I have saved this recovery code somewhere safe</span>
        </label>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" disabled={!saved} onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
