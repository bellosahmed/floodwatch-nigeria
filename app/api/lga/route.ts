import { NextResponse } from "next/server";
import { parseHazard } from "@/lib/hazard";
import { jsonError, PUBLIC_CORS } from "@/lib/http";
import { getLgaForecasts, rankLgas } from "@/lib/lga-forecast";
import { bySlug } from "@/lib/locations";

export const dynamic = "force-dynamic";

const HEADERS = { ...PUBLIC_CORS, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" };

// GET /api/lga?state=lagos[&hazard=heat]
// Local governments of a state ranked by who is affected first and worst in the next 16 days.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const state = params.get("state")?.toLowerCase() ?? "";
  if (!bySlug(state)) return jsonError("Pass ?state=<slug>, e.g. ?state=lagos", 400, PUBLIC_CORS);
  const hazard = parseHazard(params.get("hazard") ?? undefined);

  try {
    const forecast = await getLgaForecasts(state);
    const lgas = rankLgas(forecast.value, hazard);
    return NextResponse.json(
      {
        state,
        hazard,
        generatedAt: new Date().toISOString(),
        stale: forecast.stale, // true when the weather source is down and this is an earlier answer
        asOf: forecast.asOf,
        note: "Rainfall and temperature only (no river flow). Indicative guidance, not an official warning.",
        lgas,
      },
      { headers: HEADERS },
    );
  } catch (err) {
    console.error("[lga] forecast unavailable:", err instanceof Error ? err.message : err);
    return jsonError("Forecast source unavailable", 502, PUBLIC_CORS);
  }
}
