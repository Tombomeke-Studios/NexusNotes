import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, DEFAULT_PREFS, PREFS_STORAGE_KEY } from "./prefs";

describe("prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when storage is empty", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("round-trips saved preferences", () => {
    savePrefs({ fontSize: 16, reduceMotion: true, leftOpen: false });
    const prefs = loadPrefs();
    expect(prefs.fontSize).toBe(16);
    expect(prefs.reduceMotion).toBe(true);
    expect(prefs.leftOpen).toBe(false);
    expect(prefs.showStatusBar).toBe(DEFAULT_PREFS.showStatusBar);
  });

  it("merges partial saves without dropping earlier keys", () => {
    savePrefs({ fontSize: 18 });
    savePrefs({ viewMode: "preview" });
    const prefs = loadPrefs();
    expect(prefs.fontSize).toBe(18);
    expect(prefs.viewMode).toBe("preview");
  });

  it("falls back to defaults on corrupted storage", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("clamps out-of-range numeric values", () => {
    savePrefs({ fontSize: 99, leftWidth: 10, rightWidth: 9999, splitPct: 5 });
    const prefs = loadPrefs();
    expect(prefs.fontSize).toBe(20);
    expect(prefs.leftWidth).toBe(200);
    expect(prefs.rightWidth).toBe(400);
    expect(prefs.splitPct).toBe(25);
  });

  it("ignores invalid enum values", () => {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ viewMode: "banana", rightTab: 42 }),
    );
    const prefs = loadPrefs();
    expect(prefs.viewMode).toBe(DEFAULT_PREFS.viewMode);
    expect(prefs.rightTab).toBe(DEFAULT_PREFS.rightTab);
  });
});
