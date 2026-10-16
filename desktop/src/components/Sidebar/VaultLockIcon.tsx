import { useEffect, useRef, useState } from "react";

/**
 * Lock icon for an end-to-end encrypted vault. The shackle stands open while
 * the vault is unlocked; whenever it locks or unlocks (not on first paint)
 * the shackle swings shut or open and the icon wobbles. Keyed per change so
 * the CSS animations restart.
 */
export function VaultLockIcon({ locked }: { locked: boolean }) {
  const [changes, setChanges] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setChanges((n) => n + 1);
  }, [locked]);

  const shackle = locked
    ? `sidebar-vault-shackle${changes > 0 ? " sidebar-vault-shackle--closing" : ""}`
    : `sidebar-vault-shackle sidebar-vault-shackle--open${changes > 0 ? " sidebar-vault-shackle--opening" : ""}`;

  return (
    <svg
      key={changes}
      className={`sidebar-vault-lock${changes > 0 ? " sidebar-vault-lock--wobble" : ""}`}
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-label={locked ? "Encrypted vault, locked" : "Encrypted vault, unlocked"}
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path className={shackle} d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The header's lock icon as a button (#545): locks the open vault while it is
 * unlocked, asks for the passphrase while it is locked.
 */
export function VaultLockButton({
  locked,
  onLock,
  onUnlock,
}: {
  locked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const label = locked ? "Unlock vault" : "Lock vault";
  return (
    <button className="sidebar-vault-lock-btn" onClick={locked ? onUnlock : onLock} aria-label={label} title={label}>
      <VaultLockIcon locked={locked} />
    </button>
  );
}
