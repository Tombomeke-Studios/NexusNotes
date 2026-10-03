import { describe, it, expect, beforeEach } from "vitest";
import { loadConsent, saveConsent, hasConsent, consentDecided, CONSENT_VERSION } from "./consent";

beforeEach(() => localStorage.clear());

describe("storage consent (#289)", () => {
  it("allows only necessary storage until the user chooses", () => {
    expect(consentDecided()).toBe(false);
    expect(hasConsent("necessary")).toBe(true);
    expect(hasConsent("analytics")).toBe(false);
    expect(hasConsent("marketing")).toBe(false);
  });

  it("remembers the choice per category", () => {
    saveConsent({ analytics: true, marketing: false });
    expect(consentDecided()).toBe(true);
    expect(hasConsent("analytics")).toBe(true);
    expect(hasConsent("marketing")).toBe(false);
    expect(loadConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: true, marketing: false });
  });

  it("asks again when the stored choice is unreadable or from another version", () => {
    localStorage.setItem("nexus_consent", "{bad");
    expect(consentDecided()).toBe(false);
    localStorage.setItem("nexus_consent", JSON.stringify({ version: "old", analytics: true, marketing: true }));
    expect(consentDecided()).toBe(false);
    expect(hasConsent("analytics")).toBe(false);
  });
});
