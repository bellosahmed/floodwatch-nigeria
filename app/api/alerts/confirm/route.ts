import { NextResponse } from "next/server";
import { guardAlertRequest, isResponse } from "@/lib/alerts/route-helpers";
import { confirmSubscription } from "@/lib/alerts/subscribe";
import { jsonError } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/alerts/confirm  { phone, channel, code }
export async function POST(req: Request) {
  const guarded = await guardAlertRequest(req, "confirm");
  if (isResponse(guarded)) return guarded;

  const result = await confirmSubscription(guarded.body, { store: await getStore(), config: guarded.config });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
