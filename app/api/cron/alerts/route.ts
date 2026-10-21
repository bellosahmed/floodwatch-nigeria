import { NextResponse } from "next/server";
import { alertsConfig } from "@/lib/alerts/config";
import { runAlerts } from "@/lib/alerts/dispatch";
import { createLookup } from "@/lib/alerts/lookup";
import { getCombinedFeed } from "@/lib/combined";
import { checkSecret, getSecret, jsonError } from "@/lib/http";
import { computeLgaGround } from "@/lib/ground";
import { getLgaForecasts } from "@/lib/lga-forecast";
import { getStore } from "@/lib/store";
import { todayInNigeria } from "@/lib/time";
import { DAY_MS } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/cron/alerts   header: Authorization: Bearer $CRON_SECRET
// Decides who needs an alert and sends it. Unless ALERTS_LIVE=true it only REPORTS what it would send, so you can
// watch it for a while first. Run it once or twice a day, after the daily snapshot.
export async function GET(req: Request) {
  const secret = getSecret("CRON_SECRET");
  const denied = checkSecret(req, secret && `Bearer ${secret}`, req.headers.get("authorization") ?? "");
  if (denied) return denied;

  const config = alertsConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, skipped: config.reason });

  const feed = await getCombinedFeed();
  // Without a forecast there is nothing reliable to alert on (except ground reports, which the lookup still uses).
  if (!feed.forecastAvailable) console.warn("[alerts] forecast unavailable: only reports and gauges are used this run");

  try {
    const store = await getStore();
    const lgaGround = computeLgaGround(await store.reportsSince(Date.now() - DAY_MS));
    const summary = await runAlerts({
      store,
      config,
      lookup: createLookup({ feed, getLga: async (state) => (await getLgaForecasts(state)).value, lgaGround }),
      todayIso: todayInNigeria(),
      nowMs: Date.now(),
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[alerts] run failed:", err instanceof Error ? err.message : err);
    return jsonError("Alert run failed", 500);
  }
}
