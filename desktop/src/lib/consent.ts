/**
 * Storage consent (#289). NexusNotes itself only stores what it needs to work
 * ("necessary"), which needs no consent. Any optional category added later
 * (analytics, marketing) must check hasConsent() first; it stays off until the
 * user turns it on in the banner or under "Cookie preferences".
 */
export type ConsentCategory = "necessary" | "analytics" | "marketing";

export interface ConsentChoice {
  version: string;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
}

/** Bump when the categories or the Cookie Policy change, to ask again. */
export const CONSENT_VERSION = "2026-10-03";
const KEY = "nexus_consent";

export function loadConsent(): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ConsentChoice;
    return c.version === CONSENT_VERSION ? c : null;
  } catch {
    return null;
  }
}

export function saveConsent(choice: { analytics: boolean; marketing: boolean }) {
  const value: ConsentChoice = { version: CONSENT_VERSION, ...choice, decidedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* blocked storage: the banner simply shows again */
  }
  window.dispatchEvent(new CustomEvent("nexus:consent"));
}

export function consentDecided(): boolean {
  return loadConsent() !== null;
}

export function hasConsent(category: ConsentCategory): boolean {
  if (category === "necessary") return true;
  return loadConsent()?.[category] === true;
}

/** Opens the preferences again (the "Cookie preferences" links). */
export function openConsentPreferences() {
  window.dispatchEvent(new CustomEvent("nexus:consent-open"));
}
