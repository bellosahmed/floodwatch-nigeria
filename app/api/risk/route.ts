import { NextResponse } from "next/server";
import { getCombinedFeed } from "@/lib/combined";
import { jsonError, PUBLIC_CORS } from "@/lib/http";

export const dynamic = "force-dynamic";

const HEADERS = { ...PUBLIC_CORS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...HEADERS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}

// GET /api/risk            all states
// GET /api/risk?state=slug one state
// GET /api/risk?min=2      only states at level >= 2 (0 Low, 1 Watch, 2 High, 3 Severe)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state")?.toLowerCase();
  const min = Number(searchParams.get("min") ?? 0);

  const feed = await getCombinedFeed();
  let locations = feed.locations;
  if (state) locations = locations.filter((l) => l.slug === state);
  if (Number.isFinite(min) && min > 0) locations = locations.filter((l) => l.level >= min);

  if (state && !locations.length && !feed.locations.some((l) => l.slug === state)) {
    return jsonError(`Unknown state '${state}'`, 404, PUBLIC_CORS);
  }
  return NextResponse.json({ ...feed, locations }, { headers: HEADERS });
}
