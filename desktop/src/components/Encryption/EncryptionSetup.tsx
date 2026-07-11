import { passphraseError } from "../../lib/passphrase";
import "./Encryption.css";

export interface EncryptionSetupProps {
  enabled: boolean;
  passphrase: string;
  confirm: string;
  onToggle: (enabled: boolean) => void;
  onPassphraseChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  /** Fires when both fields are valid and the user presses Enter. */
  onSubmit?: () => void;
}

/**
 * The "encrypt this vault" opt-in shown while creating a vault: a toggle
 * that reveals passphrase + confirm fields and the zero-knowledge warning.
 * Validation lives in lib/passphrase; the parent decides when to submit.
 */
export function EncryptionSetup({
  enabled,
  passphrase,
  confirm,
  onToggle,
  onPassphraseChange,
  onConfirmChange,
  onSubmit,
}: EncryptionSetupProps) {
  const error = enabled && (passphrase || confirm) ? passphraseError(passphrase, confirm) : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !passphraseError(passphrase, confirm)) {
      onSubmit?.();
    }
  };

  return (
    <div className="enc-setup">
      <label className="enc-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span>End-to-end encrypt this vault</span>
      </label>
      {enabled && (
        <div className="enc-fields">
          <input
            className="enc-input"
            type="password"
            value={passphrase}
            onChange={(e) => onPassphraseChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Vault passphrase"
            autoComplete="new-password"
          />
          <input
            className="enc-input"
            type="password"
            value={confirm}
            onChange={(e) => onConfirmChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Confirm passphrase"
            autoComplete="new-password"
          />
          {error && <div className="enc-error">{error}</div>}
          <p className="enc-warning">
            Notes are encrypted on this device before upload — the server can
            never read them. If you lose both the passphrase and the recovery
            code shown next, your notes are gone for good.
          </p>
        </div>
      )}
    </div>
  );
}
