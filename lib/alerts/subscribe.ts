import { lgaBySlug } from "../lgas";
import { bySlug } from "../locations";
import type { AlertChannel, AlertHazard, Store } from "../store";
import { DAY_MS } from "../types";
import { CONSENT_VERSION, otpMessage } from "./compose";
import { CODE_TTL_MS, MAX_CODES_PER_PHONE_PER_DAY, type AlertsConfig } from "./config";
import { normalizeNigerianPhone } from "./phone";
import { encryptPhone, hashCode, hashPhone, newOtp } from "./pii";

// The sign-up flow: ask for a number, prove ownership with a one-time code, and only then start sending alerts.
// Proving ownership matters twice over: it stops people enrolling a number that is not theirs, and it stops the
// sign-up form being used to spam strangers with codes.

type Ctx = { store: Store; config: Extract<AlertsConfig, { enabled: true }>; now?: () => number };
export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const CHANNELS: AlertChannel[] = ["sms", "whatsapp"];

export async function startSubscription(input: Record<string, unknown>, ctx: Ctx): Promise<ServiceResult> {
  const now = (ctx.now ?? Date.now)();

  if (input.consent !== true) return fail(400, "Please tick the box to agree to receive alerts.");

  const phone = normalizeNigerianPhone(typeof input.phone === "string" ? input.phone : "");
  if (!phone) return fail(400, "Enter a Nigerian mobile number, like 0803 123 4567.");

  const channel = input.channel as AlertChannel;
  if (!CHANNELS.includes(channel)) return fail(400, "Choose SMS or WhatsApp.");

  const state = typeof input.state === "string" ? input.state : "";
  if (!bySlug(state)) return fail(400, "Choose your state.");
  const lga = typeof input.lga === "string" && input.lga ? input.lga : undefined;
  if (lga && lgaBySlug(lga)?.state !== state) return fail(400, "That local government is not in the chosen state.");

  const hazards: AlertHazard[] = input.hazard === "both" ? ["flood", "heat"] : input.hazard === "flood" || input.hazard === "heat" ? [input.hazard] : [];
  if (!hazards.length) return fail(400, "Choose flood, heat or both.");

  const minLevel = Number(input.minLevel ?? 2);
  if (minLevel !== 2 && minLevel !== 3) return fail(400, "Choose High or Severe.");

  const since = now - DAY_MS;
  const phoneHash = hashPhone(phone);

  // Cost guards. Every code costs money, and fraudsters abuse sign-up forms to run up the bill (SMS pumping).
  if ((await ctx.store.countSends({ sinceMs: since })) >= ctx.config.dailyCap) return fail(503, "Alerts are temporarily unavailable. Please try again later.");
  if ((await ctx.store.countSends({ sinceMs: since, kind: "otp", phoneHash })) >= MAX_CODES_PER_PHONE_PER_DAY) {
    return fail(429, "Too many codes were requested for this number today. Please try again tomorrow.");
  }

  const code = newOtp();
  const codeHash = hashCode(phoneHash, code);
  const codeExpiresAt = new Date(now + CODE_TTL_MS).toISOString();
  const phoneEnc = encryptPhone(phone);

  let anyPending = false;
  for (const hazard of hazards) {
    const { pending } = await ctx.store.upsertPendingSubscription({ channel, phoneEnc, phoneHash, state, lga, hazard, minLevel, consentVersion: CONSENT_VERSION, codeHash, codeExpiresAt });
    anyPending ||= pending;
  }

  // Already subscribed: send nothing, and answer exactly as if we had, so this form cannot be used to find out
  // whether a number is subscribed.
  if (!anyPending) return { ok: true };

  const sent = await ctx.config.messenger.send({ kind: "otp", channel, toDigits: phone, text: otpMessage(code), code });
  await ctx.store.logSend("otp", phoneHash, sent.ok);
  if (!sent.ok) {
    console.error(`[alerts] could not send a code: ${sent.error}`);
    return fail(502, "We could not send the code. Please check the number and try again.");
  }
  return { ok: true };
}

export async function confirmSubscription(input: Record<string, unknown>, ctx: Ctx): Promise<ServiceResult<{ confirmed: number }>> {
  const phone = normalizeNigerianPhone(typeof input.phone === "string" ? input.phone : "");
  const channel = input.channel as AlertChannel;
  const code = typeof input.code === "string" ? input.code.replace(/\s/g, "") : "";
  if (!phone || !CHANNELS.includes(channel) || !/^\d{6}$/.test(code)) return fail(400, "Enter the 6-digit code from the message.");

  const phoneHash = hashPhone(phone);
  const result = await ctx.store.confirmSubscriptions(phoneHash, channel, hashCode(phoneHash, code), (ctx.now ?? Date.now)());

  if (result.confirmed > 0) return { ok: true, confirmed: result.confirmed };
  if (result.reason === "locked") return fail(429, "Too many wrong tries. Please start again to get a new code.");
  if (result.reason === "bad-code") return fail(400, "That code is not right. Check the message and try again.");
  return fail(400, "That code has expired, or none was requested. Please start again.");
}

/** Stop alerts. One code removes every subscription for that phone and channel, and the stored number with it. */
export async function unsubscribe(code: string, store: Store): Promise<ServiceResult<{ removed: number }>> {
  if (!/^[A-Za-z0-9_-]{10}$/.test(code)) return fail(400, "That stop link is not valid.");
  return { ok: true, removed: await store.unsubscribeByCode(code) };
}
