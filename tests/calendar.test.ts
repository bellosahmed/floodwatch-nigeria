import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthGrids, weekdayLabel } from "../lib/calendar";
import type { DayRisk } from "../lib/forecast";

const day = (date: string): DayRisk => ({
  date, phase: "future", rainMm: 1, level: 0, riverRatio: null, tmaxC: null, feelsC: null, heatLevel: 0, heatwave: false, confidence: "high",
});
const run = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) => day(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)));

describe("buildMonthGrids", () => {
  it("returns nothing for no days", () => {
    assert.deepEqual(buildMonthGrids([]), []);
  });

  it("starts weeks on Monday and pads before the first day", () => {
    // 2026-10-18 is a Sunday: six empty cells, then the 18th in the last column.
    const [grid] = buildMonthGrids(run("2026-10-18", 3));
    assert.equal(weekdayLabel("2026-10-18"), "Sun");
    assert.equal(grid.weeks[0].slice(0, 6).every((c) => c === null), true);
    assert.equal(grid.weeks[0][6]?.dayOfMonth, 18);
    assert.equal(grid.weeks[1][0]?.dayOfMonth, 19);
  });

  it("splits a window that crosses a month boundary into two grids", () => {
    const grids = buildMonthGrids(run("2026-10-25", 16)); // 25 Oct ... 9 Nov
    assert.deepEqual(grids.map((g) => g.key), ["2026-10", "2026-11"]);
    assert.equal(grids[0].title, "October 2026");
    assert.equal(grids[1].title, "November 2026");
    const count = (g: (typeof grids)[number]) => g.weeks.flat().filter(Boolean).length;
    assert.equal(count(grids[0]), 7); // 25..31 Oct
    assert.equal(count(grids[1]), 9); // 1..9 Nov
  });

  it("keeps every week exactly 7 wide and every day exactly once", () => {
    const days = run("2026-02-20", 16); // crosses a short month
    const grids = buildMonthGrids(days);
    assert.ok(grids.every((g) => g.weeks.every((w) => w.length === 7)));
    const dates = grids.flatMap((g) => g.weeks.flat()).filter(Boolean).map((c) => c!.date);
    assert.deepEqual(dates, days.map((d) => d.date));
  });
});
