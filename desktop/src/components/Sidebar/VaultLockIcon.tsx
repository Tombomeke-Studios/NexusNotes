import { useEffect, useRef, useState } from "react";

/**
 * Lock icon for an end-to-end encrypted vault. The shackle opens while the
 * vault is unlocked, and the icon wobbles briefly whenever it locks or unlocks
 * (not on first paint). Keyed per change so the CSS animation restarts.
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
      <path d={locked ? "M5.5 7V5a2.5 2.5 0 015 0v2" : "M5.5 7V5a2.5 2.5 0 014.9-.7"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
