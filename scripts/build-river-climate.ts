// Builds data/river-climate.json: for every state and calendar month, how much the river flow usually is
// (median and 90th percentile of daily discharge), from 2015-2024 of modelled history (GloFAS via Open-Meteo).
//   npm run riverclimate
// The app reads the saved file, so it never calls the flood archive at runtime. Used to tell a normal
// rainy-season rise from an unusual one: rivers rise every year, and that alone is not a warning.
import { writeFileSync, mkdirSync } from "node:fs";
import { LOCATIONS } from "../lib/locations";

const START_YEAR = 2015;
const END_YEAR = 2024;
const BATCH = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Flood = { daily: { time: string[]; river_discharge: (number | null)[] } };

async function fetchFlood(batch: typeof LOCATIONS): Promise<Flood[]> {
  const url =
    `https://flood-api.open-meteo.com/v1/flood?latitude=${batch.map((l) => l.lat).join(",")}` +
    `&longitude=${batch.map((l) => l.lon).join(",")}&start_date=${START_YEAR}-01-01&end_date=${END_YEAR}-12-31&daily=river_discharge`;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (res.ok) {
        const json: unknown = await res.json();
        return (Array.isArray(json) ? json : [json]) as Flood[];
      }
      console.error(`  attempt ${attempt} failed: ${res.status}`);
    } catch (err) {
      console.error(`  attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(8_000 * attempt); // back off, rate limits clear after a while
  }
  throw new Error("Flood archive kept failing; try again in a few minutes");
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function monthStats(series: Flood["daily"]) {
  return Array.from({ length: 12 }, (_, m) => {
    const flows: number[] = [];
    series.time.forEach((t, i) => {
      const v = series.river_discharge[i];
      if (Number(t.slice(5, 7)) === m + 1 && typeof v === "number") flows.push(v);
    });
    flows.sort((a, b) => a - b);
    // Too little data (or no river modelled at this point): leave it out, and the app applies no seasonal check.
    if (flows.length < 100) return { month: m + 1, p50M3s: null, p90M3s: null };
    return { month: m + 1, p50M3s: round1(percentile(flows, 0.5)), p90M3s: round1(percentile(flows, 0.9)) };
  });
}

async function main() {
  const months: Record<string, ReturnType<typeof monthStats>> = {};
  for (let i = 0; i < LOCATIONS.length; i += BATCH) {
    const batch = LOCATIONS.slice(i, i + BATCH);
    console.error(`fetching ${batch.map((l) => l.name).join(", ")}`);
    const rows = await fetchFlood(batch);
    if (rows.length !== batch.length) throw new Error(`Expected ${batch.length} rows, got ${rows.length}`);
    batch.forEach((loc, j) => (months[loc.slug] = monthStats(rows[j].daily)));
    await sleep(2_500);
  }

  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/river-climate.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        period: `${START_YEAR}-${END_YEAR}`,
        source: "Open-Meteo Flood API (GloFAS reanalysis)",
        months,
      },
      null,
      1,
    ),
  );
  console.error(`wrote data/river-climate.json for ${Object.keys(months).length} locations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
