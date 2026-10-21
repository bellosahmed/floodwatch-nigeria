import { NextResponse } from "next/server";
import { CLIMATE_META, SEASON_LABELS, typicalMonths } from "@/lib/climatology";
import { jsonError, PUBLIC_CORS } from "@/lib/http";
import { bySlug } from "@/lib/locations";

const HEADERS = { ...PUBLIC_CORS, "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

// GET /api/climatology?state=lagos  ->  twelve typical months for one state
export function GET(req: Request) {
  const state = new URL(req.url).searchParams.get("state")?.toLowerCase() ?? "";
  if (!bySlug(state)) return jsonError("Pass ?state=<slug>, e.g. ?state=lagos", 400, PUBLIC_CORS);

  return NextResponse.json(
    {
      state,
      note: "Typical conditions from historical rainfall. Not a forecast for any particular year.",
      period: CLIMATE_META.period,
      source: CLIMATE_META.source,
      seasonLabels: SEASON_LABELS,
      months: typicalMonths(state),
    },
    { headers: HEADERS },
  );
}
