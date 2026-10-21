import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLocation, MIN_RIVER_FLOW_M3S, rainLevel, riverLevel, seasonalRiverLevel } from "../lib/forecast";
import { usualFlow } from "../lib/river-climate";
import { bySlug } from "../lib/locations";

const lagos = bySlug("lagos")!;
const days = (n: number, start = "2026-10-18") =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10));

// No seasonal river history for this place, so the river tests check the ratio arithmetic on its own.
const noHistory = { ...lagos, slug: "no-seasonal-history" };

describe("rain thresholds", () => {
  it("maps rainfall totals to levels", () => {
    assert.equal(rainLevel(2, 8).level, 0);
    assert.equal(rainLevel(16, 18).level, 1);
    assert.equal(rainLevel(5, 55).level, 2);
    assert.equal(rainLevel(65, 65).level, 3);
    assert.equal(rainLevel(0, 120).level, 3);
  });
});

describe("river thresholds", () => {
  it("ignores missing data and maps ratios to levels", () => {
    assert.equal(riverLevel(null).level, 0);
    assert.equal(riverLevel(1.05).level, 0);
    assert.equal(riverLevel(1.2).level, 1);
    assert.equal(riverLevel(1.4).level, 2);
    assert.equal(riverLevel(2).level, 3);
  });
});

describe("assessLocation", () => {
  const weather = (mm: number[]) => ({ time: days(mm.length), precipitation_sum: mm });

  it("scores rainfall when river data is missing", () => {
    const r = assessLocation(lagos, weather([20, 20, 20, 0, 0, 0, 0]), undefined, "2026-10-18");
    assert.equal(r.level, 2); // 60 mm in 3 days
    assert.equal(r.river.ratioToRecent, null);
  });

  it("compares the forecast river peak with the previous 30-day mean", () => {
    const time = days(37, "2026-09-18"); // 30 past days, then today + 6
    const flow = [...Array(30).fill(100), 100, 120, 150, 170, 140, 120, 110];
    const r = assessLocation(noHistory, weather([0, 0, 0, 0, 0, 0, 0]), { time, river_discharge: flow }, "2026-10-18");
    assert.equal(r.river.peak7M3s, 170);
    assert.ok(Math.abs(r.river.ratioToRecent! - 1.7) < 1e-9);
    assert.equal(r.level, 3);
  });

  it("treats null values as zero rainfall and reports quiet conditions", () => {
    const r = assessLocation(lagos, { time: days(3), precipitation_sum: [null, null, null] }, undefined, "2026-10-18");
    assert.equal(r.level, 0);
    assert.match(r.reasons[0], /No significant/);
  });
});

describe("per-day calendar levels", () => {
  const weather = (mm: number[]) => ({ time: days(mm.length), precipitation_sum: mm });

  it("returns one entry per forecast day, with confidence that falls over time", () => {
    const r = assessLocation(lagos, weather(Array(16).fill(0)), undefined, "2026-10-18");
    assert.equal(r.days.length, 16);
    assert.deepEqual(
      [0, 2, 3, 6, 7, 15].map((i) => r.days[i].confidence),
      ["high", "high", "medium", "medium", "low", "low"],
    );
    assert.equal(r.days[0].date, "2026-10-18");
  });

  it("accumulates rain over the day and the two days before it", () => {
    // 20 + 20 + 15 = 55 mm over three days: heavy by day 3, but each single day is below the heavy mark.
    const r = assessLocation(lagos, weather([0, 20, 20, 15, 0, 0, 0, 0, 0, 0]), undefined, "2026-10-18");
    assert.equal(r.days[0].level, 0);
    assert.equal(r.days[3].level, 2);
    assert.equal(r.days[9].level, 0, "later dry days drop back to Low");
  });

  it("flags a single extreme day", () => {
    const r = assessLocation(lagos, weather([0, 0, 70, 0, 0, 0, 0, 0]), undefined, "2026-10-18");
    assert.equal(r.days[2].level, 3);
  });

  it("scores days beyond day 7 on the calendar without changing the 7-day headline", () => {
    const mm = [0, 0, 0, 0, 0, 0, 0, 0, 0, 90, 0, 0];
    const r = assessLocation(lagos, weather(mm), undefined, "2026-10-18");
    assert.equal(r.days[9].level, 3, "the calendar shows the storm on day 10");
    assert.equal(r.level, 0, "the headline only covers the next 7 days");
    assert.equal(r.rain.peakDayMm, 0);
  });

  it("scores each day's river flow against the previous 30-day mean", () => {
    const time = days(46, "2026-09-18"); // 30 past days then 16 forecast days
    const flow = [...Array(30).fill(100), ...Array(16).fill(100)];
    flow[30 + 10] = 200; // day 11 doubles
    const r = assessLocation(noHistory, weather(Array(16).fill(0)), { time, river_discharge: flow }, "2026-10-18");
    assert.ok(Math.abs(r.days[10].riverRatio! - 2) < 1e-9);
    assert.equal(r.days[10].level, 3);
    assert.equal(r.days[9].level, 0);
  });
});

describe("past month and heat", () => {
  const dates = (n: number, start: string) =>
    Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  // 30 past days, today, then 15 forecast days (like the real request)
  const build = (over: { rain?: number[]; tmax?: number[]; feels?: number[] } = {}) => {
    const time = dates(46, "2026-09-18");
    return {
      time,
      precipitation_sum: over.rain ?? Array(46).fill(0),
      temperature_2m_max: over.tmax ?? Array(46).fill(32),
      apparent_temperature_max: over.feels ?? Array(46).fill(35),
    };
  };

  it("marks 30 past days, today and the forecast, with observed confidence for history", () => {
    const r = assessLocation(lagos, build(), undefined, "2026-10-18", 30);
    assert.equal(r.days.length, 46);
    assert.equal(r.days.filter((d) => d.phase === "past").length, 30);
    assert.equal(r.days[30].phase, "today");
    assert.equal(r.days[30].date, "2026-10-18");
    assert.ok(r.days.slice(0, 30).every((d) => d.confidence === "observed"));
    assert.equal(r.days[30].confidence, "high");
    assert.equal(r.days[45].confidence, "low");
  });

  it("keeps the headline and rain summary on forecast days only", () => {
    const rain = Array(46).fill(0);
    rain[5] = 90; // a storm three weeks ago must not raise today's headline
    const r = assessLocation(lagos, build({ rain }), undefined, "2026-10-18", 30);
    assert.equal(r.level, 0);
    assert.equal(r.rain.dates.length, 16);
    assert.equal(r.rain.dates[0], "2026-10-18");
    assert.equal(r.days[5].level, 3, "but the calendar still shows the past storm");
  });

  it("scores heat on past and future days, and summarises the next 7 days", () => {
    const tmax = Array(46).fill(32);
    const feels = Array(46).fill(35);
    for (const i of [32, 33, 34]) { tmax[i] = 42; feels[i] = 44; } // a 3-day heat run starting in 2 days
    const r = assessLocation(lagos, build({ tmax, feels }), undefined, "2026-10-18", 30);
    assert.deepEqual([32, 33, 34].map((i) => r.days[i].heatLevel), [3, 3, 3]); // base High (2) raised by the run
    assert.ok(r.days[33].heatwave);
    assert.equal(r.heat.level, 3);
    assert.equal(r.heat.heatwave, true);
    assert.equal(r.heat.peakTmaxC, 42);
    assert.match(r.heat.reasons[0], /Heatwave/);
  });

  it("does not let past heat raise the upcoming headline", () => {
    const tmax = Array(46).fill(32);
    for (const i of [2, 3, 4]) tmax[i] = 44;
    const r = assessLocation(lagos, build({ tmax }), undefined, "2026-10-18", 30);
    assert.equal(r.heat.level, 0);
    assert.equal(r.days[3].heatwave, true, "history keeps its heatwave mark");
  });

  it("reports calm heat plainly", () => {
    const r = assessLocation(lagos, build(), undefined, "2026-10-18", 30);
    assert.equal(r.heat.level, 0);
    assert.match(r.heat.reasons[0], /No unusual heat/);
  });

  it("handles a forecast without temperature data", () => {
    const r = assessLocation(lagos, { time: dates(5, "2026-10-18"), precipitation_sum: [0, 0, 0, 0, 0] }, undefined, "2026-10-18");
    assert.equal(r.heat.level, 0);
    assert.equal(r.heat.peakTmaxC, null);
    assert.ok(r.days.every((d) => d.tmaxC === null));
  });
});

describe("fetching the weather source", () => {
  const realFetch = globalThis.fetch;
  const ok = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200 });
  const restore = () => { globalThis.fetch = realFetch; };

  it("retries once after a timeout, then succeeds", async () => {
    const { fetchBatch } = await import("../lib/forecast");
    let calls = 0;
    globalThis.fetch = (async () => { calls++; if (calls === 1) throw Object.assign(new Error("slow"), { name: "TimeoutError" }); return ok([{ a: 1 }]); }) as typeof fetch;
    try { assert.deepEqual(await fetchBatch("https://x.test", 1), [{ a: 1 }]); assert.equal(calls, 2); } finally { restore(); }
  });

  it("retries a 503 once, but not a 429 or 400", async () => {
    const { fetchBatch } = await import("../lib/forecast");
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return calls === 1 ? new Response("", { status: 503 }) : ok([{ a: 1 }]); }) as typeof fetch;
    try { await fetchBatch("https://x.test", 1); assert.equal(calls, 2, "503 retried"); } finally { restore(); }

    for (const status of [429, 400]) {
      calls = 0;
      globalThis.fetch = (async () => { calls++; return new Response("", { status }); }) as typeof fetch;
      try { await assert.rejects(() => fetchBatch("https://x.test", 1), new RegExp(String(status))); assert.equal(calls, 1, `${status} not retried`); } finally { restore(); }
    }
  });

  it("gives up after two attempts and does not retry a wrong number of rows", async () => {
    const { fetchBatch } = await import("../lib/forecast");
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw Object.assign(new Error("down"), { name: "TimeoutError" }); }) as typeof fetch;
    try { await assert.rejects(() => fetchBatch("https://x.test", 1), /down/); assert.equal(calls, 2); } finally { restore(); }

    calls = 0;
    globalThis.fetch = (async () => { calls++; return ok([{}, {}]); }) as typeof fetch;
    try { await assert.rejects(() => fetchBatch("https://x.test", 3), /2 rows, expected 3/); assert.equal(calls, 1); } finally { restore(); }
  });
});

describe("seasonalRiverLevel", () => {
  const usual = usualFlow("borno", 9)!;

  it("has seasonal history for a river state", () => {
    assert.ok(usual.p90M3s > usual.p50M3s && usual.p50M3s > 0);
  });

  it("lowers a rise that is normal for the season by one step, or two when near the usual middle", () => {
    assert.equal(seasonalRiverLevel(2, usual.p90M3s, "borno", 9).level, 2);
    assert.equal(seasonalRiverLevel(2, usual.p50M3s, "borno", 9).level, 1);
  });

  it("keeps the full level when the flow is above the usual range", () => {
    const r = seasonalRiverLevel(2, usual.p90M3s * 1.2, "borno", 9);
    assert.equal(r.level, 3);
    assert.ok(!r.why?.includes("normal rise"));
  });

  it("says when a rise is normal for the time of year", () => {
    assert.match(seasonalRiverLevel(2, usual.p90M3s, "borno", 9).why ?? "", /normal rise for this time of year/);
  });

  it("changes nothing without seasonal history or flow", () => {
    assert.equal(seasonalRiverLevel(2, 100, "nowhere", 9).level, 3);
    assert.equal(seasonalRiverLevel(2, 100, undefined, 9).level, 3);
    assert.equal(seasonalRiverLevel(2, null, "borno", 9).level, 3);
  });

  it("never invents a warning", () => {
    assert.equal(seasonalRiverLevel(1.05, 9999, "borno", 9).level, 0);
    assert.equal(seasonalRiverLevel(null, 9999, "borno", 9).level, 0);
  });

  it("ignores a rise on a river too small for the flow model to be reliable", () => {
    assert.equal(seasonalRiverLevel(3, MIN_RIVER_FLOW_M3S - 1, "no-history", 7).level, 0);
    assert.equal(seasonalRiverLevel(3, MIN_RIVER_FLOW_M3S, "no-history", 7).level, 3);
  });
});
