import raw from "../data/river-climate.json";

// "Usual river flow" layer. Built once from 10 years of modelled daily discharge (npm run riverclimate).
// Rivers rise every rainy season, so a rise on its own is not news: this is what tells a normal rise from an unusual one.

type RiverMonth = { month: number; p50M3s: number | null; p90M3s: number | null };
type RiverClimateFile = { generatedAt: string; period: string; source: string; months: Record<string, RiverMonth[]> };

const data = raw as unknown as RiverClimateFile;

export type UsualFlow = { p50M3s: number; p90M3s: number };

/** Median and 90th percentile of daily river flow for a state and month (1-12), or null if unknown. */
export function usualFlow(stateSlug: string | undefined, month: number): UsualFlow | null {
  if (!stateSlug) return null;
  const m = data.months[stateSlug]?.find((x) => x.month === month);
  return m && m.p50M3s !== null && m.p90M3s !== null ? { p50M3s: m.p50M3s, p90M3s: m.p90M3s } : null;
}
