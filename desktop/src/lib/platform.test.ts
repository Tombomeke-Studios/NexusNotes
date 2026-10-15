import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deviceDescription, osFromUserAgent, browserFromUserAgent, legalPagePath, openBundledPage } from "./platform";

const created: Array<{ label: string; options: Record<string, unknown> }> = [];
const focused: string[] = [];
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static async getByLabel(label: string) {
      return created.some((w) => w.label === label) ? { setFocus: async () => void focused.push(label) } : null;
    }
    constructor(label: string, options: Record<string, unknown>) {
      created.push({ label, options });
    }
  },
}));

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
      "/legal\..\index.html",
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
  beforeEach(() => {
    created.length = 0;
    focused.length = 0;
    open = vi.spyOn(window, "open").mockReturnValue(null);
  });
  afterEach(() => open.mockRestore());

  it("opens a policy page in a browser tab", async () => {
    await openBundledPage("/legal/terms.html", "Terms", false);
    expect(open).toHaveBeenCalledWith("/legal/terms.html", "_blank", "noopener");
  });

  it("opens a policy page in its own window in the desktop app, focusing it the second time", async () => {
    await openBundledPage("/legal/privacy.html", "Privacy Policy", true);
    expect(created).toEqual([
      { label: "legal-privacy", options: expect.objectContaining({ url: "/legal/privacy.html", title: "Privacy Policy" }) },
    ]);
    await openBundledPage("/legal/privacy.html", "Privacy Policy", true);
    expect(created).toHaveLength(1);
    expect(focused).toEqual(["legal-privacy"]);
  });

  it("opens nothing for a path outside /legal/", async () => {
    for (const tauri of [false, true]) {
      await openBundledPage("https://example.com/", "Example", tauri);
      await openBundledPage("/index.html", "App", tauri);
      await openBundledPage("/legal/../index.html", "App", tauri);
    }
    expect(open).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });
});
