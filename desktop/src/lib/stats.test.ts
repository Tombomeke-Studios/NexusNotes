import { describe, it, expect } from "vitest";
import { wordCount, readingTimeMinutes, cursorPosition } from "./stats";

describe("wordCount", () => {
  it("returns 0 for empty and whitespace-only content", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n\t ")).toBe(0);
  });

  it("counts whitespace-separated words", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  padded   words \n across lines ")).toBe(4);
  });
});

describe("readingTimeMinutes", () => {
  it("returns at least 1 minute", () => {
    expect(readingTimeMinutes(0)).toBe(1);
    expect(readingTimeMinutes(5)).toBe(1);
  });

  it("rounds up at 200 words per minute", () => {
    expect(readingTimeMinutes(200)).toBe(1);
    expect(readingTimeMinutes(201)).toBe(2);
    expect(readingTimeMinutes(1000)).toBe(5);
  });
});

describe("relativeTimeLabel", () => {
  const now = new Date("2026-07-07T12:00:00Z");

  it("says just now under a minute", async () => {
    const { relativeTimeLabel } = await import("./stats");
    expect(relativeTimeLabel(new Date("2026-07-07T11:59:30Z"), now)).toBe("just now");
  });

  it("reports minutes and hours", async () => {
    const { relativeTimeLabel } = await import("./stats");
    expect(relativeTimeLabel(new Date("2026-07-07T11:58:00Z"), now)).toBe("2 min ago");
    expect(relativeTimeLabel(new Date("2026-07-07T09:00:00Z"), now)).toBe("3 h ago");
  });

  it("falls back to a date beyond a day", async () => {
    const { relativeTimeLabel } = await import("./stats");
    const label = relativeTimeLabel(new Date("2026-07-01T09:00:00Z"), now);
    expect(label).not.toContain("ago");
    expect(label.length).toBeGreaterThan(0);
  });
});

describe("cursorPosition", () => {
  it("reports 1-based line and column at the start", () => {
    expect(cursorPosition("hello", 0)).toEqual({ line: 1, col: 1 });
  });

  it("tracks columns within a line", () => {
    expect(cursorPosition("hello", 3)).toEqual({ line: 1, col: 4 });
  });

  it("tracks lines across newlines", () => {
    expect(cursorPosition("ab\ncd\nef", 5)).toEqual({ line: 2, col: 3 });
    expect(cursorPosition("ab\ncd\nef", 6)).toEqual({ line: 3, col: 1 });
  });
});
