import { NextResponse } from "next/server";
import { guardAlertRequest, isResponse } from "@/lib/alerts/route-helpers";
import { unsubscribe } from "@/lib/alerts/subscribe";
import { cleanText, jsonError } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/alerts/unsubscribe  { code }   (the code from the stop link in every message)
// This is a POST on purpose: opening a link must not unsubscribe anyone, because email and phone link scanners
// open links automatically. The /u/<code> page asks for one tap, which calls this.
export async function POST(req: Request) {
  const guarded = await guardAlertRequest(req, "unsubscribe");
  if (isResponse(guarded)) return guarded;

  const result = await unsubscribe(cleanText(guarded.body.code, 40), await getStore());
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
