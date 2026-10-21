import type { Report, Snapshot } from "./store";
import { HOUR_MS } from "./types";

// Turns stored snapshots + reports into labelled training rows.
// Features = model inputs on a given day. Labels = what people reported in the next 72 hours.

export const LABEL_WINDOW_MS = 72 * HOUR_MS;

export const COLUMNS = [
  "date", "state", "month", "in_outlook", "rain_day0_mm", "rain_next3_mm", "rain_7d_mm", "rain_peak_mm",
  "river_ratio", "river_peak_m3s", "forecast_level", "label_any_report", "label_flood_72h",
] as const;

export type DatasetRow = (string | number)[];

/**
 * label_any_report: at least one report in the window.
 * label_flood_72h: at least 2 distinct devices reported "dangerous" or worse.
 * Snapshots whose window is still open are skipped, so no label is ever incomplete.
 */
export function buildDataset(snapshots: Snapshot[], reports: Report[], now = Date.now()) {
  const rows: DatasetRow[] = [];
  let skipped = 0;

  for (const s of snapshots) {
    const start = Date.parse(s.at);
    const end = start + LABEL_WINDOW_MS;
    if (end > now) {
      skipped++;
      continue;
    }
    const inWindow = reports.filter((r) => r.state === s.state && Date.parse(r.at) > start && Date.parse(r.at) <= end);
    const best = new Map<string, number>();
    for (const r of inWindow) best.set(r.device, Math.max(best.get(r.device) ?? 0, r.severity));
    const dangerous = [...best.values()].filter((v) => v >= 2).length;

    rows.push([
      s.date, s.state, s.month, s.inOutlook ? 1 : 0,
      s.rainDay0Mm.toFixed(1), s.rainNext3Mm.toFixed(1), s.rain7Mm.toFixed(1), s.rainPeakMm.toFixed(1),
      s.riverRatio?.toFixed(3) ?? "", s.riverPeakM3s?.toFixed(1) ?? "",
      s.forecastLevel, inWindow.length > 0 ? 1 : 0, dangerous >= 2 ? 1 : 0,
    ]);
  }
  return { rows, skipped };
}

export const toCsv = (rows: DatasetRow[]) => [COLUMNS.join(","), ...rows.map((r) => r.join(","))].join("\n");
