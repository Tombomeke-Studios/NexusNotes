import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ConsentBanner } from "./ConsentBanner";
import { hasConsent, loadConsent, openConsentPreferences } from "../lib/consent";

beforeEach(() => localStorage.clear());

describe("ConsentBanner (#289)", () => {
  it("shows on the first visit and closes for good once answered", () => {
    const { unmount } = render(<ConsentBanner />);
    const banner = screen.getByRole("region", { name: "Cookies and storage" });
    expect(banner.querySelector("a[href$='legal/cookies.html']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("region", { name: "Cookies and storage" })).toBeNull();
    expect(loadConsent()).not.toBeNull();
    expect(hasConsent("analytics")).toBe(false);
    unmount();
    render(<ConsentBanner />);
    expect(screen.queryByRole("region", { name: "Cookies and storage" })).toBeNull();
  });

  it("offers per-category choices with only Necessary on", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    const necessary = screen.getByRole("checkbox", { name: /Necessary/ }) as HTMLInputElement;
    const analytics = screen.getByRole("checkbox", { name: /Analytics/ }) as HTMLInputElement;
    const marketing = screen.getByRole("checkbox", { name: /Marketing/ }) as HTMLInputElement;
    expect([necessary.checked, necessary.disabled, analytics.checked, marketing.checked]).toEqual([true, true, false, false]);
    fireEvent.click(analytics);
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(hasConsent("analytics")).toBe(true);
    expect(hasConsent("marketing")).toBe(false);
  });

  it("reopens from a Cookie preferences link", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    act(() => openConsentPreferences());
    expect(screen.getByRole("checkbox", { name: /Analytics/ })).toBeTruthy();
  });
});
