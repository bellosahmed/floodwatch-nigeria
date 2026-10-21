import raw from "../data/climatology.json";
import type { Level } from "./types";

// "Typical month" layer. Built once from 10 years of historical rainfall (npm run climatology).
// This says what a month is USUALLY like. It is not a forecast, and it says nothing about this year.

export type MonthStat = {
  month: number; // 1-12
  meanMm: number; // average monthly rainfall
  heavyDaysPerYear: number; // average number of days with 30 mm or more in this month
  probVeryHeavy: number; // share of years with at least one day of 50 mm or more
};

type ClimatologyFile = {
  generatedAt: string;
  period: string;
  source: string;
  months: Record<string, MonthStat[]>;
};

const data = raw as unknown as ClimatologyFile;

export const CLIMATE_META = { period: data.period, source: data.source, generatedAt: data.generatedAt } as const;

export const SEASON_LABELS = ["Dry", "Light rains", "Heavy rains", "Peak rains"] as const;
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Rule of thumb for how flood-prone a month usually is, from rainfall alone. Explainable, not calibrated. */
export function seasonLevel(m: Pick<MonthStat, "meanMm" | "heavyDaysPerYear" | "probVeryHeavy">): Level {
  if (m.heavyDaysPerYear >= 0.8 || m.probVeryHeavy >= 0.3) return 3;
  if (m.heavyDaysPerYear >= 0.3 || m.probVeryHeavy >= 0.1 || m.meanMm >= 100) return 2;
  if (m.meanMm >= 30) return 1;
  return 0;
}

export type TypicalMonth = MonthStat & { name: string; level: Level; label: (typeof SEASON_LABELS)[number] };

/** Twelve typical months for a state, or an empty list if the slug is unknown. */
export function typicalMonths(slug: string): TypicalMonth[] {
  return (data.months[slug] ?? []).map((m) => {
    const level = seasonLevel(m);
    return { ...m, name: MONTH_NAMES[m.month - 1], level, label: SEASON_LABELS[level] };
  });
}
