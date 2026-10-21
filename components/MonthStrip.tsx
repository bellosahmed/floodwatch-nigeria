import type { TypicalMonth } from "@/lib/climatology";

/** Twelve typical months for one state, with the current month marked. */
export default function MonthStrip({ months, currentMonth }: { months: TypicalMonth[]; currentMonth: number }) {
  if (!months.length) return null;
  return (
    <ul className="months">
      {months.map((m) => (
        <li key={m.month} className={`mo l${m.level}${m.month === currentMonth ? " now" : ""}`}>
          <b>{m.name}</b>
          <span>{m.label}</span>
          <small>{m.meanMm} mm</small>
        </li>
      ))}
    </ul>
  );
}
