import { describe, it, expect } from "vitest";
import { deviceDescription, osFromUserAgent, browserFromUserAgent } from "./platform";

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
