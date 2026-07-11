import { useState } from "react";
import { Logo } from "../Logo";
import { EncryptionSetup } from "../Encryption/EncryptionSetup";
import { passphraseError } from "../../lib/passphrase";
import "./Workspace.css";

interface FirstRunVaultProps {
  onCreate: (name: string, passphrase?: string) => void;
}

/**
 * Shown in the center column when the account has no vaults yet, so a new
 * user has a clear path to their first vault (notes can't exist without one).
 * Offers the same E2EE opt-in as the new-vault dialog.
 */
export function FirstRunVault({ onCreate }: FirstRunVaultProps) {
  const [name, setName] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");

  const valid = !!name.trim() && (!encrypt || passphraseError(passphrase, confirm) === null);

  const submit = () => {
    if (!valid) return;
    onCreate(name.trim(), encrypt ? passphrase : undefined);
  };

  return (
    <div className="firstrun">
      <div className="firstrun-card">
        <div className="firstrun-logo">
          <Logo size={48} variant="animated" />
        </div>
        <h1 className="firstrun-title">Welcome to NexusNotes</h1>
        <p className="firstrun-subtitle">
          Create your first vault to start writing. A vault holds your notes,
          links, and tags.
        </p>
        <div className="firstrun-form">
          <input
            className="firstrun-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Vault name (e.g. Personal)"
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
          <button className="firstrun-button" onClick={submit} disabled={!valid}>
            Create vault
          </button>
        </div>
      </div>
    </div>
  );
}
