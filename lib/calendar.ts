import type { DayRisk } from "./forecast";

export type DayCell = DayRisk & { dayOfMonth: number };

export type MonthGrid = {
  key: string; // YYYY-MM
  title: string; // "October 2026"
  weeks: (DayCell | null)[][]; // Monday-first rows of 7; null = outside the forecast window
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Monday = 0 ... Sunday = 6 */
const weekdayIndex = (iso: string) => (parse(iso).getUTCDay() + 6) % 7;

/** Lay consecutive forecast days out as one calendar grid per month. Pure, so it is easy to test. */
export function buildMonthGrids(days: DayRisk[]): MonthGrid[] {
  const byMonth = new Map<string, DayRisk[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), d]);
  }

  return [...byMonth.entries()].map(([key, monthDays]) => {
    const weeks: (DayCell | null)[][] = [];
    let row: (DayCell | null)[] = Array(weekdayIndex(monthDays[0].date)).fill(null);

    for (const d of monthDays) {
      row.push({ ...d, dayOfMonth: Number(d.date.slice(8, 10)) });
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length) weeks.push([...row, ...Array(7 - row.length).fill(null)]);

    return {
      key,
      title: parse(`${key}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      weeks,
    };
  });
}

export const weekdayLabel = (iso: string) => WEEKDAYS[weekdayIndex(iso)];
