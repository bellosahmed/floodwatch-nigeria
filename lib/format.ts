/** "5 min ago", "3 h ago", "2 d ago". `now` is injectable so it can be tested. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

const dateParts = (iso: string, options: Intl.DateTimeFormatOptions) => {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).formatToParts(dateOf(iso))) p[part.type] = part.value;
  return p;
};

/** "Tue 3 Nov" */
export function shortDay(iso: string): string {
  const p = dateParts(iso, { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "3 Nov" */
export function dayMonth(iso: string): string {
  const p = dateParts(iso, { day: "numeric", month: "short" });
  return `${p.day} ${p.month}`;
}

/** "Today", "Tomorrow", or "Tue 3 Nov". */
export function dayLabel(iso: string, todayIso: string): string {
  const diff = Math.round((dateOf(iso).getTime() - dateOf(todayIso).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return shortDay(iso);
}
