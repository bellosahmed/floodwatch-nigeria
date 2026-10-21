import type { Severity } from "../types";

// Everything the app stores. Two interchangeable implementations exist: a JSON file for local development
// (lib/store/file.ts) and Postgres for production (lib/store/postgres.ts). Nothing outside lib/store
// knows or cares which one is in use.

export type Report = {
  id: string;
  at: string; // ISO time
  state: string; // location slug
  lga?: string; // optional LGA slug, validated against the state when reported
  area: string; // free text: community or street
  severity: Severity;
  note: string;
  device: string; // sha256 of the client's anonymous id, never the raw id
  hidden?: boolean; // hidden by a moderator: kept in the database, excluded from everything public
};

export type Gauge = {
  id: string;
  at: string;
  state: string;
  station: string;
  levelM: number;
  warningM: number;
  dangerM: number;
};

// One row per state per day: the model inputs seen that day. Paired later with reports (the labels) this
// becomes the training set for a predictive model.
export type Snapshot = {
  date: string; // YYYY-MM-DD
  at: string;
  state: string;
  month: number;
  inOutlook: boolean;
  rainDay0Mm: number;
  rainNext3Mm: number;
  rain7Mm: number;
  rainPeakMm: number;
  riverRatio: number | null;
  riverPeakM3s: number | null;
  forecastLevel: number;
};

export type AlertChannel = "sms" | "whatsapp";
export type AlertHazard = "flood" | "heat";

// A person who asked to be messaged when a hazard reaches a level in their area.
// The phone number is stored encrypted (phoneEnc) and, for lookups, as a keyed hash (phoneHash). See lib/alerts/pii.ts.
export type Subscription = {
  id: string;
  createdAt: string;
  channel: AlertChannel;
  phoneEnc: string;
  phoneHash: string;
  state: string; // location slug
  lga?: string; // LGA slug; absent means the whole state
  hazard: AlertHazard;
  minLevel: 2 | 3; // alert at High (2) or Severe (3). Watch is deliberately not offered by SMS.
  confirmed: boolean; // true once the person proved they own the number with a one-time code
  codeHash?: string; // keyed hash of the one-time code, never the code itself
  codeExpiresAt?: string;
  codeAttempts: number;
  unsubCode: string; // goes in every message: one tap deletes the subscription
  lastAlertLevel: number; // 0 when no alert is active; remembers the level already sent in this episode
  lastAlertAt?: string;
  consentAt: string;
  consentVersion: string;
};

export type NewSubscription = Pick<Subscription, "channel" | "phoneEnc" | "phoneHash" | "state" | "lga" | "hazard" | "minLevel" | "consentVersion"> & {
  codeHash: string;
  codeExpiresAt: string;
};

export type SendKind = "otp" | "alert";

export type ConfirmResult = { confirmed: number; reason?: "bad-code" | "locked" | "none" };

export type NewReport = Omit<Report, "id" | "at" | "hidden">;
export type NewGauge = Omit<Gauge, "id" | "at">;

export const MAX_REPORTS_PER_DEVICE_PER_HOUR = 5;

export interface Store {
  readonly kind: "file" | "postgres";

  /** Refuses (ok: false) once a device has made MAX_REPORTS_PER_DEVICE_PER_HOUR reports in the last hour. */
  addReport(input: NewReport): Promise<{ ok: true; report: Report } | { ok: false }>;
  addGauge(input: NewGauge): Promise<Gauge>;
  /** Idempotent: a second snapshot for the same state and day is ignored. Returns how many were added. */
  addSnapshots(rows: Snapshot[]): Promise<number>;

  /** Visible (not hidden) reports and gauge readings from the given time (epoch ms) onward, oldest first. */
  reportsSince(sinceMs: number): Promise<Report[]>;
  gaugesSince(sinceMs: number): Promise<Gauge[]>;
  /** Everything visible, for building the training set. */
  allReports(): Promise<Report[]>;
  allSnapshots(): Promise<Snapshot[]>;

  /** Moderation. Lists newest first and includes hidden reports. */
  listReports(options: { state?: string; limit: number }): Promise<Report[]>;
  /** Hide or restore a report, optionally every report from the same device. Returns how many changed. */
  setReportHidden(id: string, hidden: boolean, alsoSameDevice?: boolean): Promise<number>;

  // ---- alert subscriptions ----

  /**
   * Add (or refresh) an unconfirmed subscription for this phone, channel, area and hazard, with a fresh one-time code.
   * An already-confirmed subscription is left untouched, so re-subscribing cannot change or pause someone else's alerts.
   * Returns the subscription now stored, and whether it is waiting for confirmation.
   */
  upsertPendingSubscription(input: NewSubscription): Promise<{ subscription: Subscription; pending: boolean }>;
  /** Check a code against every unconfirmed subscription for this phone and channel. Counts wrong tries and locks after 5. */
  confirmSubscriptions(phoneHash: string, channel: AlertChannel, codeHash: string, nowMs: number): Promise<ConfirmResult>;
  listConfirmedSubscriptions(): Promise<Subscription[]>;
  /** Remember the level just alerted (or 0 to end the episode). */
  setAlertState(id: string, level: number, atMs: number | null): Promise<void>;
  /** Delete every subscription belonging to the same phone and channel as this code. Returns how many were removed. */
  unsubscribeByCode(code: string): Promise<number>;
  logSend(kind: SendKind, phoneHash: string | null, ok: boolean): Promise<void>;
  countSends(options: { sinceMs: number; kind?: SendKind; phoneHash?: string }): Promise<number>;
  subscriptionStats(): Promise<{ confirmed: number; pending: number; byState: Record<string, number> }>;

  /** Delete data past its retention period. Safe to call often. */
  prune(): Promise<void>;
  /** Throws if the store cannot be reached. */
  ping(): Promise<void>;
}

export const GAUGE_KEEP_DAYS = 30;
export const SEND_LOG_KEEP_DAYS = 90;
/** Unconfirmed subscriptions (and their stored numbers) are deleted after a day. */
export const PENDING_KEEP_HOURS = 24;
export const MAX_CODE_ATTEMPTS = 5;
/** Reports and snapshots are the training data, so they are kept far longer than live gauge readings. */
export const TRAINING_KEEP_DAYS = 5 * 365;
