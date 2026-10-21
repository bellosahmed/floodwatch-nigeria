import type { Metadata } from "next";
import Link from "next/link";
import DayHeatmap, { type HeatmapRow } from "@/components/DayHeatmap";
import ForecastNotice from "@/components/ForecastNotice";
import HazardSwitch from "@/components/HazardSwitch";
import { CLIMATE_META, MONTH_NAMES, typicalMonths } from "@/lib/climatology";
import { getCombinedFeed } from "@/lib/combined";
import { HAZARDS, parseHazard } from "@/lib/hazard";
import { LOCATIONS } from "@/lib/locations";
import { formatLongDate, formatTimeNigeria, monthInNigeria, todayInNigeria } from "@/lib/time";

export const metadata: Metadata = { title: "Flood and heat calendar · FloodWatch" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ hazard?: string | string[] }> }) {
  const hazard = parseHazard((await searchParams).hazard);
  const feed = await getCombinedFeed();

  const sorted = feed.locations.filter((l) => l.forecast?.days.length).sort((a, b) => a.name.localeCompare(b.name));
  const ahead: HeatmapRow[] = sorted.map((l) => ({ slug: l.slug, name: l.name, days: l.forecast!.days.filter((d) => d.phase !== "past") }));
  const behind: HeatmapRow[] = sorted.map((l) => ({ slug: l.slug, name: l.name, days: l.forecast!.days.filter((d) => d.phase === "past") }));

  const currentMonth = monthInNigeria();
  const states = [...LOCATIONS].sort((a, b) => a.name.localeCompare(b.name));
  const letters = HAZARDS[hazard].labels.map((l) => l[0]);
  const key = HAZARDS[hazard].labels.map((l, i) => `${letters[i]} ${l}`).join(" · ");

  return (
    <>
      <h1>{HAZARDS[hazard].title} calendar</h1>
      <p className="lead">See the days ahead, and the past month, for every state. Tap a state for its local governments.</p>
      <p className="today-line">
        Today is <b>{formatLongDate(todayInNigeria())}</b> · updated {formatTimeNigeria()}
      </p>
      <HazardSwitch current={hazard} path="/calendar" />
      <ForecastNotice available={feed.forecastAvailable} stale={feed.forecastStale} asOf={feed.forecastAsOf} />

      <h2>Next {ahead[0]?.days.length ?? 16} days</h2>
      {ahead.length > 0 && <DayHeatmap rows={ahead} hazard={hazard} />}
      <p className="legend">
        {key}. Fainter columns (day 8 onward) are indicative only.{" "}
        {hazard === "flood" ? "Based on forecast rainfall and river flow, not community reports." : "An underline marks a heatwave (3 or more hot days in a row)."}
      </p>

      {behind[0]?.days.length > 0 && (
        <details className="past">
          <summary>
            <h2>Previous {behind[0].days.length} days (what already happened)</h2>
          </summary>
          <DayHeatmap rows={behind} hazard={hazard} dim />
          <p className="legend">Past days are modelled from observations, so they are good but not station-measured.</p>
        </details>
      )}

      {hazard === "flood" ? (
        <>
          <h2>Typical year, month by month</h2>
          <div className="heat-wrap">
            <table className="heat">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  {MONTH_NAMES.map((m, i) => (
                    <th key={m} scope="col" className={i + 1 === currentMonth ? "now" : ""}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <tr key={s.slug}>
                    <th scope="row">
                      <Link href={`/state/${s.slug}`} prefetch={false}>{s.name}</Link>
                    </th>
                    {typicalMonths(s.slug).map((m) => (
                      <td
                        key={m.month}
                        className={`h l${m.level}${m.month === currentMonth ? " now" : ""}`}
                        title={`${s.name}, ${m.name}: ${m.label}, about ${m.meanMm} mm`}
                      >
                        {m.label[0]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legend">
            <b>D</b> Dry · <b>L</b> Light rains · <b>H</b> Heavy rains · <b>P</b> Peak rains. This shows what each month is{" "}
            <b>usually</b> like, from {CLIMATE_META.period} rainfall records ({CLIMATE_META.source}). It is not a prediction
            for this year. The current month is outlined.
          </p>
        </>
      ) : (
        <p className="legend">
          Heat levels use health-based temperature bands, lowered one step on days that are normal for that state and month,
          and a 3-day rule for heatwaves. They are not calibrated against NiMet heat advisories, so treat them as guidance and follow official warnings.
        </p>
      )}
    </>
  );
}
