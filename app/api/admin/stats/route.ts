import { NextResponse } from "next/server";
import { alertsConfig } from "@/lib/alerts/config";
import { adminAuth } from "@/lib/admin/auth";
import { getStore } from "@/lib/store";
import { DAY_MS } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/admin/stats: how the alert service is doing. Counts only: no phone numbers, ever.
export async function GET(req: Request) {
  const denied = adminAuth(req);
  if (denied) return denied;

  const store = await getStore();
  const since = Date.now() - DAY_MS;
  const [subs, codes, alerts] = await Promise.all([
    store.subscriptionStats(),
    store.countSends({ sinceMs: since, kind: "otp" }),
    store.countSends({ sinceMs: since, kind: "alert" }),
  ]);
  const config = alertsConfig();

  return NextResponse.json(
    {
      store: store.kind,
      subscribers: subs,
      last24h: { codesSent: codes, alertsSent: alerts },
      alerts: config.enabled
        ? { enabled: true, provider: config.messenger.name, live: config.live, dailyCap: config.dailyCap }
        : { enabled: false, reason: config.reason },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
