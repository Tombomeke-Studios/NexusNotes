import { describe, it, expect } from "vitest";
import { periodTitle, isoWeek, PERIOD_FOLDER } from "./periodic";

describe("periodic note titles (#240)", () => {
  it("names days, ISO weeks and months", () => {
    const d = new Date(2026, 9, 3); // Saturday 3 Oct 2026
    expect(periodTitle("daily", d)).toBe("2026-10-03");
    expect(periodTitle("weekly", d)).toBe("2026-W40");
    expect(periodTitle("monthly", d)).toBe("2026-10");
  });

  it("uses the ISO week-numbering year around new year", () => {
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 }); // Friday
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 }); // Monday
    expect(isoWeek(new Date(2026, 0, 4))).toEqual({ year: 2026, week: 1 }); // Sunday
    expect(periodTitle("weekly", new Date(2026, 0, 5))).toBe("2026-W02");
  });

  it("keeps each period in its own folder", () => {
    expect(PERIOD_FOLDER).toEqual({ daily: "Daily", weekly: "Weekly", monthly: "Monthly" });
  });
});
