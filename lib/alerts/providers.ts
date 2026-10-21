import { appendFileSync } from "fs";
import type { AlertChannel, SendKind } from "../store";
import { maskPhone, toE164 } from "./phone";

// One interface, several ways to actually send. Written to the providers' published request formats
// (Termii: developers.termii.com/messaging-api, Twilio: twilio.com/docs/messaging/api/message-resource).
// IMPORTANT: no real message has been sent through the Termii or Twilio adapters yet. They are verified against
// mocked HTTP only. Send yourself a real test message (with ALERTS_LIVE unset, one subscription) before launch.
//
// Errors never contain the phone number, the message text or any key, so they are safe to log.

export type SendRequest = {
  kind: SendKind;
  channel: AlertChannel;
  toDigits: string; // 2348012345678
  text: string;
  code?: string; // the one-time code, for WhatsApp templates that take only the code
};
export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface Messenger {
  readonly name: "termii" | "twilio" | "dry-run";
  send(req: SendRequest): Promise<SendResult>;
}

const TIMEOUT_MS = 10_000;
type Env = Record<string, string | undefined>;

async function postJson(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

const requireVars = (env: Env, names: string[], provider: string) => {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`${provider} needs ${missing.join(", ")}`);
};

// ---- Termii (Nigerian provider) --------------------------------------------------------------------------------
// Verification codes and alerts are transactional, so SMS uses the "dnd" route by default. It reaches numbers on
// Nigeria's Do-Not-Disturb list and is not subject to the MTN 8pm-8am block, but must be activated on your Termii
// account. The "generic" route is for promotions: it can fail to deliver codes and can get a sender ID blocked.
export function termii(env: Env = process.env): Messenger {
  requireVars(env, ["TERMII_API_KEY", "TERMII_BASE_URL", "TERMII_SENDER_ID"], "Termii");
  const base = new URL(env.TERMII_BASE_URL!);
  if (base.protocol !== "https:") throw new Error("TERMII_BASE_URL must be https");
  const smsRoute = env.TERMII_SMS_CHANNEL === "generic" ? "generic" : "dnd";

  return {
    name: "termii",
    async send({ channel, toDigits, text }) {
      if (channel === "whatsapp" && !env.TERMII_WHATSAPP_FROM) return { ok: false, error: "termii whatsapp not configured" };
      try {
        const { status, body } = await postJson(new URL("/api/sms/send", base).toString(), {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: env.TERMII_API_KEY,
            to: toDigits, // Termii wants international format without the plus
            from: channel === "whatsapp" ? env.TERMII_WHATSAPP_FROM : env.TERMII_SENDER_ID,
            sms: text,
            type: "plain",
            channel: channel === "whatsapp" ? "whatsapp" : smsRoute,
          }),
        });
        if (status >= 200 && status < 300 && body.code === "ok") return { ok: true, id: body.message_id_str ? String(body.message_id_str) : undefined };
        return { ok: false, error: `termii http ${status} ${typeof body.code === "string" ? body.code : ""}`.trim() };
      } catch (err) {
        return { ok: false, error: `termii ${err instanceof Error ? err.name : "error"}` };
      }
    },
  };
}

// ---- Twilio ---------------------------------------------------------------------------------------------------
// WhatsApp: a message to someone who has not messaged you in the last 24 hours must use a pre-approved template.
// Set TWILIO_WHATSAPP_ALERT_CONTENT_SID (and ..._OTP_CONTENT_SID) to your approved templates, each with one variable.
// Without them, plain text is sent, which only works inside the 24-hour window or in Twilio's sandbox.
export function twilio(env: Env = process.env): Messenger {
  requireVars(env, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], "Twilio");
  if (!/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID!)) throw new Error("TWILIO_ACCOUNT_SID does not look like an account SID");
  if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM && !env.TWILIO_WHATSAPP_FROM) {
    throw new Error("Twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID (SMS) and/or TWILIO_WHATSAPP_FROM");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
  const wa = (n: string) => (n.startsWith("whatsapp:") ? n : `whatsapp:${n}`);

  return {
    name: "twilio",
    async send({ kind, channel, toDigits, text, code }) {
      const params = new URLSearchParams();
      if (channel === "whatsapp") {
        if (!env.TWILIO_WHATSAPP_FROM) return { ok: false, error: "twilio whatsapp not configured" };
        params.set("To", wa(toE164(toDigits)));
        params.set("From", wa(env.TWILIO_WHATSAPP_FROM));
        const template = kind === "otp" ? env.TWILIO_WHATSAPP_OTP_CONTENT_SID : env.TWILIO_WHATSAPP_ALERT_CONTENT_SID;
        if (template) {
          params.set("ContentSid", template);
          params.set("ContentVariables", JSON.stringify({ "1": kind === "otp" ? (code ?? text) : text }));
        } else params.set("Body", text);
      } else {
        params.set("To", toE164(toDigits));
        if (env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
        else if (env.TWILIO_FROM) params.set("From", env.TWILIO_FROM);
        else return { ok: false, error: "twilio sms not configured" };
        params.set("Body", text);
      }
      try {
        const { status, body } = await postJson(url, {
          headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: auth },
          body: params.toString(),
        });
        if (status >= 200 && status < 300 && typeof body.sid === "string") return { ok: true, id: body.sid };
        return { ok: false, error: `twilio http ${status}${body.code ? ` code ${String(body.code)}` : ""}` };
      } catch (err) {
        return { ok: false, error: `twilio ${err instanceof Error ? err.name : "error"}` };
      }
    },
  };
}

// ---- Dry run: sends nothing ---------------------------------------------------------------------------------
/** Everything "sent" by the dry-run provider in this process. Used by tests. */
export const dryRunOutbox: (SendRequest & { at: string })[] = [];

/**
 * For development and staging. Nothing leaves the machine; the masked number and message are logged. Set
 * DRY_RUN_OUTBOX=/some/file to also append full messages (including codes) as JSON lines, for end-to-end tests.
 */
export function dryRun(env: Env = process.env): Messenger {
  return {
    name: "dry-run",
    async send(req) {
      dryRunOutbox.push({ ...req, at: new Date().toISOString() });
      if (env.DRY_RUN_OUTBOX) appendFileSync(env.DRY_RUN_OUTBOX, JSON.stringify({ ...req, at: new Date().toISOString() }) + "\n");
      console.info(`[dry-run] ${req.kind} via ${req.channel} to ${maskPhone(req.toDigits)}: ${req.kind === "otp" ? "(code hidden)" : req.text}`);
      return { ok: true, id: `dry-${dryRunOutbox.length}` };
    },
  };
}

export type ProviderName = Messenger["name"];

export function createMessenger(env: Env = process.env): Messenger {
  switch (env.SMS_PROVIDER) {
    case "termii":
      return termii(env);
    case "twilio":
      return twilio(env);
    case "dry-run":
      return dryRun(env);
    default:
      throw new Error("SMS_PROVIDER must be termii, twilio or dry-run");
  }
}
