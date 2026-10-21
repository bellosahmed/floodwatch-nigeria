// Builds data/climatology.json: for every state and calendar month, how much it typically rains
// and how often it rains heavily, from 10 years of historical daily rainfall (ERA5 via Open-Meteo).
//   npm run climatology
// Run once (and again if you want a newer window). The app reads the saved file, so it never
// calls the archive API at runtime.
import { writeFileSync, mkdirSync } from "node:fs";
import { LOCATIONS } from "../lib/locations";

const START_YEAR = 2015;
const END_YEAR = 2024;
const BATCH = 6; // locations per request, to stay well inside free-tier limits
const HEAVY = 30; // mm/day
const VERY_HEAVY = 50; // mm/day

type Archive = { daily: { time: string[]; precipitation_sum: (number | null)[] } };

async function fetchArchive(batch: typeof LOCATIONS): Promise<Archive[]> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${batch.map((l) => l.lat).join(",")}` +
    `&longitude=${batch.map((l) => l.lon).join(",")}&start_date=${START_YEAR}-01-01&end_date=${END_YEAR}-12-31` +
    `&daily=precipitation_sum&timezone=Africa%2FLagos`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      const json: unknown = await res.json();
      return (Array.isArray(json) ? json : [json]) as Archive[];
    }
    console.error(`  attempt ${attempt} failed: ${res.status}`);
    await new Promise((r) => setTimeout(r, 4_000 * attempt)); // back off, rate limits clear quickly
  }
  throw new Error("Archive API kept failing; try again in a few minutes");
}

function monthStats(series: Archive["daily"]) {
  const years = END_YEAR - START_YEAR + 1;
  return Array.from({ length: 12 }, (_, m) => {
    let total = 0;
    let heavy = 0;
    const yearsWithVeryHeavy = new Set<number>();
    series.time.forEach((t, i) => {
      if (Number(t.slice(5, 7)) !== m + 1) return;
      const mm = series.precipitation_sum[i] ?? 0;
      total += mm;
      if (mm >= HEAVY) heavy++;
      if (mm >= VERY_HEAVY) yearsWithVeryHeavy.add(Number(t.slice(0, 4)));
    });
    return {
      month: m + 1,
      meanMm: Math.round(total / years),
      heavyDaysPerYear: Math.round((heavy / years) * 10) / 10, // average days >= 30 mm in this month
      probVeryHeavy: Math.round((yearsWithVeryHeavy.size / years) * 100) / 100, // share of years with a day >= 50 mm
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
    "data/climatology.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        period: `${START_YEAR}-${END_YEAR}`,
        source: "Open-Meteo Historical Weather API (ERA5 reanalysis)",
        thresholds: { heavyMm: HEAVY, veryHeavyMm: VERY_HEAVY },
        months,
      },
      null,
      1,
    ),
  );
  console.error(`wrote data/climatology.json for ${Object.keys(months).length} locations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
