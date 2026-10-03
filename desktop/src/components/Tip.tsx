import { useState, type ReactNode } from "react";
import { markTipSeen, tipSeen, type TipId } from "../lib/tips";
import "./Tip.css";

/** A one-time tip shown next to a feature until dismissed (#448). */
export function Tip({ id, children, className = "" }: { id: TipId; children: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(() => !tipSeen(id));
  if (!visible) return null;
  return (
    <div className={`tip ${className}`} role="note">
      <span className="tip-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.8a4.6 4.6 0 0 0-2.6 8.4V12h5.2v-1.8A4.6 4.6 0 0 0 8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M6.2 14.2h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="tip-text">{children}</span>
      <button
        className="tip-dismiss"
        onClick={() => {
          markTipSeen(id);
          setVisible(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}
