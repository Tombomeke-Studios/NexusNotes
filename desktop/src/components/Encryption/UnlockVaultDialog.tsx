import { useState } from "react";
import { passphraseError } from "../../lib/passphrase";
import "./Encryption.css";

interface UnlockVaultDialogProps {
  vaultName: string;
  /** Attempts the unlock; must reject when the passphrase is wrong. */
  onUnlock: (passphrase: string) => Promise<void>;
  /**
   * Recovery (#176): unlock with the backup code and set a new passphrase in
   * one step; must reject when the code is wrong. The parent shows the fresh
   * recovery code afterwards.
   */
  onRecover: (recoveryCode: string, newPassphrase: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Passphrase prompt for opening a locked e2ee vault, with a recovery-code
 * fallback for a forgotten passphrase. Key derivation is deliberately slow
 * (Argon2id), so the dialog shows a busy state while deriving. Unlocked keys
 * live in memory only (vaultKeySession).
 */
export function UnlockVaultDialog({ vaultName, onUnlock, onRecover, onCancel }: UnlockVaultDialogProps) {
  const [mode, setMode] = useState<"passphrase" | "recovery">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recoveryValid = !!code.trim() && passphraseError(newPass, confirm) === null;
  const validation = mode === "recovery" && (newPass || confirm) ? passphraseError(newPass, confirm) : null;

  const switchMode = (m: "passphrase" | "recovery") => {
    setMode(m);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "passphrase") {
        if (!passphrase) return;
        await onUnlock(passphrase);
      } else {
        if (!recoveryValid) return;
        await onRecover(code, newPass);
      }
    } catch {
      setError(mode === "passphrase" ? "Wrong passphrase — try again" : "That recovery code does not unlock this vault");
    } finally {
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

        {mode === "passphrase" ? (
          <>
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
          </>
        ) : (
          <>
            <div className="confirm-body">
              Enter the recovery code you saved when this vault was set up, and
              choose a new passphrase. A fresh recovery code will be shown after.
            </div>
            <div className="enc-fields">
              <input
                className="enc-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Recovery code (XXXX-XXXX-…)"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={busy}
              />
              <input
                className="enc-input"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="New passphrase"
                autoComplete="new-password"
                disabled={busy}
              />
              <input
                className="enc-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="Confirm new passphrase"
                autoComplete="new-password"
                disabled={busy}
              />
            </div>
          </>
        )}

        {(error || validation) && <div className="enc-error enc-unlock-error">{error ?? validation}</div>}

        <button
          className="enc-mode-link"
          disabled={busy}
          onClick={() => switchMode(mode === "passphrase" ? "recovery" : "passphrase")}
        >
          {mode === "passphrase" ? "Forgot the passphrase? Use your recovery code" : "Back to passphrase unlock"}
        </button>

        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="confirm-btn confirm-btn--primary"
            onClick={submit}
            disabled={busy || (mode === "passphrase" ? !passphrase : !recoveryValid)}
          >
            {busy ? "Unlocking..." : mode === "passphrase" ? "Unlock" : "Recover vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
