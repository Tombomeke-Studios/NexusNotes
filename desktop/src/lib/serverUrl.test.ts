import { describe, it, expect, beforeEach } from "vitest";
import { normalizeServerUrl, loadServerUrl, saveServerUrl, SERVER_URL_KEY } from "./serverUrl";

describe("normalizeServerUrl (#500)", () => {
  it("accepts an https origin and drops a trailing slash", () => {
    expect(normalizeServerUrl("https://api.example.com/")).toEqual({ ok: true, url: "https://api.example.com" });
  });
  it("keeps a non-default port", () => {
    expect(normalizeServerUrl("https://notes.example.com:8443")).toEqual({ ok: true, url: "https://notes.example.com:8443" });
  });
  it("trims whitespace", () => {
    expect(normalizeServerUrl("  https://api.example.com  ")).toEqual({ ok: true, url: "https://api.example.com" });
  });
  it("reduces the input to its origin (no path, query or fragment)", () => {
    expect(normalizeServerUrl("https://api.example.com/api/v1?x=1#top")).toEqual({ ok: true, url: "https://api.example.com" });
  });
  it("assumes https when no scheme is typed", () => {
    expect(normalizeServerUrl("api.example.com")).toEqual({ ok: true, url: "https://api.example.com" });
  });
  it("allows plain http only for loopback hosts (dev stacks)", () => {
    expect(normalizeServerUrl("http://localhost:8080")).toEqual({ ok: true, url: "http://localhost:8080" });
    expect(normalizeServerUrl("http://127.0.0.1:8080")).toEqual({ ok: true, url: "http://127.0.0.1:8080" });
  });
  it("rejects plain http for any other host", () => {
    const r = normalizeServerUrl("http://api.example.com");
    expect(r.ok).toBe(false);
  });
  it("rejects credentials in the URL", () => {
    expect(normalizeServerUrl("https://user:pass@api.example.com").ok).toBe(false);
  });
  it("rejects other schemes and empty input", () => {
    expect(normalizeServerUrl("ftp://api.example.com").ok).toBe(false);
    expect(normalizeServerUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeServerUrl("   ").ok).toBe(false);
    expect(normalizeServerUrl("https://").ok).toBe(false);
  });
});

describe("saved server URL", () => {
  beforeEach(() => localStorage.clear());

  it("falls back to the build default when nothing is saved", () => {
    expect(loadServerUrl("https://api.default.example")).toBe("https://api.default.example");
  });
  it("returns a saved, valid URL over the default", () => {
    saveServerUrl("https://api.mine.example/");
    expect(localStorage.getItem(SERVER_URL_KEY)).toBe("https://api.mine.example");
    expect(loadServerUrl("https://api.default.example")).toBe("https://api.mine.example");
  });
  it("ignores a corrupt saved value instead of using it", () => {
    localStorage.setItem(SERVER_URL_KEY, "http://evil.example");
    expect(loadServerUrl("https://api.default.example")).toBe("https://api.default.example");
  });
  it("refuses to save an invalid URL", () => {
    expect(saveServerUrl("ftp://nope")).toBe(false);
    expect(localStorage.getItem(SERVER_URL_KEY)).toBeNull();
  });
});
