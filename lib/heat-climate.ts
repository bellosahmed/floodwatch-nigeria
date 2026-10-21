import raw from "../data/heat-climate.json";

// "Usual heat" layer. Built once from 10 years of historical daily maximum temperature (npm run heatclimate).
// It lets heat scoring tell "hotter than usual here" apart from "normal for the Sahel in April".

type HeatMonth = { month: number; meanTmaxC: number; p90TmaxC: number };
type HeatClimateFile = { generatedAt: string; period: string; source: string; months: Record<string, HeatMonth[]> };

const data = raw as unknown as HeatClimateFile;

/** 90th percentile of the daily maximum for a state and month (1-12), or null if unknown. */
export function usualMaxC(stateSlug: string | undefined, month: number): number | null {
  if (!stateSlug) return null;
  return data.months[stateSlug]?.find((m) => m.month === month)?.p90TmaxC ?? null;
}
