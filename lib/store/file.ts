import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { DAY_MS, HOUR_MS } from "../types";
import { newUnsubCode, subscriptionKey } from "./common";
import {
  GAUGE_KEEP_DAYS,
  MAX_CODE_ATTEMPTS,
  MAX_REPORTS_PER_DEVICE_PER_HOUR,
  PENDING_KEEP_HOURS,
  SEND_LOG_KEEP_DAYS,
  TRAINING_KEEP_DAYS,
  type Gauge,
  type Report,
  type SendKind,
  type Snapshot,
  type Store,
  type Subscription,
} from "./types";

// A deliberately tiny file-backed store so local development needs no database server.
// Single process only: use the Postgres store anywhere real traffic or several servers are involved.

type SendLogEntry = { at: string; kind: SendKind; phoneHash: string | null; ok: boolean };
type Db = { reports: Report[]; gauges: Gauge[]; snapshots: Snapshot[]; subscriptions: Subscription[]; sendLog: SendLogEntry[] };
const emptyDb = (): Db => ({ reports: [], gauges: [], snapshots: [], subscriptions: [], sendLog: [] });

export function createFileStore(file: string): Store {
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Db> {
    let text: string;
    try {
      text = await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
    } catch (err) {
      // A missing file is a fresh install. Any other failure must surface, never look like "empty".
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
      throw err;
    }
    // A corrupt file throws here on purpose: silently starting empty would overwrite recoverable data.
    const db = JSON.parse(text) as Partial<Db>;
    return { ...emptyDb(), ...db };
  }

  async function save(db: Db) {
    await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(db), { mode: 0o600 }); // owner-only: holds hashed device ids
    await fs.rename(/* turbopackIgnore: true */ tmp, file); // atomic replace: a crash never leaves a half-written file
  }

  // Serialise every read-modify-write so concurrent requests cannot lose updates.
  function mutate<T>(fn: (db: Db) => T): Promise<T> {
    const run = queue.then(async () => {
      const db = await load();
      const result = fn(db);
      await save(db);
      return result;
    });
    queue = run.catch(() => undefined); // one failed write must not poison the queue
    return run;
  }

  async function read(): Promise<Db> {
    await queue; // wait for in-flight writes so reads see them
    return load();
  }

  const visible = (reports: Report[]) => reports.filter((r) => !r.hidden);

  return {
    kind: "file",

    addReport: (input) =>
      mutate((db) => {
        const since = Date.now() - HOUR_MS;
        const recent = db.reports.filter((r) => r.device === input.device && Date.parse(r.at) >= since).length;
        if (recent >= MAX_REPORTS_PER_DEVICE_PER_HOUR) return { ok: false as const };
        const report: Report = { ...input, id: randomUUID(), at: new Date().toISOString(), hidden: false };
        db.reports.push(report);
        return { ok: true as const, report };
      }),

    addGauge: (input) =>
      mutate((db) => {
        const gauge: Gauge = { ...input, id: randomUUID(), at: new Date().toISOString() };
        db.gauges.push(gauge);
        return gauge;
      }),

    addSnapshots: (rows) =>
      mutate((db) => {
        const seen = new Set(db.snapshots.map((s) => `${s.date}|${s.state}`));
        let added = 0;
        for (const row of rows) {
          if (seen.has(`${row.date}|${row.state}`)) continue;
          db.snapshots.push(row);
          added++;
        }
        return added;
      }),

    reportsSince: async (sinceMs) =>
      visible((await read()).reports)
        .filter((r) => Date.parse(r.at) >= sinceMs)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),

    gaugesSince: async (sinceMs) =>
      (await read()).gauges.filter((g) => Date.parse(g.at) >= sinceMs).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),

    allReports: async () => visible((await read()).reports).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    allSnapshots: async () => (await read()).snapshots,

    listReports: async ({ state, limit }) =>
      (await read()).reports
        .filter((r) => !state || r.state === state)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit),

    setReportHidden: (id, hidden, alsoSameDevice = false) =>
      mutate((db) => {
        const target = db.reports.find((r) => r.id === id);
        if (!target) return 0;
        let changed = 0;
        for (const r of db.reports) {
          if (r.id === id || (alsoSameDevice && r.device === target.device)) {
            if (Boolean(r.hidden) !== hidden) changed++;
            r.hidden = hidden;
          }
        }
        return changed;
      }),

    upsertPendingSubscription: (input) =>
      mutate((db) => {
        const key = subscriptionKey(input);
        const existing = db.subscriptions.find((s) => subscriptionKey(s) === key);
        // A confirmed subscription is never touched by a new request: otherwise anyone who knows a number could
        // change or pause that person's alerts.
        if (existing?.confirmed) return { subscription: existing, pending: false };
        if (existing) {
          Object.assign(existing, {
            phoneEnc: input.phoneEnc,
            minLevel: input.minLevel,
            codeHash: input.codeHash,
            codeExpiresAt: input.codeExpiresAt,
            codeAttempts: 0,
            consentAt: new Date().toISOString(),
            consentVersion: input.consentVersion,
          });
          return { subscription: existing, pending: true };
        }
        const sub: Subscription = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          channel: input.channel,
          phoneEnc: input.phoneEnc,
          phoneHash: input.phoneHash,
          state: input.state,
          lga: input.lga,
          hazard: input.hazard,
          minLevel: input.minLevel,
          confirmed: false,
          codeHash: input.codeHash,
          codeExpiresAt: input.codeExpiresAt,
          codeAttempts: 0,
          unsubCode: newUnsubCode(),
          lastAlertLevel: 0,
          consentAt: new Date().toISOString(),
          consentVersion: input.consentVersion,
        };
        db.subscriptions.push(sub);
        return { subscription: sub, pending: true };
      }),

    confirmSubscriptions: (phoneHash, channel, codeHash, nowMs) =>
      mutate((db) => {
        const waiting = db.subscriptions.filter(
          (s) => s.phoneHash === phoneHash && s.channel === channel && !s.confirmed && s.codeExpiresAt && Date.parse(s.codeExpiresAt) > nowMs,
        );
        if (!waiting.length) return { confirmed: 0, reason: "none" as const };
        if (waiting.some((s) => s.codeAttempts >= MAX_CODE_ATTEMPTS)) return { confirmed: 0, reason: "locked" as const };
        if (!waiting.some((s) => s.codeHash === codeHash)) {
          for (const s of waiting) s.codeAttempts++;
          return { confirmed: 0, reason: "bad-code" as const };
        }
        let confirmed = 0;
        for (const s of waiting) {
          if (s.codeHash !== codeHash) continue;
          s.confirmed = true;
          s.codeHash = undefined;
          s.codeExpiresAt = undefined;
          s.codeAttempts = 0;
          confirmed++;
        }
        return { confirmed };
      }),

    listConfirmedSubscriptions: async () => (await read()).subscriptions.filter((s) => s.confirmed),

    setAlertState: (id, level, atMs) =>
      mutate((db) => {
        const s = db.subscriptions.find((x) => x.id === id);
        if (!s) return;
        s.lastAlertLevel = level;
        s.lastAlertAt = atMs === null ? undefined : new Date(atMs).toISOString();
      }),

    unsubscribeByCode: (code) =>
      mutate((db) => {
        const target = db.subscriptions.find((s) => s.unsubCode === code);
        if (!target) return 0;
        const before = db.subscriptions.length;
        db.subscriptions = db.subscriptions.filter((s) => !(s.phoneHash === target.phoneHash && s.channel === target.channel));
        return before - db.subscriptions.length;
      }),

    logSend: (kind, phoneHash, ok) =>
      mutate((db) => {
        db.sendLog.push({ at: new Date().toISOString(), kind, phoneHash, ok });
      }),

    countSends: async ({ sinceMs, kind, phoneHash }) =>
      (await read()).sendLog.filter(
        (e) => Date.parse(e.at) >= sinceMs && (!kind || e.kind === kind) && (phoneHash === undefined || e.phoneHash === phoneHash),
      ).length,

    subscriptionStats: async () => {
      const subs = (await read()).subscriptions;
      const byState: Record<string, number> = {};
      for (const s of subs) if (s.confirmed) byState[s.state] = (byState[s.state] ?? 0) + 1;
      return { confirmed: subs.filter((s) => s.confirmed).length, pending: subs.filter((s) => !s.confirmed).length, byState };
    },

    prune: () =>
      mutate((db) => {
        const now = Date.now();
        db.reports = db.reports.filter((r) => now - Date.parse(r.at) <= TRAINING_KEEP_DAYS * DAY_MS);
        db.snapshots = db.snapshots.filter((s) => now - Date.parse(s.at) <= TRAINING_KEEP_DAYS * DAY_MS);
        db.gauges = db.gauges.filter((g) => now - Date.parse(g.at) <= GAUGE_KEEP_DAYS * DAY_MS);
        // Unconfirmed sign-ups hold a stored number, so they are deleted after a day if never confirmed.
        db.subscriptions = db.subscriptions.filter((s) => s.confirmed || now - Date.parse(s.createdAt) <= PENDING_KEEP_HOURS * HOUR_MS);
        db.sendLog = db.sendLog.filter((e) => now - Date.parse(e.at) <= SEND_LOG_KEEP_DAYS * DAY_MS);
      }),

    ping: async () => {
      await read();
    },
  };
}
