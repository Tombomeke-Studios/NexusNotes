import { useState } from "react";
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
 * The "encrypt this vault" choice shown while creating a vault (on by
 * default, #360): passphrase + confirm fields while on, and a short warning
 * with a plain-language explanation on request while off. Validation lives in
 * lib/passphrase; the parent decides when to submit.
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
  const [explained, setExplained] = useState(false);

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
        <span>End-to-end encrypt this vault (recommended)</span>
      </label>
      {!enabled && (
        <div className="enc-off-warning" role="note">
          <div className="enc-off-summary">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1.8l6.5 11.4H1.5L8 1.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6.3v3.3M8 11.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>Not end-to-end encrypted: the server could read this vault.</span>
          </div>
          <button
            type="button"
            className="enc-off-more"
            aria-expanded={explained}
            onClick={() => setExplained((v) => !v)}
          >
            What does this mean?
          </button>
          {explained && (
            <div className="enc-off-details">
              <p>
                Your notes are still stored encrypted, so a hacker who steals the
                database can&rsquo;t read them.
              </p>
              <p>
                But the server can unlock them, so the people who run it could read
                your notes if they wanted to.
              </p>
              <p>
                With end-to-end encryption, only you hold the key: your notes are
                locked on your own device, and not even the server can open them.
                Keep it on for anything private.
              </p>
            </div>
          )}
        </div>
      )}
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
            Only you can open this vault. Pick a passphrase you&rsquo;ll remember:
            if you lose it and the recovery code shown next, nobody can get your
            notes back.
          </p>
        </div>
      )}
    </div>
  );
}
