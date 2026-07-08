export interface CalendarCell {
  key: string;
  /** Day of month, or null for leading blank cells. */
  day: number | null;
  iso?: string;
  hasNote: boolean;
  isToday: boolean;
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Month is 0-based. Weeks start on Monday. */
export function buildCalendarCells(
  year: number,
  month: number,
  existingTitles: Set<string>,
  todayIso: string,
): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysIn = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < startDow; i++) {
    cells.push({ key: `blank-${i}`, day: null, hasNote: false, isToday: false });
  }
  for (let d = 1; d <= daysIn; d++) {
    const iso = toIsoDate(new Date(year, month, d));
    cells.push({
      key: iso,
      day: d,
      iso,
      hasNote: existingTitles.has(iso),
      isToday: iso === todayIso,
    });
  }
  return cells;
}

export function dailyNoteTemplate(iso: string): string {
  return `# ${iso}\n\n## Log\n\n- [ ] First entry\n\n#daily`;
}
