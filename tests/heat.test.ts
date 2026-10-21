import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseHeatLevel, HEATWAVE_MIN_DAYS, localHeatLevel, scoreHeat } from "../lib/heat";
import { usualMaxC } from "../lib/heat-climate";

const hot = (tmaxC: number, feelsC: number) => ({ tmaxC, feelsC });
const mild = { tmaxC: 33, feelsC: 36 };

describe("baseHeatLevel", () => {
  it("maps temperatures to bands, using whichever of actual or feels-like is worse", () => {
    assert.equal(baseHeatLevel(33, 36), 0);
    assert.equal(baseHeatLevel(40, 38), 1);
    assert.equal(baseHeatLevel(36, 41), 1);
    assert.equal(baseHeatLevel(42, 40), 2);
    assert.equal(baseHeatLevel(38, 43), 2);
    assert.equal(baseHeatLevel(45, 40), 3);
    assert.equal(baseHeatLevel(38, 46), 3);
  });

  it("treats missing data as no signal, not as heat", () => {
    assert.equal(baseHeatLevel(null, null), 0);
    assert.equal(baseHeatLevel(null, 41), 1);
    assert.equal(baseHeatLevel(40, null), 1);
  });

  it("does not fire on ordinary humid coastal heat", () => {
    // Lagos routinely feels like 36-38 C. That must stay unflagged or the warning is noise.
    assert.equal(baseHeatLevel(32, 38), 0);
  });
});

describe("scoreHeat", () => {
  it("does not call one or two hot days a heatwave", () => {
    const r = scoreHeat([mild, hot(41, 42), hot(41, 42), mild]);
    assert.deepEqual(r.map((d) => d.level), [0, 1, 1, 0]);
    assert.ok(r.every((d) => !d.heatwave));
  });

  it(`raises each day one step once ${HEATWAVE_MIN_DAYS}+ hot days run together`, () => {
    const r = scoreHeat([mild, hot(41, 42), hot(41, 42), hot(41, 42), mild]);
    assert.deepEqual(r.map((d) => d.level), [0, 2, 2, 2, 0]);
    assert.deepEqual(r.map((d) => d.heatwave), [false, true, true, true, false]);
  });

  it("caps at Extreme", () => {
    const r = scoreHeat([hot(46, 47), hot(46, 47), hot(46, 47)]);
    assert.ok(r.every((d) => d.level === 3 && d.heatwave));
  });

  it("detects separate runs independently", () => {
    const h = hot(41, 42);
    const r = scoreHeat([h, h, h, mild, h, h]);
    assert.deepEqual(r.map((d) => d.heatwave), [true, true, true, false, false, false]);
  });

  it("counts a heatwave already under way when the run spans past and future days", () => {
    // two hot days in the past + one hot day today = 3 in a row
    const h = hot(41, 42);
    const r = scoreHeat([mild, h, h, h, mild]);
    assert.equal(r[3].heatwave, true);
  });

  it("returns nothing for no data", () => {
    assert.deepEqual(scoreHeat([]), []);
  });
});

describe("local baseline", () => {
  it("lowers a day one step when it is not hotter than usual for the place and month", () => {
    assert.equal(localHeatLevel({ tmaxC: 41, feelsC: 41, usualMaxC: 42 }), 0);
    assert.equal(localHeatLevel({ tmaxC: 42, feelsC: 41, usualMaxC: 42 }), 1);
  });

  it("keeps the full band when the day is hotter than usual", () => {
    assert.equal(localHeatLevel({ tmaxC: 43, feelsC: 41, usualMaxC: 42 }), 2);
    assert.equal(localHeatLevel({ tmaxC: 46, feelsC: 47, usualMaxC: 42 }), 3);
  });

  it("changes nothing when the usual value is unknown", () => {
    assert.equal(localHeatLevel({ tmaxC: 41, feelsC: 41 }), 1);
    assert.equal(localHeatLevel({ tmaxC: 41, feelsC: 41, usualMaxC: null }), 1);
  });

  it("does not turn normal Sahel hot-season days into a heatwave", () => {
    const normal = { tmaxC: 41, feelsC: 41, usualMaxC: 42 };
    const r = scoreHeat([normal, normal, normal, normal]);
    assert.ok(r.every((d) => d.level === 0 && !d.heatwave));
  });

  it("still flags an unusual run in the same place", () => {
    const unusual = { tmaxC: 44, feelsC: 44, usualMaxC: 42 };
    const r = scoreHeat([unusual, unusual, unusual]);
    assert.ok(r.every((d) => d.level === 3 && d.heatwave));
  });
});

describe("usualMaxC", () => {
  it("is higher in Sokoto in April than in Lagos, and unknown for an unknown state", () => {
    assert.ok((usualMaxC("sokoto", 4) ?? 0) > (usualMaxC("lagos", 4) ?? 99));
    assert.equal(usualMaxC("nowhere", 4), null);
    assert.equal(usualMaxC(undefined, 4), null);
  });
});
