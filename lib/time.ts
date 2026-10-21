// "Today" for this app means today in Nigeria (WAT, UTC+1, no daylight saving), not the server's clock.
// A server in UTC would otherwise show the wrong date for the first hour of every Nigerian day.

export const NIGERIA_TZ = "Africa/Lagos";

/** Today's date in Nigeria as YYYY-MM-DD. */
export function todayInNigeria(now = new Date()): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: NIGERIA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Current month in Nigeria, 1-12. */
export const monthInNigeria = (now = new Date()): number => Number(todayInNigeria(now).slice(5, 7));

/** "Sunday, 18 October 2026". Built from parts so the punctuation does not vary between Node/ICU versions. */
export function formatLongDate(iso: string): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(new Date(`${iso}T00:00:00Z`))) {
    p[part.type] = part.value;
  }
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** "14:05 WAT" */
export function formatTimeNigeria(now = new Date()): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: NIGERIA_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return `${time} WAT`;
}
