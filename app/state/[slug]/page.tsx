import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CalendarGrid from "@/components/CalendarGrid";
import ForecastNotice from "@/components/ForecastNotice";
import HazardSwitch from "@/components/HazardSwitch";
import LgaTable from "@/components/LgaTable";
import MonthStrip from "@/components/MonthStrip";
import { ADVICE, HEAT_ADVICE } from "@/lib/advice";
import { CLIMATE_META, typicalMonths } from "@/lib/climatology";
import { getCombinedFeed } from "@/lib/combined";
import { ago } from "@/lib/format";
import { getLgaReportCounts, getRecentReports } from "@/lib/ground";
import { HAZARDS, parseHazard } from "@/lib/hazard";
import { getLgaForecasts, rankLgas, type LgaForecast } from "@/lib/lga-forecast";
import { farthestLgaKm, lgaBySlug, LARGE_SPREAD_KM } from "@/lib/lgas";
import { bySlug } from "@/lib/locations";
import { formatLongDate, formatTimeNigeria, monthInNigeria, todayInNigeria } from "@/lib/time";
import { SEVERITY_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hazard?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loc = bySlug((await params).slug);
  return { title: loc ? `${loc.name} flood and heat risk · FloodWatch` : "Not found" };
}

export default async function StatePage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!bySlug(slug)) notFound();
  const hazard = parseHazard((await searchParams).hazard);

  const [feed, reports, reportCounts] = await Promise.all([getCombinedFeed(), getRecentReports(slug), getLgaReportCounts(slug)]);
  const state = feed.locations.find((l) => l.slug === slug);
  if (!state) notFound();

  // LGA data is a separate, cached request. If it fails the rest of the page still works.
  let lgaRows: LgaForecast[] | null = null;
  let lgaStale = false;
  try {
    const lgaForecast = await getLgaForecasts(slug);
    lgaRows = rankLgas(lgaForecast.value, hazard);
    lgaStale = lgaForecast.stale;
  } catch (err) {
    console.error("[state] LGA forecast unavailable:", err instanceof Error ? err.message : err);
  }

  const days = state.forecast?.days ?? [];
  const todayIso = todayInNigeria();
  const heat = state.forecast?.heat ?? null;
  const level = hazard === "heat" ? (heat?.level ?? 0) : state.level;
  const label = hazard === "heat" ? (heat?.label ?? "Normal") : state.label;
  const reasons = hazard === "heat" ? (heat?.reasons ?? ["Heat forecast unavailable right now."]) : state.reasons;
  const advice = hazard === "heat" ? HEAT_ADVICE[level] : ADVICE[level];
  const point = bySlug(slug);
  const spreadKm = point ? farthestLgaKm(slug, point.lat, point.lon) : 0;
  const months = typicalMonths(slug);
  const currentMonth = monthInNigeria();

  return (
    <>
      <p style={{ marginTop: 16 }}>
        <Link prefetch={false} href="/">← All states</Link>
      </p>
      <h1>
        {state.name} <span className={`badge l${level}`}>{label}</span>
      </h1>
      <p className="lead">
        Forecast point: {state.capital}. {hazard === "flood" && state.inOutlook && "Listed in the 2026 national flood outlook."}
      </p>

      {spreadKm > LARGE_SPREAD_KM && (
        <p className="notice">
          This is a large state. The forecast point is {state.capital}, and some local governments are up to {spreadKm} km away, where
          the weather can be quite different. Check the local government table below for your area.
        </p>
      )}

      <p className="today-line">
        Today is <b>{formatLongDate(todayIso)}</b> · updated {formatTimeNigeria()}
      </p>

      <HazardSwitch current={hazard} path={`/state/${slug}`} />
      <ForecastNotice available={feed.forecastAvailable} stale={feed.forecastStale || lgaStale} asOf={feed.forecastAsOf} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Why ({HAZARDS[hazard].title.toLowerCase()})</h2>
        <ul>
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {hazard === "flood" && state.ground.gauges.length > 0 && (
          <>
            <h2>River gauges</h2>
            <ul>
              {state.ground.gauges.map((g) => (
                <li key={g.station}>
                  {g.station}: {g.levelM} m (warning {g.warningM} m, danger {g.dangerM} m), {ago(g.at)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What to do</h2>
        <ul>
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Today and the next {Math.max(0, days.filter((d) => d.phase !== "past").length - 1)} days</h2>
        <CalendarGrid days={days} hazard={hazard} todayIso={todayIso} />
      </section>

      <section className="card" id="lgas">
        <h2 style={{ marginTop: 0 }}>
          Local governments in {state.name}: who is affected first ({HAZARDS[hazard].title.toLowerCase()})
        </h2>
        {lgaRows ? (
          <LgaTable rows={lgaRows} hazard={hazard} todayIso={todayIso} reportCounts={Object.fromEntries(reportCounts)} />
        ) : (
          <p className="notice">Local government forecasts are unavailable right now. The state-level information above still applies.</p>
        )}
      </section>

      {hazard === "flood" && months.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>A typical year in {state.name}</h2>
          <MonthStrip months={months} currentMonth={currentMonth} />
          <p className="legend">
            What each month is <b>usually</b> like, from {CLIMATE_META.period} rainfall records. This is not a forecast for
            this year: no reliable day-by-day forecast exists beyond about two weeks. Rivers can also flood weeks after rain
            falls upstream.
          </p>
        </section>
      )}

      {hazard === "flood" && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Reports from people (72 hours)</h2>
          {reports.length ? (
            <ul>
              {reports.map((r, i) => (
                <li key={`${r.at}-${i}`}>
                  <b>{SEVERITY_LABELS[r.severity]}</b> · {r.lga && lgaBySlug(r.lga) ? `${lgaBySlug(r.lga)!.name}, ` : ""}
                  {r.area} · {ago(r.at)}
                  {r.note && (
                    <>
                      <br />
                      <small>{r.note}</small>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No reports in the last 72 hours.</p>
          )}
        </section>
      )}

      <p>
        <Link prefetch={false} className="btn" href="/report">
          Report flooding in {state.name}
        </Link>
      </p>
    </>
  );
}
