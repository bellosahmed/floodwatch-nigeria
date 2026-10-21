import { NextResponse } from "next/server";
import { guardAlertRequest, isResponse } from "@/lib/alerts/route-helpers";
import { startSubscription } from "@/lib/alerts/subscribe";
import { jsonError } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/alerts/subscribe
//   { phone, channel: "sms"|"whatsapp", state, lga?, hazard: "flood"|"heat"|"both", minLevel: 2|3, consent: true,
//     turnstileToken? }
// Sends a 6-digit code to the number. Nothing is active until the code is confirmed.
export async function POST(req: Request) {
  const guarded = await guardAlertRequest(req, "subscribe", { turnstile: true });
  if (isResponse(guarded)) return guarded;

  const result = await startSubscription(guarded.body, { store: await getStore(), config: guarded.config });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
