import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WeatherDaily } from "../lib/forecast";
import { assessLga, outlookFor, rankLgas } from "../lib/lga-forecast";
import { ALL_LGAS, farthestLgaKm, LARGE_SPREAD_KM, lgaBySlug, lgasOf } from "../lib/lgas";
import { LOCATIONS } from "../lib/locations";

// Official number of LGAs per state (774 in total, including the 6 FCT area councils).
const OFFICIAL: Record<string, number> = {
  abia: 17, adamawa: 21, "akwa-ibom": 31, anambra: 21, bauchi: 20, bayelsa: 8, benue: 23, borno: 27, "cross-river": 18,
  delta: 25, ebonyi: 13, edo: 18, ekiti: 16, enugu: 17, fct: 6, gombe: 11, imo: 27, jigawa: 27, kaduna: 23, kano: 44,
  katsina: 34, kebbi: 21, kogi: 21, kwara: 16, lagos: 20, nasarawa: 13, niger: 25, ogun: 20, ondo: 18, osun: 30, oyo: 33,
  plateau: 17, rivers: 23, sokoto: 23, taraba: 16, yobe: 17, zamfara: 14,
};

describe("LGA dataset", () => {
  it("has every local government: 774 in total", () => {
    assert.equal(ALL_LGAS.length, 774);
    assert.equal(Object.values(OFFICIAL).reduce((a, b) => a + b, 0), 774);
  });

  it("matches the official LGA count for every state", () => {
    for (const loc of LOCATIONS) assert.equal(lgasOf(loc.slug).length, OFFICIAL[loc.slug], `${loc.slug} LGA count`);
  });

  it("has unique slugs, real names and Nigerian coordinates", () => {
    assert.equal(new Set(ALL_LGAS.map((l) => l.slug)).size, ALL_LGAS.length);
    for (const l of ALL_LGAS) {
      assert.ok(l.name.length > 1, `${l.slug} name`);
      assert.ok(l.lat > 3.5 && l.lat < 14.5 && l.lon > 2.5 && l.lon < 15, `${l.slug} lies inside Nigeria`);
    }
  });

  it("looks LGAs up by slug", () => {
    const first = lgasOf("lagos")[0];
    assert.equal(lgaBySlug(first.slug)?.state, "lagos");
    assert.equal(lgaBySlug("nowhere"), undefined);
    assert.deepEqual(lgasOf("narnia"), []);
  });
});

const week = (mm: number[], tmax?: number[], feels?: number[]): WeatherDaily => ({
  time: mm.map((_, i) => new Date(Date.parse("2026-10-18T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10)),
  precipitation_sum: mm,
  temperature_2m_max: tmax ?? mm.map(() => 32),
  apparent_temperature_max: feels ?? mm.map(() => 35),
});

describe("LGA outlook", () => {
  it("finds when a hazard starts, when it peaks, and how bad it gets", () => {
    const l = assessLga({ slug: "a", name: "A" }, week([0, 0, 25, 40, 0, 0, 0]));
    // day 3 (index 2): 25 mm in the window = Watch; day 4 (index 3): 65 mm over 3 days = High
    assert.equal(l.flood.firstDate, "2026-10-20");
    assert.equal(l.flood.firstHighDate, "2026-10-21");
    assert.equal(l.flood.peakLevel, 2);
    assert.equal(l.flood.peakDate, "2026-10-21");
  });

  it("reports nothing expected for a dry, mild week", () => {
    const l = assessLga({ slug: "a", name: "A" }, week([0, 0, 0, 0, 0]));
    assert.equal(l.flood.peakLevel, 0);
    assert.equal(l.flood.firstDate, null);
    assert.equal(l.heat.firstDate, null);
  });

  it("scores heat separately from flood", () => {
    const hotWeek = [41, 41, 41, 33];
    const l = assessLga({ slug: "a", name: "A" }, week([0, 0, 0, 0], hotWeek, [42, 42, 42, 36]));
    assert.equal(l.flood.peakLevel, 0);
    assert.equal(l.heat.peakLevel, 2, "a 3-day run of hot days becomes a heatwave");
    assert.equal(l.heat.firstDate, "2026-10-18");
  });

  it("copes with a missing forecast", () => {
    const l = assessLga({ slug: "a", name: "A" }, undefined);
    assert.deepEqual(l.days, []);
    assert.equal(l.flood.peakLevel, 0);
  });

  it("ignores past days when computing the outlook", () => {
    const days = assessLga({ slug: "a", name: "A" }, week([0, 0, 0])).days.map((d, i) => ({ ...d, phase: i === 0 ? ("past" as const) : ("future" as const), level: i === 0 ? (3 as const) : (0 as const) }));
    assert.equal(outlookFor(days, "flood").peakLevel, 0);
  });
});

describe("rankLgas", () => {
  const mk = (slug: string, mm: number[]) => assessLga({ slug, name: slug }, week(mm));

  it("puts the most affected first, then whoever is hit sooner, then the wettest", () => {
    const severe = mk("severe", [0, 0, 0, 120, 0]);
    const highSoon = mk("high-soon", [0, 40, 0, 0, 0]);
    const highLate = mk("high-late", [0, 0, 0, 40, 0]);
    const quiet = mk("quiet", [0, 0, 0, 0, 0]);
    const ranked = rankLgas([quiet, highLate, severe, highSoon], "flood").map((l) => l.slug);
    assert.deepEqual(ranked, ["severe", "high-soon", "high-late", "quiet"]);
  });

  it("does not modify the list it was given", () => {
    const list = [mk("b", [0, 0]), mk("a", [60, 0])];
    rankLgas(list, "flood");
    assert.deepEqual(list.map((l) => l.slug), ["b", "a"]);
  });
});

describe("state spread", () => {
  it("flags big states and not small ones", () => {
    assert.ok(farthestLgaKm("niger", 9.62, 6.55) > LARGE_SPREAD_KM);
    assert.ok(farthestLgaKm("lagos", 6.52, 3.38) < LARGE_SPREAD_KM);
    assert.equal(farthestLgaKm("nowhere", 0, 0), 0);
  });
});
