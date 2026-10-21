import { dayLabel, shortDay } from "@/lib/format";
import { HAZARDS, labelFor, levelFor, type Hazard } from "@/lib/hazard";
import type { LgaForecast } from "@/lib/lga-forecast";

/**
 * Local governments of one state, ranked by who is hit first and worst.
 * Built to fit a phone without sideways scrolling: the name cell carries the most important fact (when the
 * area is first affected) and the 16-day strip, so nothing essential sits in a hidden column.
 */
export default function LgaTable({
  rows,
  hazard,
  todayIso,
  reportCounts,
}: {
  rows: LgaForecast[];
  hazard: Hazard;
  todayIso: string;
  reportCounts: Record<string, number>;
}) {
  const affected = rows.filter((r) => r[hazard].peakLevel >= 1).length;
  const noun = HAZARDS[hazard].title.toLowerCase();

  return (
    <>
      <p className="lead">
        {affected
          ? `${affected} of ${rows.length} local governments have a ${noun} warning in the next 16 days. Most at risk first.`
          : `No local government is expected to see ${noun} warnings in the next 16 days.`}
      </p>
      <table className="lga">
        <thead>
          <tr>
            <th scope="col">Local government</th>
            <th scope="col">Expected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const o = r[hazard];
            return (
              <tr key={r.slug}>
                <th scope="row">
                  <span className="lga-name">{r.name}</span>
                  <small className="lga-first">
                    {o.firstDate ? `First affected: ${dayLabel(o.firstDate, todayIso)}` : "No warning expected"}
                  </small>
                  <span className="mini" role="img" aria-label={`${HAZARDS[hazard].title} outlook for the next ${r.days.length} days`}>
                    {r.days.map((d) => (
                      <i
                        key={d.date}
                        className={`l${levelFor(d, hazard)}${hazard === "heat" && d.heatwave ? " wave" : ""}`}
                        title={`${shortDay(d.date)}: ${labelFor(levelFor(d, hazard), hazard)}`}
                      />
                    ))}
                  </span>
                </th>
                <td>
                  <span className={`badge l${o.peakLevel}`}>{labelFor(o.peakLevel, hazard)}</span>
                  {o.peakDate && o.peakLevel > 0 && <small className="lga-peak">peak {shortDay(o.peakDate)}</small>}
                  {hazard === "flood" && (reportCounts[r.slug] ?? 0) > 0 && (
                    <small className="lga-peak">
                      <b>{reportCounts[r.slug]}</b> report{reportCounts[r.slug] > 1 ? "s" : ""}
                    </small>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="legend">
        Each small box is one day, starting today (grey is Low). Rainfall and temperature only; river flow is not scored for
        local governments. Each point is a representative spot inside the LGA, so conditions in different parts of a large LGA
        can differ.
      </p>
    </>
  );
}
