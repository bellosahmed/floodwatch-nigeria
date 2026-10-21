import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// These call the real route handlers, backed by a throwaway file store, with no server and no network.
const dir = mkdtempSync(path.join(tmpdir(), "fw-routes-"));
const ADMIN = "a".repeat(40);

type Handler = (req: Request) => Promise<Response> | Response;
let reportsRoute: { POST: Handler };
let adminRoute: { GET: Handler; POST: Handler };
let healthRoute: { GET: Handler };
let store: typeof import("../lib/store");

before(async () => {
  process.env.FLOODWATCH_DB = path.join(dir, "routes.json");
  process.env.ADMIN_API_KEY = ADMIN;
  delete process.env.DATABASE_URL;
  delete process.env.TURNSTILE_SECRET;
  [reportsRoute, adminRoute, healthRoute, store] = (await Promise.all([
    import("../app/api/reports/route"),
    import("../app/api/admin/reports/route"),
    import("../app/api/health/route"),
    import("../lib/store"),
  ])) as unknown as [typeof reportsRoute, typeof adminRoute, typeof healthRoute, typeof store];
});
after(() => rmSync(dir, { recursive: true, force: true }));

const ip = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });
const submit = (body: object, extra: Record<string, string> = {}) =>
  reportsRoute.POST(
    new Request("https://floodwatch.example/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json", host: "floodwatch.example", ...ip(1), ...extra },
      body: JSON.stringify({ state: "lagos", area: "Ajegunle market", severity: 2, deviceId: "route-device-0001", ...body }),
    }),
  );
const admin = (method: "GET" | "POST", url: string, key: string | null = ADMIN, body?: object, n = 50) =>
  (method === "GET" ? adminRoute.GET : adminRoute.POST)(
    new Request(`https://floodwatch.example${url}`, {
      method,
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), ...ip(n) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );

describe("report submission route", () => {
  it("accepts a valid report and redacts contact details", async () => {
    const res = await submit({ deviceId: "route-device-0002", area: "Mile 2 call 08031234567", note: "see https://spam.example now" });
    assert.equal(res.status, 201);
    const stored = (await store.reportsSince(0)).find((r) => r.area.startsWith("Mile 2"));
    assert.equal(stored?.area, "Mile 2 call [number removed]");
    assert.equal(stored?.note, "see [link removed] now");
  });

  it("refuses other websites, wrong content types and bad input", async () => {
    assert.equal((await submit({}, { origin: "https://evil.example" })).status, 403);
    assert.equal((await submit({}, { "content-type": "text/plain" })).status, 415);
    assert.equal((await submit({ state: "narnia" })).status, 400);
    assert.equal((await submit({ severity: 9 })).status, 400);
    assert.equal((await submit({ area: "x" })).status, 400);
    assert.equal((await submit({ lga: "kano-ajingi" })).status, 400, "an LGA that is not in the chosen state");
  });

  it("stores a valid local government with the report", async () => {
    const { lgasOf } = await import("../lib/lgas");
    const lga = lgasOf("lagos")[0];
    assert.equal((await submit({ deviceId: "route-device-0003", lga: lga.slug })).status, 201);
    assert.ok((await store.reportsSince(0)).some((r) => r.lga === lga.slug));
  });
});

describe("moderation route", () => {
  it("is closed without the right key, and a short key never opens it", async () => {
    assert.equal((await admin("GET", "/api/admin/reports", null)).status, 401);
    assert.equal((await admin("GET", "/api/admin/reports", "wrong-key-wrong-key-wrong-key-xx")).status, 401);
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "short";
    assert.equal((await admin("GET", "/api/admin/reports", "short", undefined, 51)).status, 401);
    process.env.ADMIN_API_KEY = saved;
  });

  it("lists reports without exposing the device hash, then hides and restores one", async () => {
    await submit({ deviceId: "route-device-0010", area: "Spammy place" });
    const listed = (await (await admin("GET", "/api/admin/reports?state=lagos&limit=100")).json()) as { reports: { id: string; area: string; hidden: boolean; deviceTag: string; device?: string }[] };
    const target = listed.reports.find((r) => r.area === "Spammy place");
    assert.ok(target);
    assert.equal(target.deviceTag.length, 8);
    assert.equal(target.device, undefined, "the full device hash is not exposed");

    const hide = (await (await admin("POST", "/api/admin/reports", ADMIN, { id: target.id })).json()) as { changed: number };
    assert.equal(hide.changed, 1);
    assert.ok(!(await store.reportsSince(0)).some((r) => r.id === target.id), "gone from everything public");
    const stillListed = (await (await admin("GET", "/api/admin/reports?state=lagos&limit=100")).json()) as { reports: { id: string; hidden: boolean }[] };
    assert.equal(stillListed.reports.find((r) => r.id === target.id)?.hidden, true);

    const restore = (await (await admin("POST", "/api/admin/reports", ADMIN, { id: target.id, hidden: false })).json()) as { changed: number };
    assert.equal(restore.changed, 1);
    assert.ok((await store.reportsSince(0)).some((r) => r.id === target.id));
  });

  it("validates input", async () => {
    assert.equal((await admin("POST", "/api/admin/reports", ADMIN, {})).status, 400);
    assert.equal((await admin("GET", "/api/admin/reports?state=narnia")).status, 400);
    const res = await adminRoute.POST(new Request("https://floodwatch.example/api/admin/reports", { method: "POST", headers: { "x-api-key": ADMIN, "content-type": "text/plain", ...ip(52) }, body: "{}" }));
    assert.equal(res.status, 415);
  });

  it("clamps the page size", async () => {
    const res = (await (await admin("GET", "/api/admin/reports?limit=999999")).json()) as { reports: unknown[] };
    assert.ok(res.reports.length <= 200);
  });
});

describe("health route", () => {
  it("reports the storage in use without leaking details", async () => {
    const res = await healthRoute.GET(new Request("https://floodwatch.example/api/health"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; store: string; error?: string };
    assert.deepEqual({ ok: body.ok, store: body.store }, { ok: true, store: "file" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});
