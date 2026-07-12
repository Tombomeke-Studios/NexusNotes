import { useState } from "react";
import { ApiError } from "../../lib/api";
import { passphraseError } from "../../lib/passphrase";
import "./Encryption.css";

interface ChangePassphraseFormProps {
  /**
   * Performs the re-wrap: verify the current passphrase, re-wrap the Vault
   * Key under the new one and persist the new key material. Must reject on a
   * wrong current passphrase (non-ApiError) or a failed save (ApiError).
   */
  onChange: (currentPassphrase: string, newPassphrase: string) => Promise<void>;
}

/**
 * Change-passphrase form for an e2ee vault (Settings > Sync). Only the
 * wrapped Vault Key changes — notes are never re-encrypted — and a fresh
 * recovery code is issued by the parent flow.
 */
export function ChangePassphraseForm({ onChange }: ChangePassphraseFormProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = next || confirm ? passphraseError(next, confirm) : null;
  const valid = !!current && passphraseError(next, confirm) === null;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(current, next);
      reset();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "Saving the new key material failed — your passphrase is unchanged."
          : "Current passphrase is wrong",
      );
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="settings-export-btn" onClick={() => setOpen(true)}>
        Change passphrase…
      </button>
    );
  }

  return (
    <div className="enc-fields enc-change-form">
      <input
        className="enc-input"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current passphrase"
        autoComplete="current-password"
        autoFocus
        disabled={busy}
      />
      <input
        className="enc-input"
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
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
      {(validation || error) && <div className="enc-error">{error ?? validation}</div>}
      <p className="enc-warning">
        Notes are not re-encrypted — only the vault key wrapping changes. A new
        recovery code is shown afterwards; the old one stops working.
      </p>
      <div className="enc-change-actions">
        <button
          className="confirm-btn"
          disabled={busy}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button className="confirm-btn confirm-btn--primary" disabled={!valid || busy} onClick={submit}>
          {busy ? "Re-wrapping..." : "Change passphrase"}
        </button>
      </div>
    </div>
  );
}
