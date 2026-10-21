import { piiKeyConfigured } from "./pii";
import { createMessenger, type Messenger } from "./providers";

// Alerts stay switched off unless everything they need is present. Nothing here sends a message by itself.

export type AlertsConfig =
  | {
      enabled: true;
      messenger: Messenger;
      siteUrl: string; // no trailing slash; used in the unsubscribe link
      live: boolean; // false: the alert job only reports what it WOULD send
      dailyCap: number; // most messages (codes + alerts) sent in any rolling 24 hours
    }
  | { enabled: false; reason: string };

type Env = Record<string, string | undefined>;

const DEFAULT_DAILY_CAP = 300;

/** Build the configuration from the environment. Cheap enough to call per request. */
export function alertsConfig(env: Env = process.env): AlertsConfig {
  if (!env.SMS_PROVIDER) return { enabled: false, reason: "SMS_PROVIDER is not set" };
  if (!piiKeyConfigured()) return { enabled: false, reason: "PII_ENCRYPTION_KEY is missing or not 64 hex characters" };
  if (!env.SITE_ORIGIN) return { enabled: false, reason: "SITE_ORIGIN is not set (needed for the unsubscribe link)" };

  let messenger: Messenger;
  try {
    messenger = createMessenger(env);
  } catch (err) {
    return { enabled: false, reason: err instanceof Error ? err.message : "provider misconfigured" };
  }

  const cap = Number(env.SMS_DAILY_CAP);
  return {
    enabled: true,
    messenger,
    siteUrl: env.SITE_ORIGIN.replace(/\/$/, ""),
    live: env.ALERTS_LIVE === "true",
    dailyCap: Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_DAILY_CAP,
  };
}

export const MAX_CODES_PER_PHONE_PER_DAY = 3;
export const CODE_TTL_MS = 10 * 60_000;
