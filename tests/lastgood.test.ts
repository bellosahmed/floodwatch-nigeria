import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { clearLastGood, withLastGood } from "../lib/lastgood";

describe("withLastGood", () => {
  beforeEach(() => clearLastGood());

  it("returns fresh data normally", async () => {
    const r = await withLastGood("k", 1_000, async () => "now");
    assert.deepEqual({ value: r.value, stale: r.stale }, { value: "now", stale: false });
  });

  it("serves the earlier answer, marked stale and dated, when the source fails", async () => {
    let t = 1_000_000;
    const clock = () => t;
    await withLastGood("k", 60_000, async () => "earlier", clock);
    t += 30_000;
    const r = await withLastGood("k", 60_000, async () => { throw new Error("503"); }, clock);
    assert.equal(r.value, "earlier");
    assert.equal(r.stale, true);
    assert.equal(r.asOf, new Date(1_000_000).toISOString(), "reports when the data was really fetched");
  });

  it("gives up once the earlier answer is too old to be useful", async () => {
    let t = 0;
    const clock = () => t;
    await withLastGood("k", 60_000, async () => "old", clock);
    t += 61_000;
    await assert.rejects(() => withLastGood("k", 60_000, async () => { throw new Error("503"); }, clock), /503/);
  });

  it("throws when the source fails and nothing was ever fetched", async () => {
    await assert.rejects(() => withLastGood("never", 60_000, async () => { throw new Error("down"); }), /down/);
  });

  it("keeps separate answers per key, and recovers to fresh data when the source returns", async () => {
    await withLastGood("a", 60_000, async () => "A");
    await withLastGood("b", 60_000, async () => "B");
    assert.equal((await withLastGood("a", 60_000, async () => { throw new Error("x"); })).value, "A");
    assert.equal((await withLastGood("b", 60_000, async () => { throw new Error("x"); })).value, "B");
    const back = await withLastGood("a", 60_000, async () => "A2");
    assert.deepEqual({ value: back.value, stale: back.stale }, { value: "A2", stale: false });
  });
});
