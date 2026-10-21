import { buildDays, fetchBatch, FORECAST_DAYS, MAX_STALE_MS, WEATHER_VARS, type DayRisk, type WeatherDaily } from "./forecast";
import { levelFor, type Hazard } from "./hazard";
import { withLastGood, type Fresh } from "./lastgood";
import { lgasOf, type Lga } from "./lgas";
import type { Level } from "./types";

// Per-LGA outlook: which local governments will be hit first, before it happens.
// LGAs are scored from rainfall and temperature only. River flow is not used here because the river model
// is gridded and a representative LGA point is often not on a river.

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// 774 places would burn through the free daily limit if refreshed often, so cache each state for 6 hours.
const LGA_REVALIDATE_SECONDS = 21_600;

/** When a hazard is expected to start, and how bad it gets, over the forecast window. */
export type Outlook = {
  peakLevel: Level;
  peakDate: string | null; // first day the peak level is reached
  firstDate: string | null; // first day at level 1 (Watch / Hot) or worse
  firstHighDate: string | null; // first day at level 2 (High / Dangerous heat) or worse
};

export type LgaForecast = {
  slug: string;
  name: string;
  rain16Mm: number; // total forecast rainfall over the window
  days: DayRisk[];
  flood: Outlook;
  heat: Outlook;
};

export function outlookFor(days: DayRisk[], hazard: Hazard): Outlook {
  const ahead = days.filter((d) => d.phase !== "past");
  let peakLevel: Level = 0;
  let peakDate: string | null = null;
  for (const d of ahead) {
    const level = levelFor(d, hazard);
    if (level > peakLevel) {
      peakLevel = level;
      peakDate = d.date;
    }
  }
  return {
    peakLevel,
    peakDate,
    firstDate: ahead.find((d) => levelFor(d, hazard) >= 1)?.date ?? null,
    firstHighDate: ahead.find((d) => levelFor(d, hazard) >= 2)?.date ?? null,
  };
}

export function assessLga(lga: Pick<Lga, "slug" | "name"> & Partial<Pick<Lga, "state">>, weather: WeatherDaily | undefined): LgaForecast {
  const dates = weather?.time ?? [];
  const rain = (weather?.precipitation_sum ?? []).map((v) => (typeof v === "number" ? v : 0));
  const days = buildDays({
    dates,
    rainMm: rain,
    tmaxC: weather?.temperature_2m_max ?? [],
    feelsC: weather?.apparent_temperature_max ?? [],
    pastDays: 0,
    stateSlug: lga.state,
  });
  return {
    slug: lga.slug,
    name: lga.name,
    rain16Mm: rain.reduce((a, b) => a + b, 0),
    days,
    flood: outlookFor(days, "flood"),
    heat: outlookFor(days, "heat"),
  };
}

/** Most at-risk first; among equals, whoever is hit sooner; then the wettest. */
export function rankLgas(list: LgaForecast[], hazard: Hazard): LgaForecast[] {
  const key = (l: LgaForecast) => l[hazard];
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (y.peakLevel !== x.peakLevel) return y.peakLevel - x.peakLevel;
    if (x.firstDate !== y.firstDate) return (x.firstDate ?? "9999") < (y.firstDate ?? "9999") ? -1 : 1;
    return hazard === "flood" ? b.rain16Mm - a.rain16Mm : a.name.localeCompare(b.name);
  });
}

async function loadLgaForecasts(stateSlug: string): Promise<LgaForecast[]> {
  const lgas = lgasOf(stateSlug);
  if (!lgas.length) return [];

  const rows = await fetchBatch<{ daily: WeatherDaily }>(
    `${WEATHER_URL}?latitude=${lgas.map((l) => l.lat).join(",")}&longitude=${lgas.map((l) => l.lon).join(",")}` +
      `&daily=${WEATHER_VARS}&forecast_days=${FORECAST_DAYS}&timezone=Africa%2FLagos`,
    lgas.length,
    LGA_REVALIDATE_SECONDS,
  );
  return lgas.map((lga, i) => assessLga(lga, rows[i]?.daily));
}

/** A state's LGAs, falling back to the last good answer (marked stale) if the source is down. */
export const getLgaForecasts = (stateSlug: string): Promise<Fresh<LgaForecast[]>> =>
  withLastGood(`forecast:lga:${stateSlug}`, MAX_STALE_MS, () => loadLgaForecasts(stateSlug));
