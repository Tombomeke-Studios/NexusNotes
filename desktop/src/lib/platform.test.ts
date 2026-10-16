import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deviceDescription, osFromUserAgent, browserFromUserAgent, legalPagePath, openBundledPage } from "./platform";

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";

describe("user-agent parsing", () => {
  it("detects the OS", () => {
    expect(osFromUserAgent(CHROME_WIN)).toBe("Windows");
    expect(osFromUserAgent(FIREFOX_MAC)).toBe("macOS");
    expect(osFromUserAgent("")).toBe("Unknown OS");
  });

  it("detects the browser, preferring the most specific token", () => {
    expect(browserFromUserAgent(CHROME_WIN)).toBe("Chrome");
    expect(browserFromUserAgent(FIREFOX_MAC)).toBe("Firefox");
    expect(browserFromUserAgent(EDGE_WIN)).toBe("Edge"); // Edg/ before Chrome/
  });
});

describe("deviceDescription", () => {
  it("describes a browser session as web", () => {
    expect(deviceDescription(CHROME_WIN, false)).toEqual({
      name: "Chrome on Windows",
      platform: "web",
    });
  });

  it("describes the Tauri shell as desktop", () => {
    expect(deviceDescription(CHROME_WIN, true)).toEqual({
      name: "NexusNotes on Windows",
      platform: "desktop",
    });
  });
});

describe("legalPagePath", () => {
  it("accepts the bundled policy pages", () => {
    expect(legalPagePath("/legal/terms.html")).toBe("/legal/terms.html");
    expect(legalPagePath("/legal/privacy.html")).toBe("/legal/privacy.html");
    expect(legalPagePath("/legal/cookies.html")).toBe("/legal/cookies.html");
  });

  it("refuses paths outside /legal/", () => {
    for (const path of ["/", "/index.html", "/legalese/terms.html", "/legal", "/legal/", "legal/terms.html", "/other/legal/terms.html"]) {
      expect(legalPagePath(path), path).toBeNull();
    }
  });

  it("refuses paths that climb out of /legal/ or hide a different target", () => {
    for (const path of [
      "/legal/../index.html",
      "/legal/%2e%2e/index.html",
      "/legal/sub/../../index.html",
      "/legal\\..\\index.html",
      "/legal/terms.html?x=1",
      "/legal/terms.html#top",
      "/legal/ terms.html",
    ]) {
      expect(legalPagePath(path), path).toBeNull();
    }
  });

  it("refuses absolute and remote URLs", () => {
    for (const path of [
      "https://example.com/legal/terms.html",
      "http://localhost:1420/legal/terms.html",
      "//example.com/legal/terms.html",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///C:/legal/terms.html",
      "tauri://localhost/legal/terms.html",
    ]) {
      expect(legalPagePath(path), path).toBeNull();
    }
  });
});

describe("openBundledPage", () => {
  let open: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    open = vi.spyOn(window, "open").mockReturnValue(null);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    open.mockRestore();
    warn.mockRestore();
  });

  it("opens a policy page in a browser tab", async () => {
    await openBundledPage("/legal/terms.html", false);
    expect(open).toHaveBeenCalledWith("/legal/terms.html", "_blank", "noopener");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks the native command for the page by name in the desktop app", async () => {
    await openBundledPage("/legal/privacy.html", true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("open_policy_page", { name: "privacy" });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not throw when the native command refuses the page", async () => {
    invoke.mockRejectedValueOnce("unknown policy page");
    await expect(openBundledPage("/legal/other.html", true)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("open_policy_page", { name: "other" });
  });

  it("opens nothing for a path outside /legal/", async () => {
    for (const tauri of [false, true]) {
      await openBundledPage("https://example.com/", tauri);
      await openBundledPage("/index.html", tauri);
      await openBundledPage("/legal/../index.html", tauri);
    }
    expect(open).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
