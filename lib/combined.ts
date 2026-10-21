import { getForecastFeedResilient, type ForecastRisk } from "./forecast";
import { getGroundFeed, type GroundRisk } from "./ground";
import { DISCLAIMER, LEVEL_LABELS, type Level } from "./types";

// quiet: nothing flagged | forecast: rain/river signal only | reported: people report, forecast quiet
// confirmed: both layers agree
export type Stage = "quiet" | "forecast" | "reported" | "confirmed";

export type CombinedRisk = {
  slug: string;
  name: string;
  capital: string;
  inOutlook: boolean;
  level: Level;
  label: (typeof LEVEL_LABELS)[number];
  stage: Stage;
  reasons: string[];
  forecast: ForecastRisk | null; // null when the forecast source is unreachable
  ground: GroundRisk;
};

export type CombinedFeed = {
  generatedAt: string;
  forecastAvailable: boolean;
  /** True when the weather source is down and the forecast shown is an earlier one. */
  forecastStale: boolean;
  /** When the forecast shown was actually fetched, or null if there is none. */
  forecastAsOf: string | null;
  method: string;
  disclaimer: string;
  locations: CombinedRisk[];
};

const METHOD =
  "Level = the higher of the forecast signal and the ground signal (community reports and partner gauges). " +
  "When both are at least Watch, the level is raised one step (max Severe) because independent evidence agrees. " +
  "If the forecast source is down, the ground signal is used alone.";

/** Pure: merge the two layers for one state. */
export function combine(ground: GroundRisk, forecast: ForecastRisk | null): CombinedRisk {
  const f = forecast?.level ?? 0;
  const g = ground.level;
  const base = Math.max(f, g);
  const agree = f >= 1 && g >= 1;
  const level = (agree && base < 3 ? base + 1 : base) as Level;

  const reasons: string[] = [];
  if (agree) reasons.push("Forecast and on-the-ground reports agree");
  if (forecast && f > 0) reasons.push(...forecast.reasons);
  if (g > 0) reasons.push(...ground.reasons);
  if (!reasons.length) {
    reasons.push(
      forecast
        ? "No significant rain or river rise forecast, and no reports. Conditions can still change quickly."
        : "No reports received and the forecast is unavailable. This does not mean the area is safe.",
    );
  }

  return {
    slug: ground.slug,
    name: ground.name,
    capital: ground.capital,
    inOutlook: ground.inOutlook,
    level,
    label: LEVEL_LABELS[level],
    stage: agree ? "confirmed" : g >= 1 ? "reported" : f >= 1 ? "forecast" : "quiet",
    reasons,
    forecast,
    ground,
  };
}

export async function getCombinedFeed(): Promise<CombinedFeed> {
  const [ground, forecast] = await Promise.all([
    getGroundFeed(),
    // Graceful degradation: an outage upstream must never take the app down.
    getForecastFeedResilient().catch((err: unknown) => {
      console.error("[forecast] unavailable:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  const bySlug = new Map(forecast?.value.locations.map((l) => [l.slug, l]));
  return {
    generatedAt: new Date().toISOString(),
    forecastAvailable: forecast !== null,
    forecastStale: forecast?.stale ?? false,
    forecastAsOf: forecast?.asOf ?? null,
    method: METHOD,
    disclaimer: DISCLAIMER,
    locations: ground.map((g) => combine(g, bySlug.get(g.slug) ?? null)),
  };
}
