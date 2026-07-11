import { useState } from "react";
import "./Encryption.css";

interface UnlockVaultDialogProps {
  vaultName: string;
  /** Attempts the unlock; must reject when the passphrase is wrong. */
  onUnlock: (passphrase: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Passphrase prompt for opening a locked e2ee vault. Key derivation is
 * deliberately slow (Argon2id), so the dialog shows a busy state while
 * deriving. The unlocked key lives in memory only (vaultKeySession).
 */
export function UnlockVaultDialog({ vaultName, onUnlock, onCancel }: UnlockVaultDialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(passphrase);
    } catch {
      setError("Wrong passphrase — try again");
      setBusy(false);
    }
  };

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-label={`Unlock ${vaultName}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <div className="confirm-title">
          <span className="enc-title-lock" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </span>
          Unlock &ldquo;{vaultName}&rdquo;
        </div>
        <div className="confirm-body">
          This vault is end-to-end encrypted. Enter its passphrase to decrypt
          your notes on this device.
        </div>
        <input
          className="enc-input"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Vault passphrase"
          autoComplete="current-password"
          autoFocus
          disabled={busy}
        />
        {error && <div className="enc-error enc-unlock-error">{error}</div>}
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="confirm-btn confirm-btn--primary"
            onClick={submit}
            disabled={!passphrase || busy}
          >
            {busy ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
