import { useEffect } from "react";
import { API_URL } from "../lib/api";
import { useServerStatus } from "../lib/useServerStatus";
import { describeServerStatus } from "../lib/connection";
import { Logo } from "./Logo";
import "./ConnectionBanner.css";

/** Persistent notice at the bottom of the window while the server is down or on another version. */
export function ConnectionBanner() {
  const status = useServerStatus();
  const notice = status ? describeServerStatus(status, API_URL) : null;
  if (!notice) return null;
  return (
    <div className={`connection-banner connection-banner--${notice.tone}`} role="status" aria-live="polite">
      <strong>{notice.message}</strong>
      {notice.hint && <span>{notice.hint}</span>}
    </div>
  );
}

/**
 * Full-screen state for "signed in before, but the server is not answering".
 * The session is kept (not signed out); once /health answers, onRecovered re-restores it.
 */
export function ServerUnavailable({ onRecovered }: { onRecovered: () => void }) {
  const status = useServerStatus();
  const notice = status ? describeServerStatus(status, API_URL) : null;

  useEffect(() => {
    if (status && status.state !== "unreachable") onRecovered();
  }, [status, onRecovered]);

  return (
    <div className="loading-screen connection-screen">
      <div className="connection-screen__card">
        <Logo size={48} />
        <h1>Waiting for the server…</h1>
        <p>{notice?.message ?? "Connecting…"}</p>
        {notice?.hint && <p className="connection-screen__hint">{notice.hint}</p>}
        <div className="spinner" aria-label="Retrying" />
      </div>
    </div>
  );
}
