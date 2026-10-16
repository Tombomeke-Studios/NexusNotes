import { useEffect, useState } from "react";
import { consentDecided, loadConsent, saveConsent } from "../lib/consent";
import { LegalLink } from "./LegalLink";
import "./ConsentBanner.css";

const COOKIE_POLICY = "/legal/cookies.html";

/**
 * Storage notice and preferences (#289): shown on the first visit, and again
 * from the "Cookie preferences" links. NexusNotes only uses necessary storage;
 * the optional categories exist so anything added later starts switched off.
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(() => !consentDecided());
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(() => loadConsent()?.analytics ?? false);
  const [marketing, setMarketing] = useState(() => loadConsent()?.marketing ?? false);

  useEffect(() => {
    const reopen = () => {
      const c = loadConsent();
      setAnalytics(c?.analytics ?? false);
      setMarketing(c?.marketing ?? false);
      setDetails(true);
      setOpen(true);
    };
    window.addEventListener("nexus:consent-open", reopen);
    return () => window.removeEventListener("nexus:consent-open", reopen);
  }, []);

  if (!open) return null;

  const save = (choice: { analytics: boolean; marketing: boolean }) => {
    saveConsent(choice);
    setOpen(false);
    setDetails(false);
  };

  return (
    <section className="consent" role="region" aria-label="Cookies and storage">
      <p className="consent-text">
        NexusNotes sets no cookies and stores only what it needs to work in your browser, with no
        tracking. <LegalLink href={COOKIE_POLICY}>Cookie Policy</LegalLink>
      </p>
      {details && (
        <fieldset className="consent-choices">
          <legend className="consent-legend">Storage preferences</legend>
          <label className="consent-choice">
            <input type="checkbox" checked disabled />
            <span>
              <strong>Necessary</strong> — signing in, your settings and unsaved drafts. Always on.
            </span>
          </label>
          <label className="consent-choice">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <span>
              <strong>Analytics</strong> — not used by NexusNotes today.
            </span>
          </label>
          <label className="consent-choice">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>
              <strong>Marketing</strong> — not used by NexusNotes today.
            </span>
          </label>
        </fieldset>
      )}
      <div className="consent-actions">
        {details ? (
          <button className="consent-btn consent-btn--primary" onClick={() => save({ analytics, marketing })}>
            Save choices
          </button>
        ) : (
          <>
            <button className="consent-btn" onClick={() => setDetails(true)}>
              Preferences
            </button>
            <button className="consent-btn consent-btn--primary" onClick={() => save({ analytics: false, marketing: false })}>
              OK
            </button>
          </>
        )}
      </div>
    </section>
  );
}
