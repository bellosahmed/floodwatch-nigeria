import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  checkSecret,
  clientIp,
  getSecret,
  hasJsonContentType,
  isSameOrigin,
  RateLimiter,
  readJsonObject,
  redactContactDetails,
} from "../lib/http";

const req = (headers: Record<string, string> = {}, body = "{}", url = "https://floodwatch.example/api/reports") =>
  new Request(url, { method: "POST", headers, body });

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("request body limits", () => {
  it("abandons a streamed body that grows past the cap, even with no Content-Length", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // An endless stream: if the cap did not work this would never finish.
        sent += 1_000;
        controller.enqueue(new TextEncoder().encode("x".repeat(1_000)));
      },
    });
    const r = new Request("https://x.test/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    assert.equal(await readJsonObject(r, 4_096), null);
    assert.ok(sent < 50_000, `stopped reading early (read about ${sent} bytes)`);
  });

  it("rejects a declared oversize body without reading it", async () => {
    assert.equal(await readJsonObject(req({ "content-length": "999999" }), 8_192), null);
  });
});

describe("content type", () => {
  it("only accepts JSON", () => {
    assert.ok(hasJsonContentType(req({ "content-type": "application/json" })));
    assert.ok(hasJsonContentType(req({ "content-type": "application/json; charset=utf-8" })));
    // A cross-site HTML form can only send these three types without a CORS preflight.
    for (const t of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      assert.equal(hasJsonContentType(req({ "content-type": t })), false, t);
    }
    assert.equal(hasJsonContentType(new Request("https://x.test/", { method: "POST" })), false, "no content type at all");
  });
});

describe("cross-site request protection", () => {
  it("allows non-browser clients that send no Origin", () => {
    assert.ok(isSameOrigin(req({ host: "floodwatch.example" })));
  });

  it("allows the site's own pages", () => {
    assert.ok(isSameOrigin(req({ host: "floodwatch.example", origin: "https://floodwatch.example" })));
    assert.ok(isSameOrigin(req({ host: "floodwatch.example", "sec-fetch-site": "same-origin" })));
  });

  it("blocks other websites", () => {
    assert.equal(isSameOrigin(req({ host: "floodwatch.example", origin: "https://evil.example" })), false);
    assert.equal(isSameOrigin(req({ host: "floodwatch.example", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOrigin(req({ host: "floodwatch.example", origin: "not a url" })), false);
  });

  it("blocks look-alike hosts and honours a pinned origin", () => {
    assert.equal(isSameOrigin(req({ host: "floodwatch.example", origin: "https://floodwatch.example.evil.com" })), false);
    assert.ok(isSameOrigin(req({ origin: "https://floodwatch.ng" }), "https://floodwatch.ng/"));
    assert.equal(isSameOrigin(req({ origin: "https://floodwatch.example" }), "https://floodwatch.ng"), false);
  });
});

describe("redactContactDetails", () => {
  it("removes links, emails and phone numbers from public text", () => {
    assert.equal(redactContactDetails("call 0803 123 4567 now"), "call [number removed] now");
    assert.equal(redactContactDetails("+234 803-123-4567"), "[number removed]");
    assert.equal(redactContactDetails("mail me at ada@example.com please"), "mail me at [email removed] please");
    assert.equal(redactContactDetails("see https://scam.example/win now"), "see [link removed] now");
    assert.equal(redactContactDetails("visit www.scam.example"), "visit [link removed]");
    assert.equal(redactContactDetails("free money at bit.ly/abc123"), "free money at [link removed]");
  });

  it("leaves ordinary location text alone", () => {
    for (const ok of ["Ajegunle, Mile 2", "Behind the market, water knee deep", "12 Allen Avenue", "Km 14 Lekki expressway"]) {
      assert.equal(redactContactDetails(ok), ok);
    }
  });
});

describe("client address", () => {
  it("uses the rightmost X-Forwarded-For value, which the nearest proxy added, not the forgeable leftmost", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(req({})), "unknown");
  });

  it("prefers the platform header named in TRUSTED_IP_HEADER", () => {
    process.env.TRUSTED_IP_HEADER = "CF-Connecting-IP";
    assert.equal(clientIp(req({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "10.0.0.1" })), "198.51.100.7");
  });
});

describe("rate limiter memory", () => {
  it("never holds more than maxKeys addresses, so forged addresses cannot exhaust memory", () => {
    const rl = new RateLimiter(1, 60_000, 2);
    assert.ok(rl.allow("a", 0));
    assert.equal(rl.allow("a", 1), false);
    rl.allow("b", 2);
    rl.allow("c", 3); // table is full: the oldest key (a) is evicted
    assert.ok(rl.allow("a", 4), "a was evicted, so it starts fresh instead of the table growing");
  });
});

describe("secrets", () => {
  it("refuses missing or guessable secrets", () => {
    delete process.env.TEST_SECRET;
    assert.equal(getSecret("TEST_SECRET"), null);
    process.env.TEST_SECRET = "letmein";
    assert.equal(getSecret("TEST_SECRET"), null);
    process.env.TEST_SECRET = "a".repeat(23);
    assert.equal(getSecret("TEST_SECRET"), null);
  });

  it("accepts a strong secret", () => {
    process.env.TEST_SECRET = "a".repeat(24);
    assert.equal(getSecret("TEST_SECRET"), "a".repeat(24));
  });
});

describe("checkSecret", () => {
  const strong = "s".repeat(32);
  const from = (ip: string) => req({ "x-forwarded-for": ip });

  it("passes the right secret", () => {
    assert.equal(checkSecret(from("192.0.2.1"), strong, strong), null);
  });

  it("returns 401 for a wrong or missing secret, and never passes when the endpoint is disabled", async () => {
    assert.equal(checkSecret(from("192.0.2.2"), strong, "wrong")?.status, 401);
    assert.equal(checkSecret(from("192.0.2.3"), null, "anything")?.status, 401);
    assert.equal(checkSecret(from("192.0.2.4"), null, "")?.status, 401);
  });

  it("locks out an address after 10 wrong guesses, but still lets the correct key through", () => {
    const ip = "192.0.2.50";
    const statuses = Array.from({ length: 12 }, () => checkSecret(from(ip), strong, "guess")?.status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(statuses.slice(10), [429, 429]);
    assert.equal(checkSecret(from(ip), strong, strong), null, "the real key is never locked out");
  });
});

describe("connection handling on refused requests", () => {
  it("tells the server to hang up after refusing a body, so a client cannot keep the socket open", async () => {
    const { refuse, badBody } = await import("../lib/http");
    assert.equal(refuse("no", 403).headers.get("connection"), "close");
    const bad = badBody();
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get("connection"), "close");
  });

  it("also closes after wrong-key and lockout responses", () => {
    const r = checkSecret(new Request("https://x.test/", { method: "POST", headers: { "x-forwarded-for": "192.0.2.200" } }), "s".repeat(32), "wrong");
    assert.equal(r?.status, 401);
    assert.equal(r?.headers.get("connection"), "close");
  });
});
