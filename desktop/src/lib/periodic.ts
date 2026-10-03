import { toIsoDate } from "./daily";

/**
 * Periodic notes (#240): one note per day, ISO week or month, each in its own
 * folder and created from its own template (Settings). Titles sort in time
 * order: 2026-10-03, 2026-W40, 2026-10.
 */
export type Period = "daily" | "weekly" | "monthly";

export const PERIOD_FOLDER: Record<Period, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export const DEFAULT_WEEKLY_TEMPLATE = "# {{title}}\n\n## Goals\n\n- [ ] \n\n## Review\n\n#weekly";
export const DEFAULT_MONTHLY_TEMPLATE = "# {{title}}\n\n## Focus\n\n- \n\n## Review\n\n#monthly";

/** ISO 8601 week: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function periodTitle(period: Period, date: Date): string {
  if (period === "daily") return toIsoDate(date);
  if (period === "monthly") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
