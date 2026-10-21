import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seasonLevel, typicalMonths } from "../lib/climatology";
import { LOCATIONS } from "../lib/locations";

const stat = (meanMm: number, heavyDaysPerYear: number, probVeryHeavy: number) => ({ meanMm, heavyDaysPerYear, probVeryHeavy });

describe("seasonLevel rules", () => {
  it("classifies dry, light, heavy and peak months", () => {
    assert.equal(seasonLevel(stat(2, 0, 0)), 0);
    assert.equal(seasonLevel(stat(60, 0.1, 0)), 1);
    assert.equal(seasonLevel(stat(120, 0.1, 0)), 2); // wet on average
    assert.equal(seasonLevel(stat(40, 0.4, 0)), 2); // regular heavy days
    assert.equal(seasonLevel(stat(40, 0.1, 0.1)), 2); // occasional 50 mm days
    assert.equal(seasonLevel(stat(200, 0.8, 0)), 3);
    assert.equal(seasonLevel(stat(100, 0.2, 0.3)), 3);
  });
});

describe("generated climatology data", () => {
  it("covers every state with twelve months", () => {
    for (const loc of LOCATIONS) {
      const months = typicalMonths(loc.slug);
      assert.equal(months.length, 12, `${loc.slug} should have 12 months`);
      assert.deepEqual(months.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  it("returns an empty list for an unknown state", () => {
    assert.deepEqual(typicalMonths("narnia"), []);
  });

  // Sanity checks against well-known Nigerian rainfall seasons. If these fail, the data file is suspect.
  it("matches known rainy seasons", () => {
    const lagos = typicalMonths("lagos");
    assert.ok(lagos[0].level <= 1 && lagos[11].level <= 1, "Lagos is not in peak rains in Dec/Jan");
    assert.ok(Math.max(...lagos.slice(5, 10).map((m) => m.level)) >= 2, "Lagos has heavy rains June-October");

    const kano = typicalMonths("kano");
    assert.equal(kano[0].level, 0, "Kano is dry in January");
    assert.equal(kano[11].level, 0, "Kano is dry in December");
    assert.ok(kano[7].level >= 2, "Kano's rains peak around August");
    assert.ok(kano[7].meanMm > kano[5].meanMm, "Kano's August is wetter than June");
  });

  it("is generally wetter in the south than the far north", () => {
    const total = (slug: string) => typicalMonths(slug).reduce((a, m) => a + m.meanMm, 0);
    assert.ok(total("rivers") > total("lagos"));
    assert.ok(total("lagos") > total("kano"));
    assert.ok(total("kano") > total("borno"));
  });
});
