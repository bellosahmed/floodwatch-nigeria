import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanText, RateLimiter, readJsonObject, safeEqual } from "../lib/http";

const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x.test/", { method: "POST", body, headers });

describe("RateLimiter", () => {
  it("blocks after the limit and recovers when the window passes", () => {
    const rl = new RateLimiter(2, 1000);
    assert.ok(rl.allow("ip", 0));
    assert.ok(rl.allow("ip", 100));
    assert.equal(rl.allow("ip", 200), false);
    assert.ok(rl.allow("other", 200));
    assert.ok(rl.allow("ip", 1500));
  });
});

describe("readJsonObject", () => {
  it("accepts a JSON object", async () => {
    assert.deepEqual(await readJsonObject(req('{"a":1}')), { a: 1 });
  });

  it("rejects invalid JSON, arrays, scalars and oversized bodies", async () => {
    assert.equal(await readJsonObject(req("{nope")), null);
    assert.equal(await readJsonObject(req("[1,2]")), null);
    assert.equal(await readJsonObject(req("42")), null);
    assert.equal(await readJsonObject(req(JSON.stringify({ a: "x".repeat(500) })), 100), null);
  });
});

describe("helpers", () => {
  it("cleanText strips control characters, trims and caps length", () => {
    assert.equal(cleanText("  hello\u0000\nworld  ", 50), "hello  world");
    assert.equal(cleanText("abcdef", 3), "abc");
    assert.equal(cleanText(42, 10), "");
  });

  it("safeEqual compares secrets", () => {
    assert.ok(safeEqual("secret", "secret"));
    assert.equal(safeEqual("secret", "secreT"), false);
    assert.equal(safeEqual("secret", "secret2"), false);
  });
});
