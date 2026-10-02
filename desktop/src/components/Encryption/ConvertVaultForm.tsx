import { useState } from "react";
import { ApiError } from "../../lib/api";
import { passphraseError } from "../../lib/passphrase";
import "./Encryption.css";

interface ConvertVaultFormProps {
  vaultName: string;
  /** Encrypts every note and switches the vault to e2ee; rejects on failure. */
  onConvert: (passphrase: string) => Promise<void>;
}

/** Plain-language reason for a failed conversion; nothing changed either way. */
function convertError(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    return /attachment/i.test(err.message)
      ? "This vault has attachments, which can't be end-to-end encrypted yet. Nothing was changed."
      : "This vault is already end-to-end encrypted.";
  }
  if (err instanceof ApiError && err.status === 409) {
    return "Notes kept changing while encrypting (is another device editing?). Nothing was changed; try again in a moment.";
  }
  return "Encrypting the vault failed. Nothing was changed.";
}

/**
 * "Encrypt this vault" for a standard vault the user owns (Settings > Sync,
 * #361): asks for a new passphrase, then the parent encrypts every note on
 * this device and shows the one-time recovery code.
 */
export function ConvertVaultForm({ vaultName, onConvert }: ConvertVaultFormProps) {
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = passphrase || confirm ? passphraseError(passphrase, confirm) : null;
  const valid = passphraseError(passphrase, confirm) === null;

  const close = () => {
    setOpen(false);
    setPassphrase("");
    setConfirm("");
    setError(null);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConvert(passphrase);
      close();
    } catch (err) {
      setError(convertError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="settings-export-btn" onClick={() => setOpen(true)}>
        Encrypt this vault…
      </button>
    );
  }

  return (
    <div className="enc-fields enc-change-form">
      <p className="enc-warning">
        &ldquo;{vaultName}&rdquo; will be locked with a passphrase only you know: nobody
        else, not even the server, can read it afterwards. You&rsquo;ll need the passphrase
        (or the recovery code shown next) on every device. Lose both and the notes are gone.
      </p>
      <input
        className="enc-input"
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="New vault passphrase"
        autoComplete="new-password"
        autoFocus
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
        placeholder="Confirm passphrase"
        autoComplete="new-password"
        disabled={busy}
      />
      {(error ?? validation) && <div className="enc-error">{error ?? validation}</div>}
      <div className="enc-change-actions">
        <button className="confirm-btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className="confirm-btn confirm-btn--primary" onClick={submit} disabled={!valid || busy}>
          {busy ? "Encrypting…" : "Encrypt vault"}
        </button>
      </div>
    </div>
  );
}
