import { useEffect, useState } from "react";
import { members as membersApi } from "../../lib/api";
import type { Vault, VaultMember } from "../../lib/types";
import "./SharingDialog.css";

interface SharingDialogProps {
  vault: Vault;
  /** The signed-in user's id (used when they leave a shared vault). */
  currentUserId: string;
  /** True when the current user owns the vault (can invite / change roles). */
  isOwner: boolean;
  onClose: () => void;
  /** Called after the user leaves a shared vault, so the app can switch away. */
  onLeft: () => void;
}

/**
 * Vault sharing panel (#55): lists members and, for the owner, an invite form
 * and per-member role/remove controls. A non-owner sees the roster and a
 * "Leave vault" action.
 */
export function SharingDialog({ vault, currentUserId, isOwner, onClose, onLeft }: SharingDialogProps) {
  const [list, setList] = useState<VaultMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => membersApi.list(vault.id).then(setList).catch(() => setError("Could not load members"));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.id]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await membersApi.invite(vault.id, email.trim(), role);
      setEmail("");
      await reload();
    } catch {
      setError("Couldn't invite that person. Check the email is a registered account.");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, next: "viewer" | "editor") => {
    setList((prev) => prev?.map((m) => (m.user_id === userId ? { ...m, role: next } : m)) ?? prev);
    try {
      await membersApi.updateRole(vault.id, userId, next);
    } catch {
      reload();
    }
  };

  const remove = async (userId: string) => {
    try {
      await membersApi.remove(vault.id, userId);
      await reload();
    } catch {
      setError("Couldn't remove that member.");
    }
  };

  const leave = async () => {
    try {
      await membersApi.remove(vault.id, currentUserId);
      onLeft();
    } catch {
      setError("Couldn't leave the vault.");
    }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog share-dialog" role="dialog" aria-label={`Share ${vault.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">Share &ldquo;{vault.name}&rdquo;</div>

        {isOwner && (
          <form className="share-invite" onSubmit={invite}>
            <input
              className="enc-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Invite by email"
              autoComplete="off"
            />
            <select className="share-role" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button className="confirm-btn confirm-btn--primary" disabled={!email.trim() || busy}>
              Invite
            </button>
          </form>
        )}

        {error && <div className="enc-error">{error}</div>}

        <div className="share-members">
          <div className="share-member share-member--owner">
            <span className="share-member-name">Owner</span>
            <span className="share-role-badge">owner</span>
          </div>
          {list?.length === 0 && <div className="share-empty">No one else has access yet.</div>}
          {list?.map((m) => (
            <div key={m.user_id} className="share-member">
              <span className="share-member-name" title={m.email}>
                {m.display_name || m.email}
              </span>
              {isOwner ? (
                <>
                  <select
                    className="share-role"
                    value={m.role}
                    onChange={(e) => changeRole(m.user_id, e.target.value as "viewer" | "editor")}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button className="share-remove" title="Remove" onClick={() => remove(m.user_id)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              ) : (
                <span className="share-role-badge">{m.role}</span>
              )}
            </div>
          ))}
        </div>

        <div className="confirm-actions">
          {!isOwner && (
            <button className="confirm-btn confirm-btn--danger" onClick={leave}>
              Leave vault
            </button>
          )}
          <button className="confirm-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
