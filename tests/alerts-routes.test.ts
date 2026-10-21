import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createSessionToken, readCookie, verifySessionToken } from "../lib/admin/session";

// Real route handlers, a throwaway file store, the dry-run provider, and no network (the weather source is
// made unreachable, which is exactly the "forecast down" case the alert job must survive).
const dir = mkdtempSync(path.join(tmpdir(), "fw-aroutes-"));
const ADMIN = "m".repeat(40);
const CRON = "c".repeat(40);
const HOST = "floodwatch.example";
const ORIGIN = `https://${HOST}`;

type H = (req: Request) => Promise<Response> | Response;
let subscribe: { POST: H }, confirm: { POST: H }, unsub: { POST: H }, cron: { GET: H };
let session: { GET: H; POST: H; DELETE: H }, adminReports: { GET: H; POST: H }, stats: { GET: H };
let store: typeof import("../lib/store");
let outbox: typeof import("../lib/alerts/providers").dryRunOutbox;

const realFetch = globalThis.fetch;
before(async () => {
  Object.assign(process.env, {
    FLOODWATCH_DB: path.join(dir, "db.json"), SMS_PROVIDER: "dry-run", SITE_ORIGIN: ORIGIN, ADMIN_API_KEY: ADMIN, CRON_SECRET: CRON,
    PII_ENCRYPTION_KEY: "ab".repeat(32), SMS_DAILY_CAP: "100",
  });
  delete process.env.DATABASE_URL;
  delete process.env.ALERTS_LIVE;
  delete process.env.TURNSTILE_SECRET;
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch; // weather source down
  const imp = <T,>(p: string) => import(p) as Promise<T>;
  [subscribe, confirm, unsub, cron, session, adminReports, stats, store] = (await Promise.all([
    imp("../app/api/alerts/subscribe/route"), imp("../app/api/alerts/confirm/route"), imp("../app/api/alerts/unsubscribe/route"),
    imp("../app/api/cron/alerts/route"), imp("../app/api/admin/session/route"), imp("../app/api/admin/reports/route"),
    imp("../app/api/admin/stats/route"), imp("../lib/store"),
  ])) as unknown as [{ POST: H }, { POST: H }, { POST: H }, { GET: H }, { GET: H; POST: H; DELETE: H }, { GET: H; POST: H }, { GET: H }, typeof import("../lib/store")];
  outbox = (await import("../lib/alerts/providers")).dryRunOutbox;
});
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

let ipN = 0;
const nextIp = () => `203.0.113.${++ipN}`;
const jsonReq = (url: string, body: object, headers: Record<string, string> = {}, method = "POST") =>
  new Request(`${ORIGIN}${url}`, { method, headers: { "content-type": "application/json", host: HOST, "x-forwarded-for": nextIp(), ...headers }, body: JSON.stringify(body) });
const lastOtp = () => outbox.filter((m) => m.kind === "otp").at(-1)?.code ?? "";
const signup = (over: object = {}) => ({ phone: "08031234567", channel: "sms", state: "lagos", hazard: "flood", minLevel: 2, consent: true, ...over });

describe("alert sign-up endpoints", () => {
  it("subscribes, sends a code, and confirms", async () => {
    const res = await subscribe.POST(jsonReq("/api/alerts/subscribe", signup()));
    assert.equal(res.status, 200);
    assert.match(lastOtp(), /^\d{6}$/);

    const bad = await confirm.POST(jsonReq("/api/alerts/confirm", { phone: "08031234567", channel: "sms", code: "000000" }));
    assert.equal(bad.status, 400);
    const ok = await confirm.POST(jsonReq("/api/alerts/confirm", { phone: "08031234567", channel: "sms", code: lastOtp() }));
    assert.equal(ok.status, 200);
    assert.equal((await store.getStore().then((s) => s.listConfirmedSubscriptions())).length, 1);
  });

  it("refuses other websites, wrong content types and oversized or broken bodies", async () => {
    const cross = await subscribe.POST(jsonReq("/api/alerts/subscribe", signup(), { origin: "https://evil.example" }));
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get("connection"), "close");
    assert.equal((await subscribe.POST(jsonReq("/api/alerts/subscribe", signup(), { "content-type": "text/plain" }))).status, 415);
    const huge = await subscribe.POST(new Request(`${ORIGIN}/api/alerts/subscribe`, { method: "POST", headers: { "content-type": "application/json", host: HOST, "x-forwarded-for": nextIp() }, body: JSON.stringify({ junk: "x".repeat(20000) }) }));
    assert.equal(huge.status, 400);
    const broken = await subscribe.POST(new Request(`${ORIGIN}/api/alerts/subscribe`, { method: "POST", headers: { "content-type": "application/json", host: HOST, "x-forwarded-for": nextIp() }, body: "{nope" }));
    assert.equal(broken.status, 400);
  });

  it("validates input and explains problems in plain words", async () => {
    const r = await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ phone: "12345" })));
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /Nigerian mobile number/);
    assert.equal((await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ consent: false })))).status, 400);
  });

  it("slows a network that keeps trying", async () => {
    const same = "198.51.100.200";
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ phone: `0803${1000000 + i}` }), { "x-forwarded-for": same }))).status);
    assert.deepEqual(statuses.slice(0, 5).every((s) => s === 200), true);
    assert.deepEqual(statuses.slice(5), [429, 429]);
  });

  it("stops alerts from the link, and rejects nonsense codes", async () => {
    await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ phone: "08035550001" })));
    await confirm.POST(jsonReq("/api/alerts/confirm", { phone: "08035550001", channel: "sms", code: lastOtp() }));
    const s = await store.getStore();
    const mine = (await s.listConfirmedSubscriptions()).find((x) => x.state === "lagos" && x.phoneHash !== "")!;
    const before = (await s.listConfirmedSubscriptions()).length;
    assert.equal((await unsub.POST(jsonReq("/api/alerts/unsubscribe", { code: "nope" }))).status, 400);
    assert.equal((await unsub.POST(jsonReq("/api/alerts/unsubscribe", { code: mine.unsubCode }))).status, 200);
    assert.ok((await s.listConfirmedSubscriptions()).length < before);
  });

  it("is switched off, and says so, when not configured", async () => {
    const saved = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;
    try {
      const res = await subscribe.POST(jsonReq("/api/alerts/subscribe", signup()));
      assert.equal(res.status, 404);
    } finally {
      process.env.SMS_PROVIDER = saved;
    }
  });
});

describe("the alert job", () => {
  const call = (key: string | null) =>
    cron.GET(new Request(`${ORIGIN}/api/cron/alerts`, { headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "x-forwarded-for": nextIp() } }));

  it("needs the cron secret", async () => {
    assert.equal((await call(null)).status, 401);
    assert.equal((await call("wrong".repeat(10))).status, 401);
  });

  it("with the forecast down, still alerts on confirmed ground reports, only reports first, then sends once when live", async () => {
    const s = await store.getStore();
    // make Kano dangerous on the ground: two different devices report "dangerous"
    for (const d of ["a", "b"]) await s.addReport({ state: "kano", area: "Market road", severity: 2, note: "", device: `alert-job-${d}` });
    await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ phone: "08036660001", state: "kano" })));
    await confirm.POST(jsonReq("/api/alerts/confirm", { phone: "08036660001", channel: "sms", code: lastOtp() }));
    outbox.length = 0;

    // not live: reports what it would do, sends nothing, changes nothing
    const dry = (await (await call(CRON)).json()) as { live: boolean; wouldSend: number; sent: number };
    assert.deepEqual([dry.live, dry.sent], [false, 0]);
    assert.ok(dry.wouldSend >= 1);
    assert.equal(outbox.filter((m) => m.kind === "alert").length, 0);

    process.env.ALERTS_LIVE = "true";
    try {
      const live = (await (await call(CRON)).json()) as { live: boolean; sent: number };
      assert.deepEqual([live.live, live.sent >= 1], [true, true]);
      const alerts = outbox.filter((m) => m.kind === "alert");
      assert.ok(alerts.some((m) => m.toDigits === "2348036660001" && /HIGH flood risk in Kano now/.test(m.text) && /Unofficial guidance/.test(m.text)));
      const count = alerts.length;
      const again = (await (await call(CRON)).json()) as { sent: number };
      assert.equal(again.sent, 0, "the same episode is not repeated");
      assert.equal(outbox.filter((m) => m.kind === "alert").length, count);
    } finally {
      delete process.env.ALERTS_LIVE;
    }
  });

  it("alerts a local-government subscriber when two people report dangerous flooding in that LGA", async () => {
    const { lgasOf } = await import("../lib/lgas");
    const lga = lgasOf("oyo")[1];
    const s = await store.getStore();
    await subscribe.POST(jsonReq("/api/alerts/subscribe", signup({ phone: "08037770001", state: "oyo", lga: lga.slug })));
    await confirm.POST(jsonReq("/api/alerts/confirm", { phone: "08037770001", channel: "sms", code: lastOtp() }));
    for (const d of ["x", "y"]) await s.addReport({ state: "oyo", lga: lga.slug, area: "Near the river", severity: 2, note: "", device: `lga-alert-${d}` });
    outbox.length = 0;
    process.env.ALERTS_LIVE = "true";
    try {
      const run = (await (await call(CRON)).json()) as { sent: number };
      assert.ok(run.sent >= 1);
      const msg = outbox.find((m) => m.kind === "alert" && m.toDigits === "2348037770001");
      assert.ok(msg, "the LGA subscriber was messaged");
      assert.ok(msg.text.includes(`HIGH flood risk in ${lga.name}, Oyo now`), msg.text);
    } finally {
      delete process.env.ALERTS_LIVE;
    }
  });

  it("skips quietly when alerts are not configured", async () => {
    const saved = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;
    try {
      const body = (await (await call(CRON)).json()) as { skipped?: string };
      assert.match(body.skipped ?? "", /SMS_PROVIDER/);
    } finally {
      process.env.SMS_PROVIDER = saved;
    }
  });
});

describe("moderator sessions", () => {
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
  const adminReq = (method: string, url: string, headers: Record<string, string> = {}, body?: object) =>
    new Request(`${ORIGIN}${url}`, { method, headers: { host: HOST, "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers }, body: body ? JSON.stringify(body) : undefined });

  it("signs in with the key, and sets a cookie that scripts cannot read and other sites cannot send", async () => {
    const wrong = await session.POST(adminReq("POST", "/api/admin/session", {}, { key: "wrong-key-wrong-key-wrong-key-xx" }));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);

    const res = await session.POST(adminReq("POST", "/api/admin/session", {}, { key: ADMIN }));
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie")!;
    assert.match(setCookie, /^fw_admin=\d+\./);
    for (const attr of ["HttpOnly", "SameSite=Strict", "Path=/api/admin", "Max-Age=28800"]) assert.ok(setCookie.includes(attr), attr);
    assert.ok(!setCookie.includes(ADMIN), "the key is never in the cookie");
  });

  it("recognises a signed-in moderator, and signs out", async () => {
    const cookie = cookieOf(await session.POST(adminReq("POST", "/api/admin/session", {}, { key: ADMIN })));
    assert.deepEqual(await (await session.GET(adminReq("GET", "/api/admin/session", { cookie }))).json(), { authenticated: true });
    assert.deepEqual(await (await session.GET(adminReq("GET", "/api/admin/session"))).json(), { authenticated: false });
    const out = await session.DELETE(adminReq("DELETE", "/api/admin/session", { cookie }));
    assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
  });

  it("lets a signed-in moderator list and hide reports, but not from another website", async () => {
    const cookie = cookieOf(await session.POST(adminReq("POST", "/api/admin/session", {}, { key: ADMIN })));
    const s = await store.getStore();
    const r = await s.addReport({ state: "oyo", area: "Spam place", severity: 1, note: "", device: "mod-test-device" });
    assert.ok(r.ok);

    const list = (await (await adminReports.GET(adminReq("GET", "/api/admin/reports?state=oyo", { cookie }))).json()) as { reports: { id: string; area: string }[] };
    assert.ok(list.reports.some((x) => x.id === r.report.id));

    const cross = await adminReports.POST(adminReq("POST", "/api/admin/reports", { cookie, origin: "https://evil.example" }, { id: r.report.id }));
    assert.equal(cross.status, 403, "a cookie alone must not let another site act for the moderator");

    const ok = await adminReports.POST(adminReq("POST", "/api/admin/reports", { cookie, origin: ORIGIN }, { id: r.report.id }));
    assert.equal(ok.status, 200);
    assert.ok(!(await s.reportsSince(0)).some((x) => x.id === r.report.id), "hidden from the public");
  });

  it("refuses expired, forged and tampered cookies, and no credentials at all", async () => {
    const good = cookieOf(await session.POST(adminReq("POST", "/api/admin/session", {}, { key: ADMIN })));
    const [name, value] = good.split("=");
    const [exp, mac] = value.split(".");
    const forged = [`${name}=${exp}.${"A".repeat(mac.length)}`, `${name}=${Number(exp) + 99999}.${mac}`, `${name}=${Math.floor(Date.now() / 1000) - 5}.${mac}`, `${name}=garbage`, `${name}=`];
    for (const cookie of forged) assert.equal((await adminReports.GET(adminReq("GET", "/api/admin/reports", { cookie }))).status, 401, cookie);
    assert.equal((await adminReports.GET(adminReq("GET", "/api/admin/reports"))).status, 401);
  });

  it("shows service counts without any phone number", async () => {
    const res = await stats.GET(adminReq("GET", "/api/admin/stats", { "x-api-key": ADMIN }));
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as { subscribers: { confirmed: number }; alerts: { enabled: boolean; provider: string; live: boolean } };
    assert.ok(body.subscribers.confirmed >= 1);
    assert.deepEqual([body.alerts.enabled, body.alerts.provider, body.alerts.live], [true, "dry-run", false]);
    assert.ok(!/\d{10,}/.test(text) && !text.includes("phoneEnc") && !text.includes("v1."), "no numbers or encrypted values");
    assert.equal((await stats.GET(adminReq("GET", "/api/admin/stats"))).status, 401);
  });
});

describe("session tokens", () => {
  const secret = "s".repeat(32);
  it("verify only while valid, only for their own key, and not when altered", () => {
    const now = 1_700_000_000_000;
    const t = createSessionToken(secret, now, 60);
    assert.ok(verifySessionToken(secret, t, now + 59_000));
    assert.equal(verifySessionToken(secret, t, now + 61_000), false, "expired");
    assert.equal(verifySessionToken("x".repeat(32), t, now), false, "another key (so rotating the key signs everyone out)");
    const [exp, mac] = t.split(".");
    assert.equal(verifySessionToken(secret, `${Number(exp) + 1000}.${mac}`, now), false);
    assert.equal(verifySessionToken(secret, null), false);
    assert.equal(verifySessionToken(secret, "no-dot"), false);
    assert.equal(verifySessionToken(secret, "abc.def"), false);
  });

  it("reads a named cookie from a header", () => {
    const req = new Request("https://x.test/", { headers: { cookie: "a=1; fw_admin=123.abc=; b=2" } });
    assert.equal(readCookie(req, "fw_admin"), "123.abc=");
    assert.equal(readCookie(req, "nope"), null);
    assert.equal(readCookie(new Request("https://x.test/"), "fw_admin"), null);
  });
});
