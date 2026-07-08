import { useState } from "react";
import { Logo } from "../Logo";
import "./Workspace.css";

interface FirstRunVaultProps {
  onCreate: (name: string) => void;
}

/**
 * Shown in the center column when the account has no vaults yet, so a new
 * user has a clear path to their first vault (notes can't exist without one).
 */
export function FirstRunVault({ onCreate }: FirstRunVaultProps) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
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
          <button className="firstrun-button" onClick={submit} disabled={!name.trim()}>
            Create vault
          </button>
        </div>
      </div>
    </div>
  );
}
