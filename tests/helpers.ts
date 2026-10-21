import type { ForecastRisk } from "../lib/forecast";
import type { Gauge, Report } from "../lib/store";
import type { Level, Severity } from "../lib/types";
import { LEVEL_LABELS } from "../lib/types";

export const NOW = Date.parse("2026-10-18T12:00:00Z");
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

export function report(over: Partial<Report> & { device: string }): Report {
  return {
    id: Math.random().toString(36).slice(2),
    at: hoursAgo(1),
    state: "lagos",
    area: "Test area",
    severity: 2 as Severity,
    note: "",
    ...over,
  };
}

export function gauge(over: Partial<Gauge> = {}): Gauge {
  return {
    id: Math.random().toString(36).slice(2),
    at: hoursAgo(1),
    state: "benue",
    station: "Makurdi bridge",
    levelM: 9,
    warningM: 10.5,
    dangerM: 12,
    ...over,
  };
}

export function forecastRisk(level: Level, slug = "lagos"): ForecastRisk {
  return {
    slug,
    name: slug,
    capital: slug,
    inOutlook: true,
    level,
    label: LEVEL_LABELS[level],
    reasons: level ? [`forecast level ${level}`] : ["quiet"],
    rain: { dates: [], dailyMm: [], next3Mm: 0, peakDayMm: 0 },
    river: { currentM3s: null, peak7M3s: null, ratioToRecent: null },
    heat: { level: 0, label: "Normal", peakTmaxC: null, peakFeelsC: null, heatwave: false, reasons: ["No unusual heat in the 7-day forecast"] },
    days: [],
  };
}
