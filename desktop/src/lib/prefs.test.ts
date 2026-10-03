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
    savePrefs({ fontSize: 16, motion: "reduce", leftOpen: false });
    const prefs = loadPrefs();
    expect(prefs.fontSize).toBe(16);
    expect(prefs.motion).toBe("reduce");
    expect(prefs.leftOpen).toBe(false);
    expect(prefs.showStatusBar).toBe(DEFAULT_PREFS.showStatusBar);
  });

  it("defaults motion to following the system setting", () => {
    expect(loadPrefs().motion).toBe("system");
  });

  it("migrates the legacy reduceMotion boolean to the motion setting", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ reduceMotion: true }));
    expect(loadPrefs().motion).toBe("reduce");
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ reduceMotion: false }));
    expect(loadPrefs().motion).toBe("system");
  });

  it("ignores an unknown motion value", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ motion: "wild" }));
    expect(loadPrefs().motion).toBe("system");
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

describe("periodic note templates (#240)", () => {
  it("default to the built-in weekly and monthly templates and keep custom ones", () => {
    localStorage.clear();
    const prefs = loadPrefs();
    expect(prefs.weeklyTemplate).toContain("{{title}}");
    expect(prefs.monthlyTemplate).toContain("#monthly");
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ weeklyTemplate: "# Week {{title}}", monthlyTemplate: "   " }));
    const loaded = loadPrefs();
    expect(loaded.weeklyTemplate).toBe("# Week {{title}}");
    expect(loaded.monthlyTemplate).toContain("#monthly");
  });
});
