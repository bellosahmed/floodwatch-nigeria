import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGround, computeLgaGround, levelFromDevices } from "../lib/ground";
import { gauge, hoursAgo, NOW, report } from "./helpers";

const lagos = (reports = [] as ReturnType<typeof report>[], gauges = [] as ReturnType<typeof gauge>[]) =>
  computeGround(reports, gauges, NOW).find((l) => l.slug === "lagos")!;

describe("ground risk", () => {
  it("is level 0 with no data and never claims the area is safe", () => {
    const r = lagos();
    assert.equal(r.level, 0);
    assert.equal(r.label, "No reports");
    assert.equal(r.confidence, "none");
    assert.match(r.reasons[0], /does not mean the area is safe/);
  });

  it("treats a single severe report as unverified Watch, not Severe", () => {
    const r = lagos([report({ device: "a", severity: 3 })]);
    assert.equal(r.level, 1);
    assert.equal(r.confidence, "unverified");
  });

  it("counts a device once however many times it reports", () => {
    const spam = Array.from({ length: 10 }, () => report({ device: "a", severity: 3 }));
    const r = lagos(spam);
    assert.equal(r.counts.reporters24h, 1);
    assert.equal(r.level, 1);
  });

  it("raises High when two independent devices report dangerous flooding", () => {
    const r = lagos([report({ device: "a", severity: 2 }), report({ device: "b", severity: 3 })]);
    assert.equal(r.level, 2);
    assert.equal(r.confidence, "corroborated");
  });

  it("raises Severe when three independent devices report severe flooding", () => {
    const r = lagos(["a", "b", "c"].map((device) => report({ device, severity: 3 })));
    assert.equal(r.level, 3);
  });

  it("ignores reports in other states", () => {
    const r = lagos([report({ device: "a", state: "kano" }), report({ device: "b", state: "kano" })]);
    assert.equal(r.level, 0);
  });

  it("drops reports older than 72 hours and downgrades after 24 hours", () => {
    assert.equal(lagos([report({ device: "a", at: hoursAgo(80) })]).level, 0);
    // two devices 30h ago: outside the 24h window but inside 72h -> Watch from the 72h rule
    const r = lagos([report({ device: "a", at: hoursAgo(30) }), report({ device: "b", at: hoursAgo(30) })]);
    assert.equal(r.level, 1);
  });

  it("forces Severe from a gauge above danger level with no reports", () => {
    const r = computeGround([], [gauge({ levelM: 12.5 })], NOW).find((l) => l.slug === "benue")!;
    assert.equal(r.level, 3);
    assert.equal(r.confidence, "corroborated");
  });

  it("sets High for a gauge between warning and danger", () => {
    const r = computeGround([], [gauge({ levelM: 11 })], NOW).find((l) => l.slug === "benue")!;
    assert.equal(r.level, 2);
  });

  it("ignores stale gauge readings and uses the latest reading per station", () => {
    const stale = gauge({ levelM: 13, at: hoursAgo(30) });
    assert.equal(computeGround([], [stale], NOW).find((l) => l.slug === "benue")!.level, 0);

    const olderHigh = gauge({ levelM: 13, at: hoursAgo(5) });
    const newerLow = gauge({ levelM: 8, at: hoursAgo(1) });
    assert.equal(computeGround([], [olderHigh, newerLow], NOW).find((l) => l.slug === "benue")!.level, 0);
  });
});

describe("community level rule", () => {
  const m = (...sev: number[]) => new Map(sev.map((s, i) => [`d${i}`, s]));

  it("is the same rule everywhere: 3 severe = Severe, 2 dangerous = High, any = Watch", () => {
    assert.equal(levelFromDevices(m()), 0);
    assert.equal(levelFromDevices(m(1)), 1);
    assert.equal(levelFromDevices(m(3)), 1, "one severe report is only a Watch");
    assert.equal(levelFromDevices(m(2, 3)), 2);
    assert.equal(levelFromDevices(m(1, 1, 2)), 1);
    assert.equal(levelFromDevices(m(3, 3, 3)), 3);
    assert.equal(levelFromDevices(m(3, 3, 2)), 2, "two severe and one dangerous is not three severe");
  });
});

describe("community level per local government", () => {
  const rep = (device: string, lga: string | undefined, severity: 1 | 2 | 3, at = hoursAgo(1)) => report({ device, lga, severity, at });

  it("counts only reports that named the LGA, and keeps LGAs apart", () => {
    const levels = computeLgaGround(
      [rep("a", "lagos-agege", 2), rep("b", "lagos-agege", 3), rep("c", "lagos-apapa", 3), rep("d", undefined, 3), rep("e", undefined, 3)],
      NOW,
    );
    assert.equal(levels.get("lagos-agege"), 2, "two people in Agege");
    assert.equal(levels.get("lagos-apapa"), 1, "one person in Apapa");
    assert.equal(levels.has("lagos-ikeja"), false);
    assert.equal(levels.size, 2, "reports with no LGA do not create one");
  });

  it("counts each device once and ignores reports older than a day", () => {
    const levels = computeLgaGround([rep("a", "lagos-agege", 3), rep("a", "lagos-agege", 3), rep("b", "lagos-agege", 3, hoursAgo(30))], NOW);
    assert.equal(levels.get("lagos-agege"), 1);
    assert.equal(computeLgaGround([rep("b", "lagos-agege", 3, hoursAgo(30))], NOW).size, 0);
  });
});
