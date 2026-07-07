import { describe, it, expect } from "vitest";
import { toIsoDate, buildCalendarCells, dailyNoteTemplate } from "./daily";

describe("toIsoDate", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toIsoDate(new Date(2026, 6, 7))).toBe("2026-07-07");
    expect(toIsoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("buildCalendarCells", () => {
  // July 2026 starts on a Wednesday and has 31 days.
  const cells = buildCalendarCells(2026, 6, new Set(["2026-07-06"]), "2026-07-07");

  it("pads the first week from Monday", () => {
    expect(cells.slice(0, 2).every((c) => c.day === null)).toBe(true);
    expect(cells[2].day).toBe(1);
  });

  it("produces one cell per day", () => {
    expect(cells.filter((c) => c.day !== null)).toHaveLength(31);
    expect(cells[cells.length - 1].day).toBe(31);
  });

  it("marks days that already have a daily note", () => {
    const day6 = cells.find((c) => c.iso === "2026-07-06");
    const day8 = cells.find((c) => c.iso === "2026-07-08");
    expect(day6!.hasNote).toBe(true);
    expect(day8!.hasNote).toBe(false);
  });

  it("marks today", () => {
    const today = cells.find((c) => c.iso === "2026-07-07");
    expect(today!.isToday).toBe(true);
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
  });
});

describe("dailyNoteTemplate", () => {
  it("includes the date heading and the daily tag", () => {
    const t = dailyNoteTemplate("2026-07-07");
    expect(t.startsWith("# 2026-07-07")).toBe(true);
    expect(t).toContain("#daily");
  });
});
