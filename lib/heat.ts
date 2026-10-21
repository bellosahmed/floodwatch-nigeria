import type { Level } from "./types";

// Heat scoring. Health-based absolute bands on the day's maximum temperature and "feels-like"
// (apparent) temperature, softened by what is normal for the place and month, plus a persistence rule:
// several hot days in a row are what make a heatwave.
//
// Absolute bands alone flagged normal Sahel heat. Measured on March-May 2026 (92 days), share of days flagged
// "hot" (level 1 or worse): Lagos 2%, Port Harcourt 4%, Abuja 0%, Kano 23%, Borno 58%, Sokoto 60%. That is real
// heat stress, but it is the usual climate there, and a warning that is always on is ignored. With the local
// baseline below, the same window gives Kano 16%, Borno 10%, Sokoto 16%, and the south is unchanged.
//
// So a day whose maximum is within the usual range for its state and calendar month (at or below the 90th
// percentile of 2015-2024, see data/heat-climate.json) is lowered one step. Days hotter than usual keep the full
// absolute band, so genuinely dangerous heat is never hidden. These rules are NOT calibrated against NiMet
// heat advisories.

export const HEATWAVE_MIN_DAYS = 3;

export type HeatReading = {
  tmaxC: number | null;
  feelsC: number | null;
  /** 90th percentile of the daily maximum for this place and month. Unknown means no softening. */
  usualMaxC?: number | null;
};
export type HeatDay = { level: Level; heatwave: boolean };

export function baseHeatLevel(tmaxC: number | null, feelsC: number | null): Level {
  const t = tmaxC ?? -Infinity;
  const f = feelsC ?? -Infinity;
  if (f >= 46 || t >= 45) return 3;
  if (f >= 43 || t >= 42) return 2;
  if (f >= 41 || t >= 40) return 1;
  return 0;
}

/** The absolute band, lowered one step when the day is not hotter than usual for this place and month. */
export function localHeatLevel(r: HeatReading): Level {
  const base = baseHeatLevel(r.tmaxC, r.feelsC);
  const usual = r.usualMaxC;
  if (base === 0 || r.tmaxC === null || usual === null || usual === undefined) return base;
  return r.tmaxC <= usual ? ((base - 1) as Level) : base;
}

/**
 * Score a run of consecutive days. A stretch of HEATWAVE_MIN_DAYS or more hot days is a heatwave:
 * each day in it is raised one step (max 3) because heat stress builds up over consecutive days and nights.
 */
export function scoreHeat(readings: HeatReading[]): HeatDay[] {
  const base = readings.map(localHeatLevel);
  const out: HeatDay[] = base.map((level) => ({ level, heatwave: false }));

  let i = 0;
  while (i < base.length) {
    if (base[i] === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < base.length && base[j] > 0) j++;
    if (j - i >= HEATWAVE_MIN_DAYS) {
      for (let k = i; k < j; k++) out[k] = { level: Math.min(3, base[k] + 1) as Level, heatwave: true };
    }
    i = j;
  }
  return out;
}
