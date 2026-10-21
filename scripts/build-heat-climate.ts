// Builds data/heat-climate.json: for every state and calendar month, how hot the daily maximum temperature
// usually gets (mean and 90th percentile), from 10 years of historical data (ERA5 via Open-Meteo).
//   npm run heatclimate
// The app reads the saved file, so it never calls the archive API at runtime. LGAs use their state's values.
import { writeFileSync, mkdirSync } from "node:fs";
import { LOCATIONS } from "../lib/locations";

const START_YEAR = 2015;
const END_YEAR = 2024;
const BATCH = 6;

type Archive = { daily: { time: string[]; temperature_2m_max: (number | null)[] } };

async function fetchArchive(batch: typeof LOCATIONS): Promise<Archive[]> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${batch.map((l) => l.lat).join(",")}` +
    `&longitude=${batch.map((l) => l.lon).join(",")}&start_date=${START_YEAR}-01-01&end_date=${END_YEAR}-12-31` +
    `&daily=temperature_2m_max&timezone=Africa%2FLagos`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      const json: unknown = await res.json();
      return (Array.isArray(json) ? json : [json]) as Archive[];
    }
    console.error(`  attempt ${attempt} failed: ${res.status}`);
    await new Promise((r) => setTimeout(r, 4_000 * attempt));
  }
  throw new Error("Archive API kept failing; try again in a few minutes");
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function monthStats(series: Archive["daily"]) {
  return Array.from({ length: 12 }, (_, m) => {
    const temps: number[] = [];
    series.time.forEach((t, i) => {
      const v = series.temperature_2m_max[i];
      if (Number(t.slice(5, 7)) === m + 1 && typeof v === "number") temps.push(v);
    });
    if (temps.length < 100) throw new Error(`Too little data for month ${m + 1}`);
    temps.sort((a, b) => a - b);
    return {
      month: m + 1,
      meanTmaxC: round1(temps.reduce((a, b) => a + b, 0) / temps.length),
      p90TmaxC: round1(percentile(temps, 0.9)),
    };
  });
}

async function main() {
  const months: Record<string, ReturnType<typeof monthStats>> = {};
  for (let i = 0; i < LOCATIONS.length; i += BATCH) {
    const batch = LOCATIONS.slice(i, i + BATCH);
    console.error(`fetching ${batch.map((l) => l.name).join(", ")}`);
    const rows = await fetchArchive(batch);
    if (rows.length !== batch.length) throw new Error(`Expected ${batch.length} rows, got ${rows.length}`);
    batch.forEach((loc, j) => (months[loc.slug] = monthStats(rows[j].daily)));
    await new Promise((r) => setTimeout(r, 1_500));
  }

  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/heat-climate.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        period: `${START_YEAR}-${END_YEAR}`,
        source: "Open-Meteo Historical Weather API (ERA5 reanalysis)",
        months,
      },
      null,
      1,
    ),
  );
  console.error(`wrote data/heat-climate.json for ${Object.keys(months).length} locations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
