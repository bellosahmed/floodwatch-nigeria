import { scoreHeat } from "./heat";
import { usualMaxC } from "./heat-climate";
import { usualFlow } from "./river-climate";
import { withLastGood, type Fresh } from "./lastgood";
import { LOCATIONS, type Location } from "./locations";
import { todayInNigeria } from "./time";
import { HEAT_LABELS, LEVEL_LABELS, type Level } from "./types";

// Forecast layer: rainfall, river-flow and temperature models from Open-Meteo (free, no API key).
// This is the early-warning half of the app. The app still works if this layer is down.

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood";
const TIMEOUT_MS = 8_000;
// Forecast models refresh every few hours, and the free tier is capped, so cache for 3 hours.
const REVALIDATE_SECONDS = 10_800;
export const WEATHER_VARS = "precipitation_sum,temperature_2m_max,apparent_temperature_max";

/** The free forecast reaches 16 days. Beyond that, no honest day-level forecast exists. */
export const FORECAST_DAYS = 16;
/** Days of recent history shown on the calendar. */
export const PAST_DAYS = 30;
/** The headline level for a state looks at the next 7 days, where the forecast is most reliable. */
export const HEADLINE_DAYS = 7;

export type WeatherDaily = {
  time: string[];
  precipitation_sum: (number | null)[];
  temperature_2m_max?: (number | null)[];
  apparent_temperature_max?: (number | null)[];
};
export type FloodDaily = { time: string[]; river_discharge: (number | null)[] };

/** How much to trust a day. Past days are observed; forecast skill drops quickly with lead time. */
export type DayConfidence = "observed" | "high" | "medium" | "low";
export type DayPhase = "past" | "today" | "future";

export type DayRisk = {
  date: string; // YYYY-MM-DD
  phase: DayPhase;
  rainMm: number;
  level: Level; // flood level for the day
  riverRatio: number | null; // that day's river flow vs the previous 30-day mean (future days only)
  tmaxC: number | null;
  feelsC: number | null;
  heatLevel: Level;
  heatwave: boolean; // part of a run of 3+ hot days
  confidence: DayConfidence;
};

export type HeatSummary = {
  level: Level;
  label: (typeof HEAT_LABELS)[number];
  peakTmaxC: number | null;
  peakFeelsC: number | null;
  heatwave: boolean;
  reasons: string[];
};

export type ForecastRisk = {
  slug: string;
  name: string;
  capital: string;
  inOutlook: boolean;
  level: Level; // flood headline: worst of the next 7 days
  label: (typeof LEVEL_LABELS)[number];
  reasons: string[];
  rain: { dates: string[]; dailyMm: number[]; next3Mm: number; peakDayMm: number }; // forecast days only
  river: { currentM3s: number | null; peak7M3s: number | null; ratioToRecent: number | null };
  heat: HeatSummary;
  days: DayRisk[]; // previous 30 days, today, then the forecast
};

export type ForecastFeed = {
  generatedAt: string;
  sources: string[];
  locations: ForecastRisk[];
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export const confidenceFor = (daysAhead: number): DayConfidence => (daysAhead < 3 ? "high" : daysAhead < 7 ? "medium" : "low");

// Thresholds are first-pass heuristics, not calibrated against station records.
export function rainLevel(dayMm: number, next3Mm: number): { level: Level; why?: string } {
  const mm = Math.round(next3Mm);
  if (next3Mm >= 100 || dayMm >= 60) return { level: 3, why: `Extreme rainfall forecast (${mm} mm in 3 days)` };
  if (next3Mm >= 50 || dayMm >= 30) return { level: 2, why: `Heavy rainfall forecast (${mm} mm in 3 days)` };
  if (next3Mm >= 20 || dayMm >= 15) return { level: 1, why: `Notable rainfall forecast (${mm} mm in 3 days)` };
  return { level: 0 };
}

export function riverLevel(ratio: number | null): { level: Level; why?: string } {
  if (ratio === null) return { level: 0 };
  const pct = Math.round((ratio - 1) * 100);
  if (ratio >= 1.6) return { level: 3, why: `River flow forecast ${pct}% above its recent average` };
  if (ratio >= 1.3) return { level: 2, why: `River flow forecast ${pct}% above its recent average` };
  if (ratio >= 1.15) return { level: 1, why: `River flow rising (${pct}% above recent average)` };
  return { level: 0 };
}

/**
 * Below this flow the river layer is ignored. The flow model is gridded (about 5 km), and in 25 of 37 states
 * the modelled river never exceeds 20 m3/s even in the wet season: there a "rise" of 1 to 3 m3/s is noise, not a
 * river. Without this floor, the river rule alone produced about 320 High+ state-days a year in January-April.
 */
export const MIN_RIVER_FLOW_M3S = 10;

/**
 * River level, softened when the flow is normal for the place and time of year. Rivers rise every rainy season,
 * so a jump over the last 30 days alone fired "Severe" on about one day in ten. Flow at or below the usual
 * 90th percentile for the state and month is lowered one step; at or below 1.5x the usual median, two steps.
 * Flow above the usual range keeps its full level. Unknown history means no softening. Flow under
 * MIN_RIVER_FLOW_M3S never warns.
 * Tuned on 2015-2025 modelled flow; NOT calibrated against gauge records.
 */
export function seasonalRiverLevel(
  ratio: number | null,
  flowM3s: number | null,
  stateSlug: string | undefined,
  month: number,
): { level: Level; why?: string } {
  const base = riverLevel(ratio);
  if (base.level === 0 || flowM3s === null) return base;
  if (flowM3s < MIN_RIVER_FLOW_M3S) return { level: 0 };
  const usual = usualFlow(stateSlug, month);
  if (!usual) return base;
  const drop = flowM3s <= usual.p50M3s * 1.5 ? 2 : flowM3s <= usual.p90M3s ? 1 : 0;
  if (drop === 0) return base;
  const level = Math.max(0, base.level - drop) as Level;
  return level === 0 ? { level } : { level, why: `${base.why} (a normal rise for this time of year)` };
}

/**
 * Score every day for one place. Shared by states and LGAs so both use identical rules.
 * `pastDays` is how many leading entries are already history; the next one is today.
 */
export function buildDays(input: {
  dates: string[];
  rainMm: number[];
  tmaxC: (number | null)[];
  feelsC: (number | null)[];
  pastDays: number;
  /** State slug, used to look up what temperatures are usual for the place. */
  stateSlug?: string;
  riverRatioFor?: (date: string) => number | null;
  riverFlowFor?: (date: string) => number | null;
}): DayRisk[] {
  const { dates, rainMm, tmaxC, feelsC, pastDays, stateSlug, riverRatioFor, riverFlowFor } = input;
  // Heat runs are detected across the whole window, so a heatwave already under way counts.
  const heat = scoreHeat(
    dates.map((d, i) => ({
      tmaxC: tmaxC[i] ?? null,
      feelsC: feelsC[i] ?? null,
      usualMaxC: usualMaxC(stateSlug, Number(d.slice(5, 7))),
    })),
  );

  return dates.map((date, i) => {
    const phase: DayPhase = i < pastDays ? "past" : i === pastDays ? "today" : "future";
    // Rain accumulates, so each day looks at its own rain and the two days before it.
    const rolling = sum(rainMm.slice(Math.max(0, i - 2), i + 1));
    const riverRatio = phase === "past" ? null : (riverRatioFor?.(date) ?? null);
    const riverFlow = phase === "past" ? null : (riverFlowFor?.(date) ?? null);
    const river = seasonalRiverLevel(riverRatio, riverFlow, stateSlug, Number(date.slice(5, 7)));
    return {
      date,
      phase,
      rainMm: rainMm[i] ?? 0,
      level: Math.max(rainLevel(rainMm[i] ?? 0, rolling).level, river.level) as Level,
      riverRatio,
      tmaxC: tmaxC[i] ?? null,
      feelsC: feelsC[i] ?? null,
      heatLevel: heat[i].level,
      heatwave: heat[i].heatwave,
      confidence: phase === "past" ? "observed" : confidenceFor(i - pastDays),
    };
  });
}

/** Headline heat summary over the next HEADLINE_DAYS (forecast days only). */
export function summariseHeat(days: DayRisk[]): HeatSummary {
  const head = days.filter((d) => d.phase !== "past").slice(0, HEADLINE_DAYS);
  const level = Math.max(0, ...head.map((d) => d.heatLevel)) as Level;
  const tmax = head.map((d) => d.tmaxC).filter(isNum);
  const feels = head.map((d) => d.feelsC).filter(isNum);
  const peakTmaxC = tmax.length ? Math.max(...tmax) : null;
  const peakFeelsC = feels.length ? Math.max(...feels) : null;
  const wave = head.filter((d) => d.heatwave);
  const temps = `${peakTmaxC !== null ? `up to ${Math.round(peakTmaxC)}°C` : ""}${peakFeelsC !== null ? `, feels like ${Math.round(peakFeelsC)}°C` : ""}`;

  const reasons: string[] = [];
  if (wave.length) reasons.push(`Heatwave: ${wave.length} hot day${wave.length > 1 ? "s" : ""} in the next week (${temps})`);
  else if (level > 0) reasons.push(`Very hot weather forecast (${temps})`);
  else reasons.push("No unusual heat in the 7-day forecast");

  return { level, label: HEAT_LABELS[level], peakTmaxC, peakFeelsC, heatwave: wave.length > 0, reasons };
}

/** Pure scoring for one state. `todayIso` is only a fallback when the weather series is empty. */
export function assessLocation(
  loc: Location,
  weather: WeatherDaily | undefined,
  flood: FloodDaily | undefined,
  todayIso: string,
  pastDays = 0,
): ForecastRisk {
  const allDates = weather?.time ?? [];
  const allRain = (weather?.precipitation_sum ?? []).map((v) => (isNum(v) ? v : 0));
  const dates = allDates.slice(pastDays);
  const dailyMm = allRain.slice(pastDays);
  const next3Mm = sum(dailyMm.slice(0, 3));
  const peakDayMm = Math.max(0, ...dailyMm.slice(0, HEADLINE_DAYS));

  // River flow: forecast values by date, and the mean of the 30 days before the forecast starts.
  const start = dates[0] ?? todayIso;
  const discharge = new Map<string, number>();
  const past: number[] = [];
  flood?.time.forEach((t, i) => {
    const v = flood.river_discharge[i];
    if (!isNum(v)) return;
    if (t < start) past.push(v);
    else discharge.set(t, v);
  });
  const meanPast = past.length >= 7 && sum(past) > 0 ? sum(past) / past.length : null;
  const ratioFor = (date: string) => {
    const v = discharge.get(date);
    return meanPast !== null && v !== undefined ? v / meanPast : null;
  };

  const headDischarge = dates
    .slice(0, HEADLINE_DAYS)
    .map((d) => discharge.get(d))
    .filter(isNum);
  const currentM3s = dates.length ? (discharge.get(dates[0]) ?? null) : null;
  const peak7M3s = headDischarge.length ? Math.max(...headDischarge) : null;
  const peakDate = dates.slice(0, HEADLINE_DAYS).find((d) => discharge.get(d) === peak7M3s) ?? dates[0] ?? todayIso;
  const ratioToRecent = meanPast !== null && peak7M3s !== null ? peak7M3s / meanPast : null;

  const rain = rainLevel(dailyMm[0] ?? 0, next3Mm);
  const river = seasonalRiverLevel(ratioToRecent, peak7M3s, loc.slug, Number(peakDate.slice(5, 7)));
  const level = Math.max(rain.level, river.level) as Level;
  const reasons = [rain.why, river.why].filter((r): r is string => Boolean(r));
  if (!reasons.length) reasons.push("No significant rainfall or river rise in the 7-day forecast");

  const days = buildDays({
    dates: allDates,
    rainMm: allRain,
    tmaxC: weather?.temperature_2m_max ?? [],
    feelsC: weather?.apparent_temperature_max ?? [],
    pastDays,
    stateSlug: loc.slug,
    riverRatioFor: ratioFor,
    riverFlowFor: (date) => discharge.get(date) ?? null,
  });

  return {
    slug: loc.slug,
    name: loc.name,
    capital: loc.capital,
    inOutlook: loc.inOutlook,
    level,
    label: LEVEL_LABELS[level],
    reasons,
    rain: { dates, dailyMm, next3Mm, peakDayMm },
    river: { currentM3s, peak7M3s, ratioToRecent },
    heat: summariseHeat(days),
    days,
  };
}

/** The weather source answered, but with an error status. */
export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Forecast source returned ${status}`);
  }
}

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

/** Worth one more try: a timeout, a dropped connection, or a 5xx. A 4xx (bad request, rate limit) will not improve. */
export const isTransient = (err: unknown) =>
  err instanceof UpstreamError ? err.status >= 500 : err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError);

// Open-Meteo returns one object for a single coordinate and an array for several.
// The first connection after a server starts can be slow, so a timeout or 5xx is retried once.
export async function fetchBatch<T>(url: string, expected: number, revalidate = REVALIDATE_SECONDS): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new UpstreamError(res.status);
      const json: unknown = await res.json();
      const rows = (Array.isArray(json) ? json : [json]) as T[];
      if (rows.length !== expected) throw new Error(`Forecast source returned ${rows.length} rows, expected ${expected}`);
      return rows;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

export async function getForecastFeed(): Promise<ForecastFeed> {
  const lat = LOCATIONS.map((l) => l.lat).join(",");
  const lon = LOCATIONS.map((l) => l.lon).join(",");
  const n = LOCATIONS.length;

  const [weather, flood] = await Promise.all([
    fetchBatch<{ daily: WeatherDaily }>(
      `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&daily=${WEATHER_VARS}` +
        `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=Africa%2FLagos`,
      n,
    ),
    // River data is optional: if it fails we still return rainfall-based risk.
    fetchBatch<{ daily: FloodDaily }>(
      `${FLOOD_URL}?latitude=${lat}&longitude=${lon}&daily=river_discharge&past_days=30&forecast_days=${FORECAST_DAYS}`,
      n,
    ).catch(() => null),
  ]);

  const today = todayInNigeria();
  return {
    generatedAt: new Date().toISOString(),
    sources: ["Open-Meteo Forecast API", "Open-Meteo Flood API (GloFAS)"],
    locations: LOCATIONS.map((loc, i) => assessLocation(loc, weather[i]?.daily, flood?.[i]?.daily, today, PAST_DAYS)),
  };
}

/** How long an old forecast may stand in for a failed one. Beyond this it is too old to be useful. */
export const MAX_STALE_MS = 12 * 3_600_000;

/** The forecast feed, falling back to the last good one (marked stale) if the source is down. */
export const getForecastFeedResilient = (): Promise<Fresh<ForecastFeed>> =>
  withLastGood("forecast:states", MAX_STALE_MS, getForecastFeed);
