import { useState } from "react";
import { EncryptionSetup } from "./EncryptionSetup";
import { passphraseError } from "../../lib/passphrase";
import "./Encryption.css";
import { OverlayMotion } from "../motion/OverlayMotion";

interface CreateVaultDialogProps {
  onCreate: (name: string, passphrase?: string) => void;
  onClose: () => void;
}

/**
 * Modal for creating an additional vault (the very first vault uses the
 * FirstRunVault card instead). Offers the same E2EE choice as first run.
 */
export function CreateVaultDialog({ onCreate, onClose }: CreateVaultDialogProps) {
  const [name, setName] = useState("");
  // End-to-end encryption is the default; turning it off shows a warning (#360).
  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");

  const valid = !!name.trim() && (!encrypt || passphraseError(passphrase, confirm) === null);

  const submit = () => {
    if (!valid) return;
    onCreate(name.trim(), encrypt ? passphrase : undefined);
  };

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={onClose}>
      <OverlayMotion
        preset="dialog"
        className="confirm-dialog"
        role="dialog"
        aria-label="New vault"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="confirm-title">New vault</div>
        <input
          className="enc-input enc-vault-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Vault name..."
          autoFocus
        />
        <EncryptionSetup
          enabled={encrypt}
          passphrase={passphrase}
          confirm={confirm}
          onToggle={setEncrypt}
          onPassphraseChange={setPassphrase}
          onConfirmChange={setConfirm}
          onSubmit={submit}
        />
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn--primary" disabled={!valid} onClick={submit}>
            Create vault
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
