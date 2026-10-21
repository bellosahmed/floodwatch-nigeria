import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createFileStore } from "../lib/store/file";
import { createPostgresStore } from "../lib/store/postgres";
import { hashDevice, MAX_CODE_ATTEMPTS, MAX_REPORTS_PER_DEVICE_PER_HOUR, type NewReport, type NewSubscription, type Snapshot, type Store } from "../lib/store";

// The same behaviour is required of every store, so one suite runs against each.
// The Postgres run needs a database: TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/dbname npm test

const input = (device: string, over: Partial<NewReport> = {}): NewReport => ({
  state: "lagos",
  area: "Test area",
  severity: 2,
  note: "",
  device,
  ...over,
});

const FUTURE = () => new Date(Date.now() + 10 * 60_000).toISOString();
const sub = (phoneHash: string, over: Partial<NewSubscription> = {}): NewSubscription => ({
  channel: "sms",
  phoneEnc: "enc:" + phoneHash,
  phoneHash,
  state: "lagos",
  hazard: "flood",
  minLevel: 2,
  consentVersion: "v1",
  codeHash: "code-A",
  codeExpiresAt: FUTURE(),
  ...over,
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  date: "2026-10-18",
  at: new Date().toISOString(),
  state: "lagos",
  month: 10,
  inOutlook: true,
  rainDay0Mm: 1,
  rainNext3Mm: 2,
  rain7Mm: 3,
  rainPeakMm: 1,
  riverRatio: null,
  riverPeakM3s: null,
  forecastLevel: 0,
  ...over,
});

// Each test uses its own state or device names, so tests never interfere even in a shared database.
function contract(name: string, make: () => Promise<Store>, skip?: string) {
  describe(`store contract: ${name}`, { skip }, () => {
    let store: Store;
    const run = Math.random().toString(36).slice(2, 8); // keeps device ids unique across runs
    const dev = (n: string) => `${run}-${n}`;
    before(async () => {
      store = await make();
    });

    it("is reachable", async () => {
      await store.ping();
    });

    it("stores a report with its optional local government, visible and not hidden", async () => {
      const r = await store.addReport(input(dev("a"), { lga: "lagos-agege", note: "knee deep" }));
      assert.ok(r.ok);
      assert.equal(r.report.lga, "lagos-agege");
      assert.equal(r.report.hidden, false);
      assert.ok(Math.abs(Date.parse(r.report.at) - Date.now()) < 60_000, "timestamp is set by the store");
      const since = await store.reportsSince(Date.now() - 60_000);
      assert.ok(since.some((x) => x.id === r.report.id && x.note === "knee deep"));
    });

    it("leaves lga undefined when none was given", async () => {
      const r = await store.addReport(input(dev("nolga")));
      assert.ok(r.ok);
      assert.equal(r.report.lga, undefined);
    });

    it("caps reports per device per hour, and other devices are unaffected", async () => {
      const results = [];
      for (let i = 0; i < MAX_REPORTS_PER_DEVICE_PER_HOUR + 2; i++) results.push((await store.addReport(input(dev("cap")))).ok);
      assert.equal(results.filter(Boolean).length, MAX_REPORTS_PER_DEVICE_PER_HOUR);
      assert.ok((await store.addReport(input(dev("cap-other")))).ok);
    });

    it("cannot be pushed past the per-device cap by simultaneous requests", async () => {
      const burst = await Promise.all(Array.from({ length: 25 }, () => store.addReport(input(dev("race")))));
      assert.equal(burst.filter((r) => r.ok).length, MAX_REPORTS_PER_DEVICE_PER_HOUR);
    });

    it("keeps every write when many devices report at once", async () => {
      const before = (await store.reportsSince(0)).length;
      await Promise.all(Array.from({ length: 20 }, (_, i) => store.addReport(input(dev(`burst-${i}`)))));
      assert.equal((await store.reportsSince(0)).length, before + 20);
    });

    it("only returns reports from the requested time onward, oldest first", async () => {
      const t = Date.now();
      const all = await store.reportsSince(0);
      assert.deepEqual(all.map((r) => r.at), [...all.map((r) => r.at)].sort());
      assert.equal((await store.reportsSince(t + 60_000)).length, 0);
    });

    it("hides a report from public views but keeps it for moderators, and can restore it", async () => {
      const r = await store.addReport(input(dev("hide")));
      assert.ok(r.ok);
      assert.equal(await store.setReportHidden(r.report.id, true), 1);
      assert.ok(!(await store.reportsSince(0)).some((x) => x.id === r.report.id), "gone from public reads");
      assert.ok(!(await store.allReports()).some((x) => x.id === r.report.id), "gone from training data");
      const listed = (await store.listReports({ limit: 500 })).find((x) => x.id === r.report.id);
      assert.equal(listed?.hidden, true, "still visible to moderators");
      assert.equal(await store.setReportHidden(r.report.id, true), 0, "hiding twice changes nothing");
      assert.equal(await store.setReportHidden(r.report.id, false), 1);
      assert.ok((await store.reportsSince(0)).some((x) => x.id === r.report.id));
      assert.equal(await store.setReportHidden("no-such-id", true), 0);
    });

    it("can hide everything from one device at once", async () => {
      const a = await store.addReport(input(dev("spam")));
      const b = await store.addReport(input(dev("spam")));
      const other = await store.addReport(input(dev("not-spam")));
      assert.ok(a.ok && b.ok && other.ok);
      assert.equal(await store.setReportHidden(a.report.id, true, true), 2);
      const visible = new Set((await store.reportsSince(0)).map((r) => r.id));
      assert.ok(!visible.has(a.report.id) && !visible.has(b.report.id));
      assert.ok(visible.has(other.report.id), "other devices are untouched");
    });

    it("lists reports for moderators, newest first, filtered by state", async () => {
      await store.addReport(input(dev("list"), { state: "kano" }));
      const kano = await store.listReports({ state: "kano", limit: 50 });
      assert.ok(kano.length > 0 && kano.every((r) => r.state === "kano"));
      assert.deepEqual(kano.map((r) => r.at), [...kano.map((r) => r.at)].sort().reverse());
      assert.ok((await store.listReports({ limit: 2 })).length <= 2);
    });

    it("stores gauge readings", async () => {
      const g = await store.addGauge({ state: "benue", station: "Makurdi bridge", levelM: 11.25, warningM: 10.5, dangerM: 12 });
      assert.equal(g.levelM, 11.25);
      const since = await store.gaugesSince(Date.now() - 60_000);
      assert.ok(since.some((x) => x.id === g.id && x.station === "Makurdi bridge" && x.dangerM === 12));
    });

    it("adds snapshots idempotently and preserves missing river data", async () => {
      const day = `2026-01-${String(1 + Math.floor(Math.random() * 27)).padStart(2, "0")}`;
      const rows = [snapshot({ date: day, state: "oyo" }), snapshot({ date: day, state: "ogun", riverRatio: 1.25, riverPeakM3s: 300 })];
      assert.equal(await store.addSnapshots(rows), 2, "both new rows are added");
      assert.equal(await store.addSnapshots(rows), 0, "a second run adds nothing");
      const stored = (await store.allSnapshots()).filter((s) => s.date === day);
      assert.equal(stored.find((s) => s.state === "oyo")?.riverRatio, null);
      assert.equal(stored.find((s) => s.state === "ogun")?.riverRatio, 1.25);
      assert.equal(typeof stored[0].inOutlook, "boolean");
    });

    describe("alert subscriptions", () => {
      const ph = (n: string) => `${run}-ph-${n}`;

      it("creates an unconfirmed subscription with an unsubscribe code, not yet eligible for alerts", async () => {
        const { subscription, pending } = await store.upsertPendingSubscription(sub(ph("new")));
        assert.equal(pending, true);
        assert.equal(subscription.confirmed, false);
        assert.ok(subscription.unsubCode.length >= 8);
        assert.equal(subscription.lastAlertLevel, 0);
        assert.ok(!(await store.listConfirmedSubscriptions()).some((s) => s.id === subscription.id));
      });

      it("confirms with the right code and stops holding the code", async () => {
        const p = ph("ok");
        const { subscription } = await store.upsertPendingSubscription(sub(p, { codeHash: "right" }));
        assert.deepEqual(await store.confirmSubscriptions(p, "sms", "right", Date.now()), { confirmed: 1 });
        const listed = (await store.listConfirmedSubscriptions()).find((s) => s.id === subscription.id);
        assert.equal(listed?.confirmed, true);
        assert.equal(listed?.codeHash, undefined, "the code is gone once used");
        assert.deepEqual(await store.confirmSubscriptions(p, "sms", "right", Date.now()), { confirmed: 0, reason: "none" }, "a code cannot be used twice");
      });

      it("rejects a wrong code, and locks after the allowed number of wrong tries even for the right code", async () => {
        const p = ph("lock");
        await store.upsertPendingSubscription(sub(p, { codeHash: "right" }));
        for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) assert.equal((await store.confirmSubscriptions(p, "sms", "wrong", Date.now())).reason, "bad-code");
        assert.equal((await store.confirmSubscriptions(p, "sms", "right", Date.now())).reason, "locked");
      });

      it("cannot be brute-forced by parallel guesses: only the allowed number of tries are ever evaluated", async () => {
        const p = ph("race");
        await store.upsertPendingSubscription(sub(p, { codeHash: "right" }));
        const results = await Promise.all(Array.from({ length: 15 }, () => store.confirmSubscriptions(p, "sms", "wrong", Date.now())));
        assert.equal(results.filter((r) => r.reason === "bad-code").length, MAX_CODE_ATTEMPTS);
        assert.equal(results.filter((r) => r.reason === "locked").length, 15 - MAX_CODE_ATTEMPTS);
        assert.equal((await store.confirmSubscriptions(p, "sms", "right", Date.now())).reason, "locked");
      });

      it("ignores an expired code", async () => {
        const p = ph("expired");
        await store.upsertPendingSubscription(sub(p, { codeHash: "right", codeExpiresAt: new Date(Date.now() - 1000).toISOString() }));
        assert.equal((await store.confirmSubscriptions(p, "sms", "right", Date.now())).reason, "none");
      });

      it("a fresh sign-up request issues a new code and resets the wrong-try count", async () => {
        const p = ph("refresh");
        const first = await store.upsertPendingSubscription(sub(p, { codeHash: "one" }));
        await store.confirmSubscriptions(p, "sms", "bad", Date.now());
        const again = await store.upsertPendingSubscription(sub(p, { codeHash: "two" }));
        assert.equal(again.subscription.id, first.subscription.id, "same row, not a duplicate");
        assert.equal(again.subscription.codeAttempts, 0);
        assert.deepEqual(await store.confirmSubscriptions(p, "sms", "two", Date.now()), { confirmed: 1 });
      });

      it("one code confirms every subscription requested together (flood and heat)", async () => {
        const p = ph("both");
        await store.upsertPendingSubscription(sub(p, { hazard: "flood", codeHash: "same" }));
        await store.upsertPendingSubscription(sub(p, { hazard: "heat", codeHash: "same" }));
        assert.deepEqual(await store.confirmSubscriptions(p, "sms", "same", Date.now()), { confirmed: 2 });
      });

      it("never lets a new request change or pause a confirmed subscription", async () => {
        const p = ph("safe");
        await store.upsertPendingSubscription(sub(p, { codeHash: "right", minLevel: 3 }));
        await store.confirmSubscriptions(p, "sms", "right", Date.now());
        const attack = await store.upsertPendingSubscription(sub(p, { codeHash: "attacker", minLevel: 2 }));
        assert.equal(attack.pending, false);
        assert.equal(attack.subscription.confirmed, true);
        assert.equal(attack.subscription.minLevel, 3, "unchanged");
        assert.equal((await store.listConfirmedSubscriptions()).filter((s) => s.phoneHash === p).length, 1, "still active");
      });

      it("keeps different phones, channels and areas apart", async () => {
        const a = await store.upsertPendingSubscription(sub(ph("iso-a"), { codeHash: "x" }));
        const b = await store.upsertPendingSubscription(sub(ph("iso-b"), { codeHash: "x" }));
        const c = await store.upsertPendingSubscription(sub(ph("iso-a"), { codeHash: "x", channel: "whatsapp" }));
        const d = await store.upsertPendingSubscription(sub(ph("iso-a"), { codeHash: "x", state: "kano" }));
        assert.equal(new Set([a.subscription.id, b.subscription.id, c.subscription.id, d.subscription.id]).size, 4);
        assert.deepEqual(await store.confirmSubscriptions(ph("iso-a"), "sms", "x", Date.now()), { confirmed: 2 }, "only that phone, only that channel");
        assert.equal((await store.confirmSubscriptions(ph("iso-b"), "whatsapp", "x", Date.now())).reason, "none");
      });

      it("remembers the alert already sent, and the end of an episode", async () => {
        const p = ph("state");
        const { subscription } = await store.upsertPendingSubscription(sub(p, { codeHash: "r" }));
        await store.confirmSubscriptions(p, "sms", "r", Date.now());
        const t = Date.now() - 5000;
        await store.setAlertState(subscription.id, 3, t);
        let s = (await store.listConfirmedSubscriptions()).find((x) => x.id === subscription.id)!;
        assert.equal(s.lastAlertLevel, 3);
        assert.ok(Math.abs(Date.parse(s.lastAlertAt!) - t) < 1000);
        await store.setAlertState(subscription.id, 0, null);
        s = (await store.listConfirmedSubscriptions()).find((x) => x.id === subscription.id)!;
        assert.equal(s.lastAlertLevel, 0);
        assert.equal(s.lastAlertAt, undefined);
      });

      it("deletes everything for a phone and channel from one unsubscribe code, and nobody else's", async () => {
        const p = ph("unsub");
        const f = await store.upsertPendingSubscription(sub(p, { hazard: "flood", codeHash: "u" }));
        await store.upsertPendingSubscription(sub(p, { hazard: "heat", codeHash: "u" }));
        const other = await store.upsertPendingSubscription(sub(ph("unsub-other"), { codeHash: "u" }));
        await store.confirmSubscriptions(p, "sms", "u", Date.now());
        await store.confirmSubscriptions(ph("unsub-other"), "sms", "u", Date.now());
        assert.equal(await store.unsubscribeByCode(f.subscription.unsubCode), 2);
        const left = await store.listConfirmedSubscriptions();
        assert.ok(!left.some((s) => s.phoneHash === p));
        assert.ok(left.some((s) => s.id === other.subscription.id), "another person is untouched");
        assert.equal(await store.unsubscribeByCode(f.subscription.unsubCode), 0, "already gone");
        assert.equal(await store.unsubscribeByCode("no-such-code"), 0);
      });

      it("counts sends by kind, phone and time", async () => {
        const p = ph("sendlog");
        const t0 = Date.now() - 1000;
        await store.logSend("otp", p, true);
        await store.logSend("otp", p, false);
        await store.logSend("alert", p, true);
        await store.logSend("alert", null, true);
        assert.equal(await store.countSends({ sinceMs: t0, kind: "otp", phoneHash: p }), 2, "failed sends count too: they can still cost money");
        assert.equal(await store.countSends({ sinceMs: t0, phoneHash: p }), 3);
        assert.ok((await store.countSends({ sinceMs: t0, kind: "alert" })) >= 2);
        assert.equal(await store.countSends({ sinceMs: Date.now() + 60_000 }), 0);
      });

      it("summarises subscribers without exposing numbers", async () => {
        const stats = await store.subscriptionStats();
        assert.ok(stats.confirmed >= 1 && stats.pending >= 1);
        assert.equal(Object.values(stats.byState).reduce((a, b) => a + b, 0), stats.confirmed);
      });
    });

    it("prunes without touching recent data", async () => {
      const r = await store.addReport(input(dev("prune")));
      assert.ok(r.ok);
      await store.prune();
      assert.ok((await store.reportsSince(0)).some((x) => x.id === r.report.id));
      const before = await store.subscriptionStats();
      await store.prune();
      const after = await store.subscriptionStats();
      assert.equal(after.confirmed, before.confirmed, "confirmed subscriptions survive");
    });
  });
}

// ---- file store ----
const dir = mkdtempSync(path.join(tmpdir(), "fw-store-"));
after(() => rmSync(dir, { recursive: true, force: true }));
contract("file", async () => createFileStore(path.join(dir, "contract.json")));

describe("file store specifics", () => {
  it("starts empty when the file does not exist", async () => {
    const s = createFileStore(path.join(dir, "fresh.json"));
    assert.deepEqual(await s.reportsSince(0), []);
    assert.deepEqual(await s.allSnapshots(), []);
  });

  it("refuses to treat a corrupt file as empty, so data is never silently overwritten", async () => {
    const file = path.join(dir, "corrupt.json");
    const s = createFileStore(file);
    await s.addReport(input("corrupt-test-device"));
    writeFileSync(file, "{ this is not json");
    await assert.rejects(() => s.reportsSince(0));
    await assert.rejects(() => s.addReport(input("corrupt-test-device-2")));
    assert.equal((await import("node:fs")).readFileSync(file, "utf8"), "{ this is not json", "file untouched");
    writeFileSync(file, JSON.stringify({ reports: [], gauges: [], snapshots: [] }));
    assert.ok((await s.addReport(input("corrupt-test-device-3"))).ok, "queue recovers after a failed write");
  });

  it("keeps the database readable by its owner only", { skip: process.platform === "win32" }, async () => {
    const file = path.join(dir, "perms.json");
    await createFileStore(file).addReport(input("perm-device"));
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

// ---- Postgres store (needs a database) ----
const pgUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | undefined;
contract(
  "postgres",
  async () => {
    pool = new Pool({ connectionString: pgUrl, max: 5 });
    await pool.query("DROP TABLE IF EXISTS reports, gauges, snapshots"); // start from a clean schema
    return createPostgresStore(pool);
  },
  pgUrl ? undefined : "set TEST_DATABASE_URL to run the Postgres tests",
);
after(async () => {
  await pool?.end();
});

describe("postgres first launch", { skip: pgUrl ? undefined : "set TEST_DATABASE_URL to run the Postgres tests" }, () => {
  it("survives many instances creating the schema at the same moment", async () => {
    const p = new Pool({ connectionString: pgUrl, max: 10 });
    try {
      await p.query("DROP TABLE IF EXISTS reports, gauges, snapshots, subscriptions, send_log");
      const stores = Array.from({ length: 10 }, () => createPostgresStore(p));
      const results = await Promise.allSettled(stores.map((st) => st.ping()));
      assert.deepEqual(results.filter((r) => r.status === "rejected"), []);
    } finally {
      await p.end();
    }
  });
});

describe("shared helpers", () => {
  it("stores only a hash of the device id", () => {
    const hashed = hashDevice("my-secret-device-id");
    assert.notEqual(hashed, "my-secret-device-id");
    assert.equal(hashed.length, 32);
    assert.equal(hashDevice("my-secret-device-id"), hashed);
  });
});
