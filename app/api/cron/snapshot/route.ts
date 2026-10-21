import { NextResponse } from "next/server";
import { getForecastFeed } from "@/lib/forecast";
import { checkSecret, getSecret, jsonError } from "@/lib/http";
import { addSnapshots, pruneStore, type Snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// CRON_SECRET must be set and at least 24 characters, otherwise this endpoint stays disabled.
// Run once a day from a scheduler:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/snapshot
// It records each state's model inputs so they can later be paired with community reports.
export async function GET(req: Request) {
  const secret = getSecret("CRON_SECRET");
  const denied = checkSecret(req, secret && `Bearer ${secret}`, req.headers.get("authorization") ?? "");
  if (denied) return denied;

  let feed;
  try {
    feed = await getForecastFeed();
  } catch (err) {
    console.error("[snapshot] forecast source unavailable:", err instanceof Error ? err.message : err);
    return jsonError("Forecast source unavailable, nothing recorded", 502);
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const rows: Snapshot[] = feed.locations.map((l) => ({
    date,
    at: now.toISOString(),
    state: l.slug,
    month: now.getUTCMonth() + 1,
    inOutlook: l.inOutlook,
    rainDay0Mm: l.rain.dailyMm[0] ?? 0,
    rainNext3Mm: l.rain.next3Mm,
    rain7Mm: l.rain.dailyMm.reduce((a, b) => a + b, 0),
    rainPeakMm: l.rain.peakDayMm,
    riverRatio: l.river.ratioToRecent,
    riverPeakM3s: l.river.peak7M3s,
    forecastLevel: l.level,
  }));

  const added = await addSnapshots(rows);
  await pruneStore(); // keep storage within its retention limits
  return NextResponse.json({ ok: true, date, added, skippedAsDuplicates: rows.length - added });
}
