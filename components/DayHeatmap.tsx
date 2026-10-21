import Link from "next/link";
import { dayMonth, shortDay } from "@/lib/format";
import type { DayRisk } from "@/lib/forecast";
import { HAZARDS, labelFor, levelFor, type Hazard } from "@/lib/hazard";

export type HeatmapRow = { slug: string; name: string; days: DayRisk[] };

/** States (rows) by dates (columns), colored by the chosen hazard. */
export default function DayHeatmap({ rows, hazard, dim = false }: { rows: HeatmapRow[]; hazard: Hazard; dim?: boolean }) {
  if (!rows.length || !rows[0].days.length) return null;
  const dates = rows[0].days.map((d) => d.date);
  const letters = HAZARDS[hazard].labels.map((l) => l[0]);
  const href = (slug: string) => (hazard === "flood" ? `/state/${slug}` : `/state/${slug}?hazard=${hazard}`);

  return (
    <div className="heat-wrap">
      <table className="heat">
        <thead>
          <tr>
            <th scope="col">State</th>
            {dates.map((d, i) => (
              <th key={d} scope="col" className={dim || rows[0].days[i].confidence === "low" ? "faint" : ""}>
                {rows[0].days[i].phase === "today" ? "Today" : dayMonth(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug}>
              <th scope="row">
                <Link href={href(r.slug)} prefetch={false}>{r.name}</Link>
              </th>
              {r.days.map((d) => {
                const level = levelFor(d, hazard);
                return (
                  <td
                    key={d.date}
                    className={`h l${level} conf-${d.confidence}${d.phase === "today" ? " today" : ""}${hazard === "heat" && d.heatwave ? " wave" : ""}`}
                    title={`${r.name}, ${shortDay(d.date)}: ${labelFor(level, hazard)}`}
                  >
                    {letters[level]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
