import { buildMonthGrids, WEEKDAYS, type MonthGrid } from "@/lib/calendar";
import type { DayRisk } from "@/lib/forecast";
import { HAZARDS, labelFor, levelFor, type Hazard } from "@/lib/hazard";

const CONFIDENCE_TEXT = {
  observed: "already happened",
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
} as const;

function MonthTable({ grid, hazard }: { grid: MonthGrid; hazard: Hazard }) {
  const letters = HAZARDS[hazard].labels.map((l) => l[0]);
  return (
    <table className="cal">
      <caption>{grid.title}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((w) => (
            <th key={w} scope="col">
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.weeks.map((week, wi) => (
          <tr key={wi}>
            {week.map((cell, ci) => {
              if (!cell) return <td key={ci} className="c empty" />;
              const level = levelFor(cell, hazard);
              const value = hazard === "heat" ? (cell.tmaxC !== null ? Math.round(cell.tmaxC) : null) : Math.round(cell.rainMm);
              const unit = hazard === "heat" ? "°C" : " mm";
              const detail = value === null ? "–" : `${value}${unit}`;
              const text =
                `${cell.date}${cell.phase === "today" ? " (today)" : ""}: ${labelFor(level, hazard)}, ${detail}, ` +
                `${CONFIDENCE_TEXT[cell.confidence]}${hazard === "heat" && cell.heatwave ? ", part of a heatwave" : ""}`;
              const cls = [
                "c",
                `l${level}`,
                `conf-${cell.confidence}`,
                cell.phase === "today" ? "today" : "",
                hazard === "heat" && cell.heatwave ? "wave" : "",
              ].join(" ");
              return (
                <td key={cell.date} className={cls} title={text} aria-label={text}>
                  <span className="d">{cell.dayOfMonth}</span>
                  <span className="lv">{letters[level]}</span>
                  <span className="mm">
                    {value === null ? "–" : value}
                    {value !== null && <span className="u">{unit}</span>}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Day-by-day outlook as real calendar months. It opens on the current month; months that are entirely in the
 * past are tucked into a collapsible "Earlier" section so the first thing you see is today and what is coming.
 */
export default function CalendarGrid({ days, hazard = "flood", todayIso }: { days: DayRisk[]; hazard?: Hazard; todayIso?: string }) {
  if (!days.length) return <p>Forecast calendar unavailable right now.</p>;
  const letters = HAZARDS[hazard].labels.map((l) => l[0]);

  const thisMonth = (todayIso ?? days.find((d) => d.phase === "today")?.date ?? "").slice(0, 7);
  const grids = buildMonthGrids(days);
  const earlier = thisMonth ? grids.filter((g) => g.key < thisMonth) : [];
  const upcoming = grids.filter((g) => !earlier.includes(g));

  return (
    <>
      {upcoming.map((grid) => (
        <MonthTable key={grid.key} grid={grid} hazard={hazard} />
      ))}

      {earlier.length > 0 && (
        <details className="past">
          <summary>
            <h3>Earlier: {earlier.map((g) => g.title).join(", ")} (days that already happened)</h3>
          </summary>
          {earlier.map((grid) => (
            <MonthTable key={grid.key} grid={grid} hazard={hazard} />
          ))}
        </details>
      )}

      <p className="legend">
        {letters.map((l, i) => (
          <span key={l + i}>
            <b>{l}</b> {HAZARDS[hazard].labels[i]}
            {i < 3 ? " · " : ". "}
          </span>
        ))}
        The number in each day is {hazard === "heat" ? "the highest temperature in °C" : "the rainfall in mm"}. The outlined cell is <b>today</b>. Dotted cells already happened. Solid cells for the next 3 days are the most
        reliable; fainter dashed cells (day 8 onward) are indicative only.
        {hazard === "heat" && " An underline means the day is part of a heatwave (3 or more hot days in a row)."}
      </p>
    </>
  );
}
