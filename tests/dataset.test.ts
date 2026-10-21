import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDataset, COLUMNS, toCsv } from "../lib/dataset";
import type { Snapshot } from "../lib/store";
import { hoursAgo, NOW, report } from "./helpers";

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  date: "2026-10-10",
  at: hoursAgo(120),
  state: "lagos",
  month: 10,
  inOutlook: true,
  rainDay0Mm: 5,
  rainNext3Mm: 30,
  rain7Mm: 60,
  rainPeakMm: 20,
  riverRatio: 1.2,
  riverPeakM3s: 300,
  forecastLevel: 1,
  ...over,
});

describe("buildDataset", () => {
  it("skips snapshots whose 72h label window is still open", () => {
    const { rows, skipped } = buildDataset([snap({ at: hoursAgo(10) })], [], NOW);
    assert.equal(rows.length, 0);
    assert.equal(skipped, 1);
  });

  it("labels a flood only when 2+ distinct devices report dangerous or worse in the window", () => {
    const reports = [
      report({ device: "a", severity: 2, at: hoursAgo(100) }),
      report({ device: "b", severity: 3, at: hoursAgo(90) }),
    ];
    const [row] = buildDataset([snap()], reports, NOW).rows;
    assert.equal(row[COLUMNS.indexOf("label_any_report")], 1);
    assert.equal(row[COLUMNS.indexOf("label_flood_72h")], 1);
  });

  it("does not label a flood from one device, or from reports outside the window", () => {
    const oneDevice = [report({ device: "a", severity: 3, at: hoursAgo(100) }), report({ device: "a", severity: 3, at: hoursAgo(99) })];
    assert.equal(buildDataset([snap()], oneDevice, NOW).rows[0][COLUMNS.indexOf("label_flood_72h")], 0);

    const before = [report({ device: "a", at: hoursAgo(130) }), report({ device: "b", at: hoursAgo(130) })];
    const [row] = buildDataset([snap()], before, NOW).rows;
    assert.equal(row[COLUMNS.indexOf("label_any_report")], 0);
  });

  it("ignores reports from other states and writes valid CSV", () => {
    const other = [report({ device: "a", state: "kano", at: hoursAgo(100) })];
    const { rows } = buildDataset([snap({ riverRatio: null, riverPeakM3s: null })], other, NOW);
    assert.equal(rows[0][COLUMNS.indexOf("label_any_report")], 0);
    const csv = toCsv(rows).split("\n");
    assert.equal(csv[0], COLUMNS.join(","));
    assert.equal(csv[1].split(",").length, COLUMNS.length);
  });
});
