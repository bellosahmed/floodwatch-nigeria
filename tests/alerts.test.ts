import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { CombinedFeed } from "../lib/combined";
import type { DayRisk } from "../lib/forecast";
import { alertMessage, gsmSafe, MAX_MESSAGE_CHARS, otpMessage } from "../lib/alerts/compose";
import { alertsConfig, type AlertsConfig } from "../lib/alerts/config";
import { decide, runAlerts, type Lookup } from "../lib/alerts/dispatch";
import { createLookup, nearTerm } from "../lib/alerts/lookup";
import { maskPhone, normalizeNigerianPhone } from "../lib/alerts/phone";
import { decryptPhone, encryptPhone, hashCode, hashPhone, newOtp, PiiKeyError } from "../lib/alerts/pii";
import { createMessenger, dryRun, dryRunOutbox, termii, twilio } from "../lib/alerts/providers";
import { confirmSubscription, startSubscription, unsubscribe } from "../lib/alerts/subscribe";
import { lgasOf } from "../lib/lgas";
import { createFileStore } from "../lib/store/file";
import type { Store } from "../lib/store";

const KEY = "ab".repeat(32);
const env0 = { ...process.env };
const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = KEY;
  dryRunOutbox.length = 0;
});
afterEach(() => {
  process.env = { ...env0 };
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------------------------------------------
describe("phone numbers", () => {
  it("accepts the ways people really type a Nigerian mobile number", () => {
    for (const v of ["08031234567", "8031234567", "+234 803 123 4567", "0803-123-4567", "2348031234567", "(0803) 123 4567", "+2348031234567"]) {
      assert.equal(normalizeNigerianPhone(v), "2348031234567", v);
    }
    assert.equal(normalizeNigerianPhone("07012345678"), "2347012345678");
    assert.equal(normalizeNigerianPhone("09112345678"), "2349112345678");
  });

  it("rejects anything that is not a Nigerian mobile number", () => {
    for (const v of ["", "12345", "abc", "0603123456", "060312345678", "+1 415 555 2671", "080312345678", "803123456", "0803 123 456 78 9", "+234 1 234 5678"]) {
      assert.equal(normalizeNigerianPhone(v), null, v);
    }
  });

  it("masks a number for display", () => {
    assert.equal(maskPhone("2348031234567"), "+234 80•• ••• 4567");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("encryption of phone numbers", () => {
  it("refuses to work without a proper key", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    assert.throws(() => encryptPhone("2348031234567"), PiiKeyError);
    process.env.PII_ENCRYPTION_KEY = "too-short";
    assert.throws(() => hashPhone("2348031234567"), PiiKeyError);
    process.env.PII_ENCRYPTION_KEY = "zz".repeat(32);
    assert.throws(() => hashPhone("2348031234567"), PiiKeyError);
  });

  it("round-trips, never repeats the same ciphertext, and hides the number", () => {
    const a = encryptPhone("2348031234567");
    const b = encryptPhone("2348031234567");
    assert.notEqual(a, b, "a fresh random IV every time");
    assert.equal(decryptPhone(a), "2348031234567");
    assert.ok(!a.includes("2348031234567") && !a.includes("8031234567"));
  });

  it("detects tampering and the wrong key", () => {
    const token = encryptPhone("2348031234567");
    const parts = token.split(".");
    const flipped = [...parts.slice(0, 3), (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1)].join(".");
    assert.throws(() => decryptPhone(flipped));
    assert.throws(() => decryptPhone("v2.x.y.z"));
    process.env.PII_ENCRYPTION_KEY = "cd".repeat(32);
    assert.throws(() => decryptPhone(token), "a different key cannot read it");
  });

  it("hashes numbers and codes with a key, and ties a code to its phone", () => {
    const h1 = hashPhone("2348031234567");
    assert.equal(h1, hashPhone("2348031234567"));
    assert.notEqual(h1, hashPhone("2348031234568"));
    assert.match(h1, /^[0-9a-f]{64}$/);
    process.env.PII_ENCRYPTION_KEY = "cd".repeat(32);
    assert.notEqual(h1, hashPhone("2348031234567"), "keyed: without the key it cannot be recomputed");
    process.env.PII_ENCRYPTION_KEY = KEY;
    const other = hashPhone("2348031234568");
    assert.notEqual(hashCode(h1, "123456"), hashCode(other, "123456"), "a code for one phone cannot confirm another");
  });

  it("makes six-digit codes", () => {
    const seen = new Set(Array.from({ length: 200 }, newOtp));
    for (const c of seen) assert.match(c, /^\d{6}$/);
    assert.ok(seen.size > 150, "not repeating");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("message text", () => {
  const base = { hazard: "flood" as const, level: 2 as const, areaName: "Rivers", stateSlug: "rivers", firstDate: "2026-10-21", todayIso: "2026-10-18", siteUrl: "https://floodwatch.example", unsubCode: "abcdefghij" };

  it("strips everything outside the basic SMS alphabet", () => {
    assert.equal(gsmSafe("Ọ̀rọ̀ 34°C ₦500 café [x] {y} <z>"), "Oro 34C 500 cafe x y z");
    assert.equal(gsmSafe("  many   spaces\n\tnewline "), "many spaces newline");
  });

  it("says what, where and when, and always carries the disclaimer and the stop link", () => {
    const m = alertMessage(base);
    assert.match(m, /^FloodWatch: HIGH flood risk in Rivers from Wed 21 Oct\./);
    assert.match(m, /Unofficial guidance/);
    assert.match(m, /https:\/\/floodwatch\.example\/state\/rivers/);
    assert.match(m, /Stop: https:\/\/floodwatch\.example\/u\/abcdefghij$/);
  });

  it("says 'now' when it is already happening or the date is today", () => {
    assert.match(alertMessage({ ...base, firstDate: null }), /in Rivers now\./);
    assert.match(alertMessage({ ...base, firstDate: "2026-10-18" }), /in Rivers now\./);
  });

  it("words the levels and links heat to the heat view", () => {
    assert.match(alertMessage({ ...base, level: 3 }), /SEVERE flood risk/);
    const heat = alertMessage({ ...base, hazard: "heat", level: 3 });
    assert.match(heat, /EXTREME heat/);
    assert.match(heat, /\/state\/rivers\?hazard=heat/);
    assert.match(alertMessage({ ...base, hazard: "heat" }), /DANGEROUS heat/);
  });

  it("stays plain ASCII and within two SMS segments, even for the longest real area names", () => {
    const names = lgasOf("rivers").concat(lgasOf("akwa-ibom"), lgasOf("cross-river")).map((l) => `${l.name}, Cross River`);
    names.push("A".repeat(200)); // a hostile or corrupt name
    for (const areaName of names) {
      for (const hazard of ["flood", "heat"] as const) {
        const m = alertMessage({ ...base, areaName, hazard, firstDate: "2026-10-24" });
        assert.ok(m.length <= MAX_MESSAGE_CHARS, `${areaName.slice(0, 30)}: ${m.length} chars`);
        assert.match(m, /^[\x20-\x7e]+$/, "plain ASCII only");
        assert.match(m, /Unofficial guidance/);
        assert.match(m, /Stop: https:\/\/floodwatch\.example\/u\/abcdefghij$/, "the stop link is never cut off");
      }
    }
  });

  it("puts the code in the verification message", () => {
    assert.match(otpMessage("123456"), /123456/);
    assert.match(otpMessage("123456"), /ignore it/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("providers", () => {
  const termiiEnv = { TERMII_API_KEY: "key-secret-123", TERMII_BASE_URL: "https://api.example-termii.test", TERMII_SENDER_ID: "FloodWatch" };
  const twilioEnv = { TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "token-secret", TWILIO_FROM: "+15005550006", TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886" };
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status });
  const capture = (response: () => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response();
    }) as typeof fetch;
    return calls;
  };
  const sms = { kind: "alert" as const, channel: "sms" as const, toDigits: "2348031234567", text: "hello there" };

  it("Termii: sends the documented request on the transactional (dnd) route", async () => {
    const calls = capture(() => reply(200, { code: "ok", message_id_str: "m-1", message: "Successfully Sent" }));
    const r = await termii(termiiEnv).send(sms);
    assert.deepEqual(r, { ok: true, id: "m-1" });
    assert.equal(calls[0].url, "https://api.example-termii.test/api/sms/send");
    assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      api_key: "key-secret-123", to: "2348031234567", from: "FloodWatch", sms: "hello there", type: "plain", channel: "dnd",
    });
  });

  it("Termii: the generic route is opt-in, and WhatsApp needs its own sender", async () => {
    const calls = capture(() => reply(200, { code: "ok" }));
    await termii({ ...termiiEnv, TERMII_SMS_CHANNEL: "generic" }).send(sms);
    assert.equal(JSON.parse(String(calls[0].init.body)).channel, "generic");

    const noWa = await termii(termiiEnv).send({ ...sms, channel: "whatsapp" });
    assert.deepEqual(noWa, { ok: false, error: "termii whatsapp not configured" });

    await termii({ ...termiiEnv, TERMII_WHATSAPP_FROM: "fwdevice" }).send({ ...sms, channel: "whatsapp" });
    const body = JSON.parse(String(calls[1].init.body));
    assert.equal(body.channel, "whatsapp");
    assert.equal(body.from, "fwdevice");
  });

  it("Termii: refuses bad configuration, and reports failures without leaking secrets, numbers or text", async () => {
    assert.throws(() => termii({}), /TERMII_API_KEY/);
    assert.throws(() => termii({ ...termiiEnv, TERMII_BASE_URL: "http://insecure.test" }), /https/);

    capture(() => reply(400, { code: "invalid", message: "bad number 2348031234567 key-secret-123" }));
    const bad = await termii(termiiEnv).send(sms);
    assert.equal(bad.ok, false);
    const text = JSON.stringify(bad);
    assert.ok(!text.includes("key-secret-123") && !text.includes("2348031234567") && !text.includes("hello there"), text);

    globalThis.fetch = (async () => { throw Object.assign(new Error("boom 2348031234567"), { name: "TimeoutError" }); }) as typeof fetch;
    const t = await termii(termiiEnv).send(sms);
    assert.deepEqual(t, { ok: false, error: "termii TimeoutError" });
  });

  it("Twilio: sends the documented request with basic auth", async () => {
    const calls = capture(() => reply(201, { sid: "SM123", status: "queued" }));
    const r = await twilio(twilioEnv).send(sms);
    assert.deepEqual(r, { ok: true, id: "SM123" });
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/AC${"1".repeat(32)}/Messages.json`);
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h.Authorization, "Basic " + Buffer.from(`AC${"1".repeat(32)}:token-secret`).toString("base64"));
    assert.equal(h["Content-Type"], "application/x-www-form-urlencoded");
    const p = new URLSearchParams(String(calls[0].init.body));
    assert.deepEqual([p.get("To"), p.get("From"), p.get("Body")], ["+2348031234567", "+15005550006", "hello there"]);
  });

  it("Twilio: messaging service, WhatsApp addressing and approved templates", async () => {
    const calls = capture(() => reply(201, { sid: "SM1" }));
    await twilio({ ...twilioEnv, TWILIO_MESSAGING_SERVICE_SID: "MG" + "2".repeat(32) }).send(sms);
    const sp = new URLSearchParams(String(calls[0].init.body));
    assert.equal(sp.get("MessagingServiceSid"), "MG" + "2".repeat(32));
    assert.equal(sp.get("From"), null);

    await twilio(twilioEnv).send({ ...sms, channel: "whatsapp" });
    const wp = new URLSearchParams(String(calls[1].init.body));
    assert.deepEqual([wp.get("To"), wp.get("From"), wp.get("Body")], ["whatsapp:+2348031234567", "whatsapp:+14155238886", "hello there"]);

    const tpl = { ...twilioEnv, TWILIO_WHATSAPP_ALERT_CONTENT_SID: "HX" + "3".repeat(32), TWILIO_WHATSAPP_OTP_CONTENT_SID: "HX" + "4".repeat(32) };
    await twilio(tpl).send({ ...sms, channel: "whatsapp" });
    const ap = new URLSearchParams(String(calls[2].init.body));
    assert.equal(ap.get("ContentSid"), "HX" + "3".repeat(32));
    assert.equal(ap.get("Body"), null);
    assert.deepEqual(JSON.parse(ap.get("ContentVariables")!), { "1": "hello there" });

    await twilio(tpl).send({ kind: "otp", channel: "whatsapp", toDigits: "2348031234567", text: "FloodWatch code: 123456...", code: "123456" });
    const op = new URLSearchParams(String(calls[3].init.body));
    assert.equal(op.get("ContentSid"), "HX" + "4".repeat(32));
    assert.deepEqual(JSON.parse(op.get("ContentVariables")!), { "1": "123456" }, "an OTP template receives just the code");
  });

  it("Twilio: refuses bad configuration and reports errors without secrets", async () => {
    assert.throws(() => twilio({}), /TWILIO_ACCOUNT_SID/);
    assert.throws(() => twilio({ ...twilioEnv, TWILIO_ACCOUNT_SID: "nope" }), /account SID/);
    assert.throws(() => twilio({ TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "x" }), /TWILIO_FROM/);

    capture(() => reply(400, { code: 21211, message: "invalid number +2348031234567" }));
    const bad = await twilio(twilioEnv).send(sms);
    assert.deepEqual(bad, { ok: false, error: "twilio http 400 code 21211" });
    const noWa = await twilio({ ...twilioEnv, TWILIO_WHATSAPP_FROM: undefined }).send({ ...sms, channel: "whatsapp" });
    assert.deepEqual(noWa, { ok: false, error: "twilio whatsapp not configured" });
  });

  it("dry-run sends nothing, records it, and keeps the full number out of the log", async () => {
    let network = 0;
    globalThis.fetch = (async () => { network++; return reply(200, {}); }) as typeof fetch;
    const logs: string[] = [];
    const realInfo = console.info;
    console.info = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      const r = await dryRun({}).send({ kind: "otp", channel: "sms", toDigits: "2348031234567", text: "FloodWatch code: 654321", code: "654321" });
      assert.equal(r.ok, true);
    } finally {
      console.info = realInfo;
    }
    assert.equal(network, 0);
    assert.equal(dryRunOutbox.length, 1);
    assert.ok(!logs.join("").includes("2348031234567") && !logs.join("").includes("654321"), logs.join(" | "));
  });

  it("picks the provider from SMS_PROVIDER", () => {
    assert.equal(createMessenger({ SMS_PROVIDER: "dry-run" }).name, "dry-run");
    assert.equal(createMessenger({ SMS_PROVIDER: "termii", ...termiiEnv }).name, "termii");
    assert.throws(() => createMessenger({ SMS_PROVIDER: "carrier-pigeon" }), /SMS_PROVIDER/);
    assert.throws(() => createMessenger({}), /SMS_PROVIDER/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("alerts configuration", () => {
  const good = { SMS_PROVIDER: "dry-run", SITE_ORIGIN: "https://floodwatch.example/" };

  it("stays off, with a reason, unless everything is present", () => {
    assert.match((alertsConfig({}) as { reason: string }).reason, /SMS_PROVIDER/);
    delete process.env.PII_ENCRYPTION_KEY;
    assert.match((alertsConfig(good) as { reason: string }).reason, /PII_ENCRYPTION_KEY/);
    process.env.PII_ENCRYPTION_KEY = KEY;
    assert.match((alertsConfig({ SMS_PROVIDER: "dry-run" }) as { reason: string }).reason, /SITE_ORIGIN/);
    assert.match((alertsConfig({ SMS_PROVIDER: "termii", SITE_ORIGIN: "https://x.test" }) as { reason: string }).reason, /TERMII/);
  });

  it("is not live by default, and has a sensible daily cap", () => {
    const c = alertsConfig(good) as Extract<AlertsConfig, { enabled: true }>;
    assert.equal(c.enabled, true);
    assert.equal(c.live, false, "no real alerts unless ALERTS_LIVE=true");
    assert.equal(c.siteUrl, "https://floodwatch.example", "no trailing slash");
    assert.equal(c.dailyCap, 300);
    assert.equal((alertsConfig({ ...good, ALERTS_LIVE: "true", SMS_DAILY_CAP: "50" }) as typeof c).live, true);
    assert.equal((alertsConfig({ ...good, SMS_DAILY_CAP: "50" }) as typeof c).dailyCap, 50);
    assert.equal((alertsConfig({ ...good, SMS_DAILY_CAP: "-5" }) as typeof c).dailyCap, 300);
    assert.equal((alertsConfig({ ...good, ALERTS_LIVE: "yes" }) as typeof c).live, false, "only the exact word true");
  });
});

// ---------------------------------------------------------------------------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), "fw-alerts-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const cfg = (over: Partial<Extract<AlertsConfig, { enabled: true }>> = {}): Extract<AlertsConfig, { enabled: true }> => ({
  enabled: true, messenger: dryRun({}), siteUrl: "https://floodwatch.example", live: true, dailyCap: 300, ...over,
});
let n = 0;
const newStore = () => createFileStore(path.join(dir, `s${n++}.json`));
const lastCode = () => (dryRunOutbox.filter((m) => m.kind === "otp").at(-1)?.code ?? "");
const rivers = lgasOf("rivers")[0];
const request = (over: Record<string, unknown> = {}) => ({ phone: "08031234567", channel: "sms", state: "lagos", hazard: "flood", minLevel: 2, consent: true, ...over });

describe("signing up and confirming", () => {
  let store: Store;
  before(() => void 0);
  beforeEach(() => {
    store = newStore();
  });

  it("requires consent, a real number, a real place and a High/Severe level", async () => {
    const ctx = { store, config: cfg() };
    for (const [over, status] of [
      [{ consent: false }, 400], [{ consent: undefined }, 400], [{ phone: "12345" }, 400], [{ channel: "pigeon" }, 400],
      [{ state: "narnia" }, 400], [{ lga: rivers.slug }, 400], [{ hazard: "storm" }, 400], [{ minLevel: 1 }, 400], [{ minLevel: 5 }, 400],
    ] as [Record<string, unknown>, number][]) {
      const r = await startSubscription(request(over), ctx);
      assert.deepEqual([r.ok, !r.ok && r.status], [false, status], JSON.stringify(over));
    }
    assert.equal(dryRunOutbox.length, 0, "nothing is sent for a bad request");
  });

  it("sends a code to the normalised number, and never stores the number in the clear", async () => {
    const file = path.join(dir, "clear.json");
    const s = createFileStore(file);
    const r = await startSubscription(request({ phone: "+234 803 123 4567" }), { store: s, config: cfg() });
    assert.equal(r.ok, true);
    assert.equal(dryRunOutbox.length, 1);
    assert.deepEqual([dryRunOutbox[0].toDigits, dryRunOutbox[0].kind, dryRunOutbox[0].channel], ["2348031234567", "otp", "sms"]);
    assert.match(lastCode(), /^\d{6}$/);
    const raw = readFileSync(file, "utf8");
    assert.ok(!raw.includes("2348031234567") && !raw.includes("8031234567"), "the number is not in the database file");
    assert.ok(!raw.includes(`"${lastCode()}"`), "the code itself is not stored, only its hash");
    assert.ok(raw.includes('"phoneEnc":"v1.'));
  });

  it("confirms with the right code, then alerts become possible", async () => {
    const ctx = { store, config: cfg() };
    await startSubscription(request(), ctx);
    const wrong = await confirmSubscription({ phone: "08031234567", channel: "sms", code: "000000" }, ctx);
    assert.deepEqual([wrong.ok, !wrong.ok && wrong.status], [false, 400]);
    assert.equal((await store.listConfirmedSubscriptions()).length, 0);

    const ok = await confirmSubscription({ phone: "0803 123 4567", channel: "sms", code: lastCode().replace(/(\d{3})(\d{3})/, "$1 $2") }, ctx);
    assert.deepEqual(ok, { ok: true, confirmed: 1 });
    const [sub] = await store.listConfirmedSubscriptions();
    assert.equal(decryptPhone(sub.phoneEnc), "2348031234567");
    assert.equal(sub.minLevel, 2);

    const again = await confirmSubscription({ phone: "08031234567", channel: "sms", code: lastCode() }, ctx);
    assert.equal(again.ok, false, "a code works once");
  });

  it("flood and heat together need one code, and make two subscriptions", async () => {
    const ctx = { store, config: cfg() };
    await startSubscription(request({ hazard: "both", state: "kano" }), ctx);
    assert.equal(dryRunOutbox.length, 1, "one message, not two");
    const r = await confirmSubscription({ phone: "08031234567", channel: "sms", code: lastCode() }, ctx);
    assert.deepEqual(r, { ok: true, confirmed: 2 });
    assert.deepEqual((await store.listConfirmedSubscriptions()).map((s) => s.hazard).sort(), ["flood", "heat"]);
  });

  it("locks out guessing after five wrong codes", async () => {
    const ctx = { store, config: cfg() };
    await startSubscription(request(), ctx);
    const right = lastCode();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await confirmSubscription({ phone: "08031234567", channel: "sms", code: right === "111111" ? "222222" : "111111" }, ctx);
      statuses.push(!r.ok ? r.status : 200);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    const late = await confirmSubscription({ phone: "08031234567", channel: "sms", code: right }, ctx);
    assert.deepEqual([late.ok, !late.ok && late.status], [false, 429], "even the right code is refused once locked");
  });

  it("rejects an expired code", async () => {
    let now = Date.now();
    const ctx = { store, config: cfg(), now: () => now };
    await startSubscription(request(), ctx);
    now += 11 * 60_000;
    const r = await confirmSubscription({ phone: "08031234567", channel: "sms", code: lastCode() }, ctx);
    assert.deepEqual([r.ok, !r.ok && r.status], [false, 400]);
  });

  it("limits codes per number, so the form cannot be used to spam one person or run up the bill", async () => {
    const ctx = { store, config: cfg() };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await startSubscription(request(), ctx));
    assert.deepEqual(results.map((r) => (r.ok ? 200 : r.status)), [200, 200, 200, 429, 429]);
    assert.equal(dryRunOutbox.length, 3, "only three messages were ever sent");
    const other = await startSubscription(request({ phone: "08099999999" }), ctx);
    assert.equal(other.ok, true, "a different number is unaffected");
  });

  it("stops everything when the daily message cap is reached", async () => {
    const ctx = { store, config: cfg({ dailyCap: 2 }) };
    const phones = ["08031111111", "08032222222", "08033333333"];
    const results = [];
    for (const phone of phones) results.push(await startSubscription(request({ phone }), ctx));
    assert.deepEqual(results.map((r) => (r.ok ? 200 : r.status)), [200, 200, 503]);
    assert.equal(dryRunOutbox.length, 2);
  });

  it("answers the same, and sends nothing, for a number that is already subscribed", async () => {
    const ctx = { store, config: cfg() };
    await startSubscription(request(), ctx);
    await confirmSubscription({ phone: "08031234567", channel: "sms", code: lastCode() }, ctx);
    const before = dryRunOutbox.length;
    const again = await startSubscription(request({ minLevel: 3 }), ctx);
    assert.deepEqual(again, { ok: true });
    assert.equal(dryRunOutbox.length, before, "no message, so the form cannot reveal who is subscribed");
    assert.equal((await store.listConfirmedSubscriptions())[0].minLevel, 2, "and nothing was changed");
  });

  it("reports a failed delivery plainly, without exposing the provider's error", async () => {
    const failing = { ...cfg(), messenger: { name: "dry-run" as const, send: async () => ({ ok: false as const, error: "twilio http 400 code 21211" }) } };
    const realErr = console.error;
    console.error = () => undefined;
    try {
      const r = await startSubscription(request(), { store, config: failing });
      assert.deepEqual([r.ok, !r.ok && r.status], [false, 502]);
      assert.ok(!JSON.stringify(r).includes("21211"));
    } finally {
      console.error = realErr;
    }
  });

  it("stops alerts from a link, for every subscription of that number", async () => {
    const ctx = { store, config: cfg() };
    await startSubscription(request({ hazard: "both" }), ctx);
    await confirmSubscription({ phone: "08031234567", channel: "sms", code: lastCode() }, ctx);
    const [first] = await store.listConfirmedSubscriptions();
    assert.deepEqual(await unsubscribe(first.unsubCode, store), { ok: true, removed: 2 });
    assert.equal((await store.listConfirmedSubscriptions()).length, 0);
    assert.deepEqual(await unsubscribe(first.unsubCode, store), { ok: true, removed: 0 }, "safe to open twice");
    for (const bad of ["", "short", "has spaces!!", "x".repeat(11), "../../etc"]) {
      const r = await unsubscribe(bad, store);
      assert.equal(r.ok, false, bad);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("deciding who gets an alert", () => {
  it("alerts once per episode, again only if it gets worse, and starts fresh after it passes", () => {
    const sub = (min: 2 | 3, last: number) => ({ minLevel: min, lastAlertLevel: last });
    assert.equal(decide(sub(2, 0), 0), "none");
    assert.equal(decide(sub(2, 0), 1), "none", "Watch is below the person's level");
    assert.equal(decide(sub(2, 0), 2), "send", "first time at their level");
    assert.equal(decide(sub(2, 2), 2), "none", "already told");
    assert.equal(decide(sub(2, 2), 3), "send", "it got worse");
    assert.equal(decide(sub(2, 3), 2), "none", "easing: no second message");
    assert.equal(decide(sub(2, 3), 1), "end-episode", "it has passed");
    assert.equal(decide(sub(3, 0), 2), "none", "Severe-only subscribers ignore High");
    assert.equal(decide(sub(3, 0), 3), "send");
  });
});

describe("running the alert job", () => {
  const today = "2026-10-18";
  const subscribe = async (store: Store, phone: string, over: Record<string, unknown> = {}, config = cfg()) => {
    await startSubscription(request({ phone, ...over }), { store, config });
    await confirmSubscription({ phone, channel: (over.channel as string) ?? "sms", code: lastCode() }, { store, config });
  };
  const run = (store: Store, level: number, over: { live?: boolean; dailyCap?: number; nowMs?: number; reading?: Partial<ReturnType<Lookup> extends Promise<infer R> ? NonNullable<R> : never> } = {}) =>
    runAlerts({
      store,
      config: cfg({ live: over.live ?? true, dailyCap: over.dailyCap ?? 300 }),
      lookup: async () => ({ level: level as 0 | 1 | 2 | 3, firstDate: "2026-10-20", areaName: "Lagos", ...over.reading }),
      todayIso: today,
      nowMs: over.nowMs ?? Date.now(),
    });
  const alerts = () => dryRunOutbox.filter((m) => m.kind === "alert");

  it("does nothing but report when live sending is off, and changes no state", async () => {
    const store = newStore();
    await subscribe(store, "08031234567");
    dryRunOutbox.length = 0;
    const s = await run(store, 3, { live: false });
    assert.deepEqual([s.live, s.wouldSend, s.sent], [false, 1, 0]);
    assert.equal(alerts().length, 0);
    assert.equal((await store.listConfirmedSubscriptions())[0].lastAlertLevel, 0);
  });

  it("sends the alert to the right number and channel, with a working stop link, once", async () => {
    const store = newStore();
    await subscribe(store, "08031234567", { state: "rivers" });
    dryRunOutbox.length = 0;
    const [sub] = await store.listConfirmedSubscriptions();

    const first = await run(store, 3);
    assert.deepEqual([first.sent, first.failed], [1, 0]);
    assert.equal(alerts().length, 1);
    assert.deepEqual([alerts()[0].toDigits, alerts()[0].channel], ["2348031234567", "sms"]);
    assert.match(alerts()[0].text, /SEVERE flood risk in Lagos from Tue 20 Oct/);
    assert.ok(alerts()[0].text.endsWith(`/u/${sub.unsubCode}`));
    assert.equal((await store.listConfirmedSubscriptions())[0].lastAlertLevel, 3);

    const second = await run(store, 3);
    assert.equal(second.sent, 0, "the same episode does not message again");
    assert.equal(alerts().length, 1);
  });

  it("messages again when it gets worse, and treats a later return as a new episode", async () => {
    const store = newStore();
    await subscribe(store, "08031234567");
    dryRunOutbox.length = 0;
    await run(store, 2);
    assert.equal(alerts().length, 1);
    await run(store, 3);
    assert.equal(alerts().length, 2, "High then Severe");
    const passed = await run(store, 0);
    assert.equal(passed.endedEpisodes, 1);
    assert.equal(alerts().length, 2);
    await run(store, 2);
    assert.equal(alerts().length, 3, "a new episode");
  });

  it("undoes its claim when delivery fails, so the next run tries again", async () => {
    const store = newStore();
    await subscribe(store, "08031234567");
    dryRunOutbox.length = 0;
    const realErr = console.error;
    console.error = () => undefined;
    try {
      const failing = cfg({ messenger: { name: "dry-run", send: async () => ({ ok: false, error: "twilio http 500" }) } });
      const lookup: Lookup = async () => ({ level: 3, firstDate: null, areaName: "Lagos" });
      const s = await runAlerts({ store, config: failing, lookup, todayIso: today, nowMs: Date.now() });
      assert.deepEqual([s.sent, s.failed], [0, 1]);
      assert.equal((await store.listConfirmedSubscriptions())[0].lastAlertLevel, 0, "not marked as alerted");
    } finally {
      console.error = realErr;
    }
    const retry = await run(store, 3);
    assert.equal(retry.sent, 1);
  });

  it("spends a limited daily budget on the most dangerous cases first", async () => {
    const store = newStore();
    const phones = ["08031111111", "08032222222", "08033333333"];
    for (const [i, p] of phones.entries()) await subscribe(store, p, { state: ["lagos", "kano", "oyo"][i] });
    dryRunOutbox.length = 0;
    const sent = await store.countSends({ sinceMs: 0 }); // the 3 sign-up codes already count against the cap
    const levels: Record<string, number> = { lagos: 2, kano: 3, oyo: 2 };
    const s = await runAlerts({
      store,
      config: cfg({ dailyCap: sent + 1 }),
      lookup: async (sub) => ({ level: levels[sub.state] as 2 | 3, firstDate: null, areaName: sub.state }),
      todayIso: today,
      nowMs: Date.now(),
    });
    assert.deepEqual([s.sent, s.capped], [1, 2]);
    assert.match(alerts()[0].text, /SEVERE flood risk in kano/, "the person in the worst danger was messaged first");
  });

  it("skips people it has no forecast for, and uses each person's own channel", async () => {
    const store = newStore();
    await subscribe(store, "08031234567");
    await subscribe(store, "08037654321", { channel: "whatsapp" });
    dryRunOutbox.length = 0;
    const none = await runAlerts({ store, config: cfg(), lookup: async () => null, todayIso: today, nowMs: Date.now() });
    assert.deepEqual([none.noData, none.sent], [2, 0]);
    await run(store, 2);
    assert.deepEqual(alerts().map((m) => m.channel).sort(), ["sms", "whatsapp"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("reading the forecast for a subscriber", () => {
  const day = (date: string, level: number, heatLevel = 0, phase: DayRisk["phase"] = "future"): DayRisk => ({
    date, phase, rainMm: 0, level: level as 0 | 1 | 2 | 3, riverRatio: null, tmaxC: null, feelsC: null, heatLevel: heatLevel as 0 | 1 | 2 | 3, heatwave: false, confidence: "high",
  });

  it("looks only a few days ahead, ignores the past, and finds the first day at the person's level", () => {
    const days = [day("2026-10-10", 3, 0, "past"), day("2026-10-18", 0, 0, "today"), day("2026-10-19", 1), day("2026-10-20", 2), day("2026-10-21", 0), day("2026-10-22", 3)];
    assert.deepEqual(nearTerm(days, "flood", 2), { level: 2, firstDate: "2026-10-20" });
    assert.deepEqual(nearTerm(days, "flood", 3), { level: 2, firstDate: null }, "the Severe on day 5 is out of range, and not Severe within 3 days");
    assert.deepEqual(nearTerm([day("2026-10-18", 0, 3, "today")], "heat", 2), { level: 3, firstDate: "2026-10-18" });
  });

  const feed = (over: object = {}): CombinedFeed =>
    ({
      locations: [{
        slug: "rivers", level: 1,
        ground: { level: 0 },
        forecast: { days: [day("2026-10-18", 0, 0, "today"), day("2026-10-19", 1, 2), day("2026-10-20", 2, 3), day("2026-10-25", 3)] },
        ...over,
      }],
    }) as unknown as CombinedFeed;
  const sub = (over: object = {}) => ({ id: "x", state: "rivers", hazard: "flood", minLevel: 2, ...over }) as Parameters<Lookup>[0];

  it("uses the short-range forecast for a state, ignoring a storm a week away", async () => {
    const look = createLookup({ feed: feed(), getLga: async () => [] });
    assert.deepEqual(await look(sub()), { level: 2, firstDate: "2026-10-20", areaName: "Rivers" });
  });

  it("uses the combined level, and says 'now', once people on the ground confirm flooding", async () => {
    const look = createLookup({ feed: feed({ level: 3, ground: { level: 2 } }), getLga: async () => [] });
    assert.deepEqual(await look(sub()), { level: 3, firstDate: null, areaName: "Rivers" });
  });

  it("reads heat separately from flood", async () => {
    const look = createLookup({ feed: feed(), getLga: async () => [] });
    assert.deepEqual(await look(sub({ hazard: "heat" })), { level: 3, firstDate: "2026-10-19", areaName: "Rivers" });
  });

  it("uses a local government's own outlook and names it with its state, fetching each state only once", async () => {
    let fetched = 0;
    const l = rivers;
    const look = createLookup({
      feed: feed(),
      getLga: async () => { fetched++; return [{ slug: l.slug, name: l.name, rain16Mm: 0, flood: {}, heat: {}, days: [day("2026-10-18", 0, 0, "today"), day("2026-10-19", 3)] } as never]; },
    });
    const r = await look(sub({ lga: l.slug }));
    assert.deepEqual(r, { level: 3, firstDate: "2026-10-19", areaName: `${l.name}, Rivers` });
    await look(sub({ lga: l.slug, hazard: "heat" }));
    assert.equal(fetched, 1);
  });

  it("lets people reporting in an LGA raise that LGA's alert, and says it is happening now", async () => {
    const l = rivers;
    const lgaRow = { slug: l.slug, name: l.name, rain16Mm: 0, flood: {}, heat: {}, days: [day("2026-10-18", 0, 0, "today"), day("2026-10-19", 0)] } as never;
    const look = createLookup({ feed: feed(), getLga: async () => [lgaRow], lgaGround: new Map([[l.slug, 2 as const]]) });
    assert.deepEqual(await look(sub({ lga: l.slug })), { level: 2, firstDate: null, areaName: `${l.name}, Rivers` });
    assert.equal((await look(sub({ lga: l.slug, hazard: "heat" })))?.level, 0, "reports are about flooding, not heat");
  });

  it("survives a failed LGA forecast: uses reports if there are any, and never throws", async () => {
    const l = rivers;
    const broken = createLookup({ feed: feed(), getLga: async () => { throw new Error("weather source down"); }, lgaGround: new Map([[l.slug, 3 as const]]) });
    assert.deepEqual(await broken(sub({ lga: l.slug })), { level: 3, firstDate: null, areaName: `${l.name}, Rivers` });
    const quiet = createLookup({ feed: feed(), getLga: async () => { throw new Error("down"); } });
    assert.equal(await quiet(sub({ lga: l.slug })), null);
  });

  it("returns nothing when there is no data to judge by", async () => {
    const none = createLookup({ feed: feed({ forecast: null }), getLga: async () => [] });
    assert.equal(await none(sub()), null);
    assert.equal(await none(sub({ hazard: "heat" })), null);
    const groundOnly = createLookup({ feed: feed({ forecast: null, ground: { level: 2 } }), getLga: async () => [] });
    assert.deepEqual(await groundOnly(sub()), { level: 2, firstDate: null, areaName: "Rivers" });
    const unknownLga = createLookup({ feed: feed(), getLga: async () => [] });
    assert.equal(await unknownLga(sub({ lga: "rivers-nowhere" })), null);
  });
});
