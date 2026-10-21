import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/health  ->  200 when the database answers, 503 when it does not.
// Point an uptime monitor here. It deliberately does not call the weather API (that would burn the free quota
// on every check) and reveals nothing about the server beyond which kind of storage is in use.
export async function GET() {
  try {
    const store = await getStore();
    await store.ping();
    return NextResponse.json({ ok: true, store: store.kind, time: new Date().toISOString() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[health] store unreachable:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "storage unreachable" }, { status: 503, headers: NO_STORE });
  }
}
