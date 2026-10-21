import { randomUUID } from "crypto";
import { newUnsubCode } from "./common";
import {
  GAUGE_KEEP_DAYS,
  MAX_CODE_ATTEMPTS,
  MAX_REPORTS_PER_DEVICE_PER_HOUR,
  PENDING_KEEP_HOURS,
  SEND_LOG_KEEP_DAYS,
  TRAINING_KEEP_DAYS,
  type ConfirmResult,
  type Gauge,
  type Report,
  type Snapshot,
  type Store,
  type Subscription,
} from "./types";

// The production store. It needs only something with a pg-style query() method, so it works with a pg Pool
// against any Postgres (Neon, Supabase, RDS, a container) and is tested against a real database.

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number | null };

export type Queryable = {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  /** A pg Pool has this. It lets a few operations run as one transaction on a single connection. */
  connect?(): Promise<{ query(text: string, params?: unknown[]): Promise<QueryResult>; release(): void }>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id        text PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  state     text NOT NULL,
  lga       text,
  area      text NOT NULL,
  severity  smallint NOT NULL CHECK (severity BETWEEN 1 AND 3),
  note      text NOT NULL DEFAULT '',
  device    text NOT NULL,
  hidden    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS reports_at_idx ON reports (at DESC);
CREATE INDEX IF NOT EXISTS reports_device_at_idx ON reports (device, at DESC);
CREATE INDEX IF NOT EXISTS reports_state_at_idx ON reports (state, at DESC);

CREATE TABLE IF NOT EXISTS gauges (
  id        text PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  state     text NOT NULL,
  station   text NOT NULL,
  level_m   double precision NOT NULL,
  warning_m double precision NOT NULL,
  danger_m  double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS gauges_at_idx ON gauges (at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  date            text NOT NULL,
  state           text NOT NULL,
  at              timestamptz NOT NULL,
  month           smallint NOT NULL,
  in_outlook      boolean NOT NULL,
  rain_day0_mm    double precision NOT NULL,
  rain_next3_mm   double precision NOT NULL,
  rain_7d_mm      double precision NOT NULL,
  rain_peak_mm    double precision NOT NULL,
  river_ratio     double precision,
  river_peak_m3s  double precision,
  forecast_level  smallint NOT NULL,
  PRIMARY KEY (date, state)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               text PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  channel          text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  phone_enc        text NOT NULL,
  phone_hash       text NOT NULL,
  state            text NOT NULL,
  lga              text NOT NULL DEFAULT '',
  hazard           text NOT NULL CHECK (hazard IN ('flood', 'heat')),
  min_level        smallint NOT NULL CHECK (min_level IN (2, 3)),
  confirmed        boolean NOT NULL DEFAULT false,
  code_hash        text,
  code_expires_at  timestamptz,
  code_attempts    smallint NOT NULL DEFAULT 0,
  unsub_code       text NOT NULL UNIQUE,
  last_alert_level smallint NOT NULL DEFAULT 0,
  last_alert_at    timestamptz,
  consent_at       timestamptz NOT NULL DEFAULT now(),
  consent_version  text NOT NULL,
  UNIQUE (phone_hash, channel, state, lga, hazard)
);
CREATE INDEX IF NOT EXISTS subscriptions_confirmed_idx ON subscriptions (confirmed, state);
CREATE INDEX IF NOT EXISTS subscriptions_phone_idx ON subscriptions (phone_hash, channel);

CREATE TABLE IF NOT EXISTS send_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  phone_hash  text,
  ok          boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS send_log_at_idx ON send_log (at DESC);
CREATE INDEX IF NOT EXISTS send_log_phone_idx ON send_log (phone_hash, at DESC);
`;

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toReport = (r: Row): Report => ({
  id: String(r.id),
  at: iso(r.at),
  state: String(r.state),
  lga: r.lga ? String(r.lga) : undefined,
  area: String(r.area),
  severity: Number(r.severity) as Report["severity"],
  note: String(r.note),
  device: String(r.device),
  hidden: Boolean(r.hidden),
});

const toGauge = (r: Row): Gauge => ({
  id: String(r.id),
  at: iso(r.at),
  state: String(r.state),
  station: String(r.station),
  levelM: Number(r.level_m),
  warningM: Number(r.warning_m),
  dangerM: Number(r.danger_m),
});

const toSnapshot = (r: Row): Snapshot => ({
  date: String(r.date),
  at: iso(r.at),
  state: String(r.state),
  month: Number(r.month),
  inOutlook: Boolean(r.in_outlook),
  rainDay0Mm: Number(r.rain_day0_mm),
  rainNext3Mm: Number(r.rain_next3_mm),
  rain7Mm: Number(r.rain_7d_mm),
  rainPeakMm: Number(r.rain_peak_mm),
  riverRatio: num(r.river_ratio),
  riverPeakM3s: num(r.river_peak_m3s),
  forecastLevel: Number(r.forecast_level),
});

const toSubscription = (r: Row): Subscription => ({
  id: String(r.id),
  createdAt: iso(r.created_at),
  channel: r.channel as Subscription["channel"],
  phoneEnc: String(r.phone_enc),
  phoneHash: String(r.phone_hash),
  state: String(r.state),
  lga: r.lga ? String(r.lga) : undefined,
  hazard: r.hazard as Subscription["hazard"],
  minLevel: Number(r.min_level) as Subscription["minLevel"],
  confirmed: Boolean(r.confirmed),
  codeHash: r.code_hash ? String(r.code_hash) : undefined,
  codeExpiresAt: r.code_expires_at ? iso(r.code_expires_at) : undefined,
  codeAttempts: Number(r.code_attempts),
  unsubCode: String(r.unsub_code),
  lastAlertLevel: Number(r.last_alert_level),
  lastAlertAt: r.last_alert_at ? iso(r.last_alert_at) : undefined,
  consentAt: iso(r.consent_at),
  consentVersion: String(r.consent_version),
});

const SUBSCRIPTION_COLUMNS =
  "id, created_at, channel, phone_enc, phone_hash, state, lga, hazard, min_level, confirmed, code_hash, code_expires_at, code_attempts, unsub_code, last_alert_level, last_alert_at, consent_at, consent_version";

const REPORT_COLUMNS = "id, at, state, lga, area, severity, note, device, hidden";
const GAUGE_COLUMNS = "id, at, state, station, level_m, warning_m, danger_m";

// Creating a table is not safe to run from two connections at once (Postgres can raise a duplicate-key error),
// and a fresh deploy wakes several serverless instances together. A transaction-scoped advisory lock makes
// them take turns. It also works through Neon's pooled (PgBouncer transaction mode) connections.
async function createSchema(db: Queryable): Promise<void> {
  if (!db.connect) {
    await db.query(SCHEMA);
    return;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('floodwatch-schema'))");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function createPostgresStore(db: Queryable): Store {
  // Create the tables on first use. Safe to run repeatedly and from several servers at once.
  let ready: Promise<void> | null = null;
  const ensure = () => {
    ready ??= createSchema(db).then(
      () => undefined,
      (err) => {
        ready = null; // let the next request retry instead of failing forever
        throw err;
      },
    );
    return ready;
  };
  const q = async (text: string, params?: unknown[]) => {
    await ensure();
    return db.query(text, params);
  };
  // Run several statements as one transaction on a single connection (when the pool allows it).
  const tx = async <T>(fn: (query: Queryable["query"]) => Promise<T>): Promise<T> => {
    await ensure();
    if (!db.connect) return fn((t, p) => db.query(t, p));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn((t, p) => client.query(t, p));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  return {
    kind: "postgres",

    async addReport(input) {
      await ensure();
      const args = [randomUUID(), input.state, input.lga ?? null, input.area, input.severity, input.note, input.device, MAX_REPORTS_PER_DEVICE_PER_HOUR];
      const insert = `INSERT INTO reports (id, state, lga, area, severity, note, device)
         SELECT $1::text, $2::text, $3::text, $4::text, $5::smallint, $6::text, $7::text
          WHERE (SELECT count(*) FROM reports WHERE device = $7::text AND at > now() - interval '1 hour') < $8::int
         RETURNING ${REPORT_COLUMNS}`;

      // Counting then inserting is a race: two simultaneous requests can both see 4 reports and both insert.
      // A per-device lock held until the transaction ends makes them take turns, and the count is read
      // after the lock is won, so it includes the winner of the previous turn.
      if (!db.connect) {
        const { rows } = await db.query(insert, args);
        return rows.length ? { ok: true as const, report: toReport(rows[0]) } : { ok: false as const };
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [input.device]);
        const { rows } = await client.query(insert, args);
        await client.query("COMMIT");
        return rows.length ? { ok: true as const, report: toReport(rows[0]) } : { ok: false as const };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async addGauge(input) {
      const { rows } = await q(
        `INSERT INTO gauges (id, state, station, level_m, warning_m, danger_m)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${GAUGE_COLUMNS}`,
        [randomUUID(), input.state, input.station, input.levelM, input.warningM, input.dangerM],
      );
      return toGauge(rows[0]);
    },

    async addSnapshots(rows) {
      let added = 0;
      for (const s of rows) {
        const res = await q(
          `INSERT INTO snapshots (date, state, at, month, in_outlook, rain_day0_mm, rain_next3_mm, rain_7d_mm,
                                  rain_peak_mm, river_ratio, river_peak_m3s, forecast_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (date, state) DO NOTHING RETURNING date`,
          [s.date, s.state, s.at, s.month, s.inOutlook, s.rainDay0Mm, s.rainNext3Mm, s.rain7Mm, s.rainPeakMm, s.riverRatio, s.riverPeakM3s, s.forecastLevel],
        );
        added += res.rows.length;
      }
      return added;
    },

    async reportsSince(sinceMs) {
      const { rows } = await q(
        `SELECT ${REPORT_COLUMNS} FROM reports WHERE NOT hidden AND at >= to_timestamp($1::double precision / 1000.0) ORDER BY at`,
        [sinceMs],
      );
      return rows.map(toReport);
    },

    async gaugesSince(sinceMs) {
      const { rows } = await q(
        `SELECT ${GAUGE_COLUMNS} FROM gauges WHERE at >= to_timestamp($1::double precision / 1000.0) ORDER BY at`,
        [sinceMs],
      );
      return rows.map(toGauge);
    },

    async allReports() {
      const { rows } = await q(`SELECT ${REPORT_COLUMNS} FROM reports WHERE NOT hidden ORDER BY at`);
      return rows.map(toReport);
    },

    async allSnapshots() {
      const { rows } = await q(`SELECT * FROM snapshots ORDER BY date, state`);
      return rows.map(toSnapshot);
    },

    async listReports({ state, limit }) {
      const { rows } = await q(
        `SELECT ${REPORT_COLUMNS} FROM reports WHERE ($1::text IS NULL OR state = $1::text) ORDER BY at DESC LIMIT $2::int`,
        [state ?? null, limit],
      );
      return rows.map(toReport);
    },

    async setReportHidden(id, hidden, alsoSameDevice = false) {
      const res = await q(
        `UPDATE reports SET hidden = $2::boolean
          WHERE (id = $1::text OR ($3::boolean AND device = (SELECT device FROM reports WHERE id = $1::text)))
            AND hidden IS DISTINCT FROM $2::boolean`,
        [id, hidden, alsoSameDevice],
      );
      return res.rowCount ?? 0;
    },

    async upsertPendingSubscription(input) {
      const { rows } = await q(
        `INSERT INTO subscriptions (id, channel, phone_enc, phone_hash, state, lga, hazard, min_level, confirmed,
                                    code_hash, code_expires_at, code_attempts, unsub_code, consent_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, 0, $11, $12)
         ON CONFLICT (phone_hash, channel, state, lga, hazard) DO UPDATE
            SET phone_enc = EXCLUDED.phone_enc, min_level = EXCLUDED.min_level, code_hash = EXCLUDED.code_hash,
                code_expires_at = EXCLUDED.code_expires_at, code_attempts = 0, consent_at = now(),
                consent_version = EXCLUDED.consent_version
          WHERE subscriptions.confirmed = false
         RETURNING ${SUBSCRIPTION_COLUMNS}`,
        [randomUUID(), input.channel, input.phoneEnc, input.phoneHash, input.state, input.lga ?? "", input.hazard, input.minLevel, input.codeHash, input.codeExpiresAt, newUnsubCode(), input.consentVersion],
      );
      if (rows.length) return { subscription: toSubscription(rows[0]), pending: true };
      // The row exists and is already confirmed, so the statement above left it alone.
      const existing = await q(
        `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE phone_hash = $1 AND channel = $2 AND state = $3 AND lga = $4 AND hazard = $5`,
        [input.phoneHash, input.channel, input.state, input.lga ?? "", input.hazard],
      );
      return { subscription: toSubscription(existing.rows[0]), pending: false };
    },

    async confirmSubscriptions(phoneHash, channel, codeHash, nowMs): Promise<ConfirmResult> {
      // FOR UPDATE holds the rows, so parallel guesses cannot all be checked before the attempt counter moves.
      return tx(async (query) => {
        const { rows } = await query(
          `SELECT id, code_hash, code_attempts FROM subscriptions
            WHERE phone_hash = $1 AND channel = $2 AND NOT confirmed
              AND code_expires_at > to_timestamp($3::double precision / 1000.0)
            FOR UPDATE`,
          [phoneHash, channel, nowMs],
        );
        if (!rows.length) return { confirmed: 0, reason: "none" };
        if (rows.some((r) => Number(r.code_attempts) >= MAX_CODE_ATTEMPTS)) return { confirmed: 0, reason: "locked" };
        const matching = rows.filter((r) => r.code_hash === codeHash).map((r) => String(r.id));
        if (!matching.length) {
          await query("UPDATE subscriptions SET code_attempts = code_attempts + 1 WHERE id = ANY($1::text[])", [rows.map((r) => String(r.id))]);
          return { confirmed: 0, reason: "bad-code" };
        }
        await query(
          "UPDATE subscriptions SET confirmed = true, code_hash = NULL, code_expires_at = NULL, code_attempts = 0 WHERE id = ANY($1::text[])",
          [matching],
        );
        return { confirmed: matching.length };
      });
    },

    async listConfirmedSubscriptions() {
      const { rows } = await q(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE confirmed ORDER BY created_at`);
      return rows.map(toSubscription);
    },

    async setAlertState(id, level, atMs) {
      await q("UPDATE subscriptions SET last_alert_level = $2::smallint, last_alert_at = CASE WHEN $3::double precision IS NULL THEN NULL ELSE to_timestamp($3::double precision / 1000.0) END WHERE id = $1", [id, level, atMs]);
    },

    async unsubscribeByCode(code) {
      const res = await q(
        "DELETE FROM subscriptions WHERE (phone_hash, channel) IN (SELECT phone_hash, channel FROM subscriptions WHERE unsub_code = $1)",
        [code],
      );
      return res.rowCount ?? 0;
    },

    async logSend(kind, phoneHash, ok) {
      await q("INSERT INTO send_log (kind, phone_hash, ok) VALUES ($1, $2, $3)", [kind, phoneHash, ok]);
    },

    async countSends({ sinceMs, kind, phoneHash }) {
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM send_log
          WHERE at >= to_timestamp($1::double precision / 1000.0)
            AND ($2::text IS NULL OR kind = $2::text)
            AND ($3::text IS NULL OR phone_hash = $3::text)`,
        [sinceMs, kind ?? null, phoneHash ?? null],
      );
      return Number(rows[0].n);
    },

    async subscriptionStats() {
      const { rows } = await q("SELECT state, confirmed, count(*)::int AS n FROM subscriptions GROUP BY state, confirmed");
      const byState: Record<string, number> = {};
      let confirmed = 0;
      let pending = 0;
      for (const r of rows) {
        if (r.confirmed) {
          confirmed += Number(r.n);
          byState[String(r.state)] = (byState[String(r.state)] ?? 0) + Number(r.n);
        } else pending += Number(r.n);
      }
      return { confirmed, pending, byState };
    },

    async prune() {
      await q("DELETE FROM subscriptions WHERE NOT confirmed AND created_at < now() - make_interval(hours => $1::int)", [PENDING_KEEP_HOURS]);
      await q("DELETE FROM send_log WHERE at < now() - make_interval(days => $1::int)", [SEND_LOG_KEEP_DAYS]);
      await q(`DELETE FROM gauges WHERE at < now() - make_interval(days => $1::int)`, [GAUGE_KEEP_DAYS]);
      await q(`DELETE FROM reports WHERE at < now() - make_interval(days => $1::int)`, [TRAINING_KEEP_DAYS]);
      await q(`DELETE FROM snapshots WHERE at < now() - make_interval(days => $1::int)`, [TRAINING_KEEP_DAYS]);
    },

    async ping() {
      await q("SELECT 1");
    },
  };
}
