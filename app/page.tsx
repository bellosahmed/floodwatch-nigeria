import Link from "next/link";
import ForecastNotice from "@/components/ForecastNotice";
import { alertsConfig } from "@/lib/alerts/config";
import StateList from "@/components/StateList";
import { getCombinedFeed, type Stage } from "@/lib/combined";
import { formatLongDate, formatTimeNigeria, todayInNigeria } from "@/lib/time";
import { LEVEL_LABELS, type Level } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_TEXT: Record<Stage, string> = {
  quiet: "Nothing flagged",
  forecast: "Forecast warning",
  reported: "Reported by people",
  confirmed: "Forecast + reports agree",
};

export default async function Home() {
  const feed = await getCombinedFeed();
  const sorted = [...feed.locations].sort(
    (a, b) => b.level - a.level || b.ground.counts.reporters72h - a.ground.counts.reporters72h || a.name.localeCompare(b.name),
  );
  const counts = ([3, 2, 1, 0] as Level[]).map((level) => ({
    level,
    n: feed.locations.filter((l) => l.level === level).length,
  }));

  return (
    <>
      <h1>Is your area at risk of flooding?</h1>
      <p className="lead">
        Early warning from rainfall and river forecasts, confirmed by reports from people on the ground and partner river
        gauges.
      </p>
      <p className="today-line">
        Today is <b>{formatLongDate(todayInNigeria())}</b> · updated {formatTimeNigeria()}
      </p>

      <p className="actions">
        <Link prefetch={false} className="btn" href="/report">
          Report flooding near you
        </Link>
        <Link prefetch={false} className="btn alt" href="/calendar">
          See the next 16 days
        </Link>
        {alertsConfig().enabled && (
          <Link prefetch={false} className="btn alt" href="/alerts">
            Get alerts on your phone
          </Link>
        )}
      </p>

      <ForecastNotice available={feed.forecastAvailable} stale={feed.forecastStale} asOf={feed.forecastAsOf} />

      <div className="summary" aria-label="Summary by risk level">
        {counts.map(({ level, n }) => (
          <div className="stat" key={level}>
            <b>{n}</b>
            <span className={`badge l${level}`}>{LEVEL_LABELS[level]}</span>
          </div>
        ))}
      </div>

      <StateList
        rows={sorted.map((l) => ({
          slug: l.slug,
          name: l.name,
          capital: l.capital,
          level: l.level,
          label: l.label,
          detail: `${STAGE_TEXT[l.stage]}: ${l.reasons[0]}`,
          heatLevel: l.forecast?.heat.level ?? 0,
          heatLabel: l.forecast?.heat.label ?? "",
        }))}
      />
      <p className="lead" style={{ marginTop: 16 }}>
        {feed.disclaimer}
      </p>
    </>
  );
}
