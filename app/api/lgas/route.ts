import { NextResponse } from "next/server";
import { jsonError, PUBLIC_CORS } from "@/lib/http";
import { LGA_META, lgasOf } from "@/lib/lgas";
import { bySlug } from "@/lib/locations";

const HEADERS = { ...PUBLIC_CORS, "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

// GET /api/lgas?state=lagos  ->  the local governments of a state (static data)
export function GET(req: Request) {
  const state = new URL(req.url).searchParams.get("state")?.toLowerCase() ?? "";
  if (!bySlug(state)) return jsonError("Pass ?state=<slug>, e.g. ?state=lagos", 400, PUBLIC_CORS);
  return NextResponse.json(
    { state, source: LGA_META.source, note: LGA_META.note, lgas: lgasOf(state).map(({ slug, name, lat, lon }) => ({ slug, name, lat, lon })) },
    { headers: HEADERS },
  );
}
