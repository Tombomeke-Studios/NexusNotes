import { useMemo, useState } from "react";
import { buildCalendarCells, toIsoDate } from "../../lib/daily";
import "./Workspace.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

interface DailyCalendarProps {
  noteTitles: Set<string>;
  onPickDay: (iso: string) => void;
  onOpenToday: () => void;
  onClose: () => void;
}

export function DailyCalendar({ noteTitles, onPickDay, onOpenToday, onClose }: DailyCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const todayIso = toIsoDate(today);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const cells = useMemo(
    () => buildCalendarCells(year, month, noteTitles, todayIso),
    [year, month, noteTitles, todayIso],
  );

  const prev = () => {
    setMonth((m) => (m === 0 ? 11 : m - 1));
    if (month === 0) setYear((y) => y - 1);
  };
  const next = () => {
    setMonth((m) => (m === 11 ? 0 : m + 1));
    if (month === 11) setYear((y) => y + 1);
  };

  return (
    <div className="calendar-overlay" onClick={onClose}>
      <div className="calendar-pop" onClick={(e) => e.stopPropagation()}>
        <div className="calendar-head">
          <button className="calendar-nav" onClick={prev} title="Previous month">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="calendar-title">{MONTHS[month]} {year}</span>
          <button className="calendar-nav" onClick={next} title="Next month">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="calendar-grid calendar-grid--dow">
          {DOW.map((d, i) => (
            <span key={`${d}-${i}`} className="calendar-dow">{d}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((c) =>
            c.day === null ? (
              <span key={c.key} />
            ) : (
              <button
                key={c.key}
                className={`calendar-day${c.isToday ? " calendar-day--today" : ""}${c.hasNote ? " calendar-day--has-note" : ""}`}
                title={c.hasNote ? `Open ${c.iso}` : `Create daily note ${c.iso}`}
                onClick={() => onPickDay(c.iso!)}
              >
                {c.day}
                {c.hasNote && <span className="calendar-dot" />}
              </button>
            ),
          )}
        </div>
        <button className="calendar-today-btn" onClick={onOpenToday}>
          Open today&rsquo;s note
        </button>
      </div>
    </div>
  );
}
