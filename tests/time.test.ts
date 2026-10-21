import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLongDate, formatTimeNigeria, monthInNigeria, todayInNigeria } from "../lib/time";

describe("Nigeria time", () => {
  it("is one hour ahead of UTC, so the date turns over at 23:00 UTC", () => {
    // 22:59 UTC is still the 17th in Nigeria (23:59 WAT); 23:00 UTC is already the 18th (00:00 WAT).
    assert.equal(todayInNigeria(new Date("2026-10-17T22:59:00Z")), "2026-10-17");
    assert.equal(todayInNigeria(new Date("2026-10-17T23:00:00Z")), "2026-10-18");
    assert.equal(todayInNigeria(new Date("2026-10-18T12:00:00Z")), "2026-10-18");
  });

  it("rolls the month and year over at Nigerian midnight", () => {
    assert.equal(monthInNigeria(new Date("2026-10-31T22:30:00Z")), 10);
    assert.equal(monthInNigeria(new Date("2026-10-31T23:30:00Z")), 11);
    assert.equal(todayInNigeria(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  });

  it("formats dates and times for people", () => {
    assert.equal(formatLongDate("2026-10-18"), "Sunday, 18 October 2026");
    assert.equal(formatLongDate("2027-01-01"), "Friday, 1 January 2027");
    assert.equal(formatTimeNigeria(new Date("2026-10-18T13:05:00Z")), "14:05 WAT");
  });
});

describe("short date helpers", () => {
  it("give the same text on every machine", async () => {
    const { shortDay, dayMonth, dayLabel } = await import("../lib/format");
    assert.equal(shortDay("2026-11-03"), "Tue 3 Nov");
    assert.equal(dayMonth("2026-11-03"), "3 Nov");
    assert.equal(dayLabel("2026-10-18", "2026-10-18"), "Today");
    assert.equal(dayLabel("2026-10-19", "2026-10-18"), "Tomorrow");
    assert.equal(dayLabel("2026-11-03", "2026-10-18"), "Tue 3 Nov");
  });
});
