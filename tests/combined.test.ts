import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combine } from "../lib/combined";
import { computeGround } from "../lib/ground";
import { forecastRisk, NOW, report } from "./helpers";

const ground = (n: number, severity: 1 | 2 | 3 = 2) =>
  computeGround(
    Array.from({ length: n }, (_, i) => report({ device: `d${i}`, severity })),
    [],
    NOW,
  ).find((l) => l.slug === "lagos")!;

describe("combine", () => {
  it("is quiet when neither layer flags anything", () => {
    const r = combine(ground(0), forecastRisk(0));
    assert.equal(r.level, 0);
    assert.equal(r.stage, "quiet");
    assert.equal(r.label, "Low");
  });

  it("uses the forecast alone for early warning", () => {
    const r = combine(ground(0), forecastRisk(2));
    assert.equal(r.level, 2);
    assert.equal(r.stage, "forecast");
  });

  it("uses reports alone when the forecast is quiet", () => {
    const r = combine(ground(1), forecastRisk(0));
    assert.equal(r.level, 1);
    assert.equal(r.stage, "reported");
  });

  it("raises one step when both layers agree", () => {
    const r = combine(ground(1), forecastRisk(1)); // Watch + Watch
    assert.equal(r.level, 2);
    assert.equal(r.stage, "confirmed");
    assert.equal(r.reasons[0], "Forecast and on-the-ground reports agree");
  });

  it("never exceeds Severe", () => {
    const r = combine(ground(3, 3), forecastRisk(3));
    assert.equal(r.level, 3);
  });

  it("falls back to ground-only when the forecast is unavailable", () => {
    const r = combine(ground(2), null);
    assert.equal(r.level, 2);
    assert.equal(r.forecast, null);
    assert.equal(r.stage, "reported");
  });

  it("says nothing is known, not 'safe', with no forecast and no reports", () => {
    const r = combine(ground(0), null);
    assert.equal(r.level, 0);
    assert.match(r.reasons[0], /forecast is unavailable/);
  });
});
