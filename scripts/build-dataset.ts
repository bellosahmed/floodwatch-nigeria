// Build a training CSV from the app's own data (Postgres if DATABASE_URL is set, otherwise the local file).
//   npm run dataset > dataset.csv
//
// Each row is one state on one day. Labels are what people reported in the following 72 hours.
// Rows whose label window is still open are skipped. Reports hidden by a moderator are excluded.
import { buildDataset, toCsv } from "../lib/dataset";
import { getStore } from "../lib/store";

async function main() {
  const store = await getStore();
  const [snapshots, reports] = await Promise.all([store.allSnapshots(), store.allReports()]);
  const { rows, skipped } = buildDataset(snapshots, reports);
  console.log(toCsv(rows));
  console.error(`store: ${store.kind}, rows: ${rows.length}, skipped (label window still open): ${skipped}, reports: ${reports.length}`);
  process.exit(0); // close any open database connections
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
