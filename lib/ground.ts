import { LOCATIONS } from "./locations";
import { gaugesSince, reportsSince, type Gauge, type Report } from "./store";
import { DAY_MS, GROUND_LABELS, type Level } from "./types";

// Ground layer: what people and river gauges are reporting right now. Data this service owns.

export type Confidence = "none" | "unverified" | "corroborated";

export type GroundRisk = {
  slug: string;
  name: string;
  capital: string;
  inOutlook: boolean;
  level: Level;
  label: (typeof GROUND_LABELS)[number];
  confidence: Confidence;
  reasons: string[];
  counts: { reporters24h: number; reporters72h: number; severe24h: number; dangerous24h: number };
  gauges: { station: string; levelM: number; warningM: number; dangerM: number; at: string }[];
  lastReportAt: string | null;
};

const within = (iso: string, windowMs: number, now: number) => now - Date.parse(iso) <= windowMs;

/** Each device counts once, at the highest severity it reported. */
function bestByDevice(reports: Report[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const r of reports) best.set(r.device, Math.max(best.get(r.device) ?? 0, r.severity));
  return best;
}

const countAtLeast = (m: Map<string, number>, severity: number) => [...m.values()].filter((s) => s >= severity).length;

/** The community rule, in one place: 3+ people reporting severe is Severe, 2+ reporting dangerous is High, any report is Watch. */
export function levelFromDevices(best: Map<string, number>): Level {
  if (countAtLeast(best, 3) >= 3) return 3;
  if (countAtLeast(best, 2) >= 2) return 2;
  return best.size >= 1 ? 1 : 0;
}

/** Community level for each local government, from reports in the last 24 hours that named one. */
export function computeLgaGround(reports: Report[], now = Date.now()): Map<string, Level> {
  const byLga = new Map<string, Report[]>();
  for (const r of reports) {
    if (!r.lga || !within(r.at, DAY_MS, now)) continue;
    byLga.set(r.lga, [...(byLga.get(r.lga) ?? []), r]);
  }
  return new Map([...byLga].map(([lga, rs]) => [lga, levelFromDevices(bestByDevice(rs))]));
}

/** Pure: same inputs always give the same output, so it is easy to test. */
export function computeGround(reports: Report[], gauges: Gauge[], now = Date.now()): GroundRisk[] {
  return LOCATIONS.map((loc): GroundRisk => {
    const mine = reports.filter((r) => r.state === loc.slug);
    const d24 = bestByDevice(mine.filter((r) => within(r.at, DAY_MS, now)));
    const d72 = bestByDevice(mine.filter((r) => within(r.at, 3 * DAY_MS, now)));
    const severe = countAtLeast(d24, 3);
    const dangerous = countAtLeast(d24, 2);

    // Latest reading per station within 24 hours; older readings are stale and ignored.
    const latest = new Map<string, Gauge>();
    for (const g of gauges) {
      if (g.state !== loc.slug || !within(g.at, DAY_MS, now)) continue;
      const cur = latest.get(g.station);
      if (!cur || Date.parse(g.at) > Date.parse(cur.at)) latest.set(g.station, g);
    }
    const stations = [...latest.values()];

    let reportLevel = levelFromDevices(d24);
    if (reportLevel === 0 && d72.size >= 2) reportLevel = 1; // a couple of reports in the last 3 days is worth a Watch

    let gaugeLevel: Level = 0;
    const gaugeReasons: string[] = [];
    for (const g of stations) {
      if (g.levelM >= g.dangerM) {
        gaugeLevel = 3;
        gaugeReasons.push(`${g.station} gauge at ${g.levelM} m, above danger level (${g.dangerM} m)`);
      } else if (g.levelM >= g.warningM) {
        gaugeLevel = Math.max(gaugeLevel, 2) as Level;
        gaugeReasons.push(`${g.station} gauge at ${g.levelM} m, above warning level (${g.warningM} m)`);
      }
    }

    const level = Math.max(reportLevel, gaugeLevel) as Level;
    const reasons: string[] = [];
    if (severe >= 3) reasons.push(`${severe} independent people report severe flooding in the last 24 hours`);
    else if (dangerous >= 2) reasons.push(`${dangerous} independent people report dangerous flooding in the last 24 hours`);
    else if (d24.size >= 1) reasons.push(`${d24.size} unverified report${d24.size > 1 ? "s" : ""} in the last 24 hours`);
    else if (d72.size >= 2) reasons.push(`${d72.size} reports in the last 72 hours`);
    reasons.push(...gaugeReasons);
    if (!reasons.length) reasons.push("No reports received. This does not mean the area is safe.");

    const confidence: Confidence =
      gaugeLevel > 0 || d24.size >= 2 ? "corroborated" : d24.size === 1 || d72.size >= 1 ? "unverified" : "none";

    return {
      slug: loc.slug,
      name: loc.name,
      capital: loc.capital,
      inOutlook: loc.inOutlook,
      level,
      label: GROUND_LABELS[level],
      confidence,
      reasons,
      counts: { reporters24h: d24.size, reporters72h: d72.size, severe24h: severe, dangerous24h: dangerous },
      gauges: stations.map(({ station, levelM, warningM, dangerM, at }) => ({ station, levelM, warningM, dangerM, at })),
      lastReportAt: mine.reduce<string | null>((latestAt, r) => (!latestAt || r.at > latestAt ? r.at : latestAt), null),
    };
  });
}

export async function getGroundFeed(): Promise<GroundRisk[]> {
  const now = Date.now();
  // Only the windows the scoring actually looks at: 72 hours of reports, 24 hours of gauge readings.
  const [reports, gauges] = await Promise.all([reportsSince(now - 3 * DAY_MS), gaugesSince(now - DAY_MS)]);
  return computeGround(reports, gauges, now);
}

/** Distinct people who reported in each LGA of a state over the last 72 hours. */
export async function getLgaReportCounts(stateSlug: string): Promise<Map<string, number>> {
  const reports = await reportsSince(Date.now() - 3 * DAY_MS);
  const devices = new Map<string, Set<string>>();
  for (const r of reports) {
    if (r.state !== stateSlug || !r.lga) continue;
    devices.set(r.lga, (devices.get(r.lga) ?? new Set()).add(r.device));
  }
  return new Map([...devices].map(([lga, set]) => [lga, set.size]));
}

/** Public view of recent reports. The device hash never leaves the server. */
export async function getRecentReports(slug: string, limit = 20) {
  const reports = await reportsSince(Date.now() - 3 * DAY_MS);
  return reports
    .filter((r) => r.state === slug)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
    .map(({ at, area, severity, note, lga }) => ({ at, area, severity, note, lga }));
}
