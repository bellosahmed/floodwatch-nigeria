import { createHash } from "crypto";
import path from "path";
import type { Store } from "./types";

export * from "./types";

// The app talks to storage only through this file. DATABASE_URL set  -> Postgres (production).
// Not set -> a JSON file (local development). Each implementation is loaded only when it is needed.

let instance: Promise<Store> | null = null;

async function create(): Promise<Store> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ Pool }, { createPostgresStore }] = await Promise.all([import("pg"), import("./postgres")]);
    const pool = new Pool({
      connectionString: url,
      max: 5, // small on purpose: serverless platforms open many instances
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000, // a free Neon database that has been idle needs a few seconds to wake
      statement_timeout: 10_000,
    });
    // An idle connection dropping (database restart, network blip) must not crash the server.
    pool.on("error", (err) => console.error("[db] idle connection error:", err.message));
    return createPostgresStore(pool);
  }

  // Serverless filesystems are read-only or wiped between requests. Fail loudly instead of losing reports.
  if (process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel: the file store cannot persist there.");

  const { createFileStore } = await import("./file");
  return createFileStore(process.env.FLOODWATCH_DB ?? path.join(process.cwd(), "data", "db.json"));
}

export function getStore(): Promise<Store> {
  instance ??= create().catch((err) => {
    instance = null; // allow a retry on the next request
    throw err;
  });
  return instance;
}

export const hashDevice = (raw: string) => createHash("sha256").update(raw).digest("hex").slice(0, 32);

// Thin wrappers, so callers say `addReport(...)` instead of `(await getStore()).addReport(...)`.
export const addReport = async (...a: Parameters<Store["addReport"]>) => (await getStore()).addReport(...a);
export const addGauge = async (...a: Parameters<Store["addGauge"]>) => (await getStore()).addGauge(...a);
export const addSnapshots = async (...a: Parameters<Store["addSnapshots"]>) => (await getStore()).addSnapshots(...a);
export const reportsSince = async (...a: Parameters<Store["reportsSince"]>) => (await getStore()).reportsSince(...a);
export const gaugesSince = async (...a: Parameters<Store["gaugesSince"]>) => (await getStore()).gaugesSince(...a);
export const allReports = async () => (await getStore()).allReports();
export const allSnapshots = async () => (await getStore()).allSnapshots();
export const listReports = async (...a: Parameters<Store["listReports"]>) => (await getStore()).listReports(...a);
export const setReportHidden = async (...a: Parameters<Store["setReportHidden"]>) => (await getStore()).setReportHidden(...a);
export const pruneStore = async () => (await getStore()).prune();
export const pingStore = async () => (await getStore()).ping();
