import { NextResponse } from "next/server";
import { badBody, checkSecret, cleanText, getSecret, hasJsonContentType, jsonError, readJsonObject, refuse } from "@/lib/http";
import { bySlug } from "@/lib/locations";
import { addGauge } from "@/lib/store";

export const dynamic = "force-dynamic";

// Partners (agencies, universities, NGOs with river gauges) push readings with a shared secret.
// GAUGE_API_KEY must be set and at least 24 characters, otherwise the endpoint stays disabled.
// POST /api/gauges  { state, station, levelM, warningM, dangerM }   header: x-api-key
export async function POST(req: Request) {
  const denied = checkSecret(req, getSecret("GAUGE_API_KEY"), req.headers.get("x-api-key") ?? "");
  if (denied) return denied;
  if (!hasJsonContentType(req)) return refuse("Content-Type must be application/json", 415);

  const body = await readJsonObject(req);
  if (!body) return badBody();

  const state = cleanText(body.state, 40);
  const station = cleanText(body.station, 80);
  const levelM = Number(body.levelM);
  const warningM = Number(body.warningM);
  const dangerM = Number(body.dangerM);

  if (!bySlug(state)) return jsonError("Unknown state", 400);
  if (!station) return jsonError("station is required", 400);
  if (![levelM, warningM, dangerM].every(Number.isFinite) || warningM >= dangerM) {
    return jsonError("levelM, warningM, dangerM must be numbers with warningM < dangerM", 400);
  }

  const gauge = await addGauge({ state, station, levelM, warningM, dangerM });
  return NextResponse.json({ ok: true, id: gauge.id }, { status: 201 });
}
