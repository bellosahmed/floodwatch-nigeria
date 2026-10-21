import { NextResponse } from "next/server";
import {
  badBody,
  cleanText,
  clientIp,
  hasJsonContentType,
  isSameOrigin,
  jsonError,
  RateLimiter,
  refuse,
  readJsonObject,
  redactContactDetails,
} from "@/lib/http";
import { lgaBySlug } from "@/lib/lgas";
import { bySlug } from "@/lib/locations";
import { addReport, hashDevice } from "@/lib/store";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";
import { HOUR_MS, type Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

const ipLimiter = new RateLimiter(20, HOUR_MS);

// POST /api/reports  { state, lga?, area, severity: 1|2|3, note?, deviceId, turnstileToken? }
export async function POST(req: Request) {
  // Cheap checks first, so abusive requests cost as little as possible.
  if (!isSameOrigin(req)) return refuse("Cross-site requests are not allowed", 403);
  if (!hasJsonContentType(req)) return refuse("Content-Type must be application/json", 415);

  const ip = clientIp(req);
  if (!ipLimiter.allow(ip)) return refuse("Too many reports from this network. Try later.", 429);

  const body = await readJsonObject(req);
  if (!body) return badBody();

  if (turnstileEnabled() && !(await verifyTurnstile(cleanText(body.turnstileToken, 2048), ip))) {
    return jsonError("Verification failed. Please reload the page and try again.", 403);
  }

  const state = cleanText(body.state, 40);
  const lga = cleanText(body.lga, 80);
  const area = redactContactDetails(cleanText(body.area, 80));
  const note = redactContactDetails(cleanText(body.note, 200));
  const severity = Number(body.severity);
  const deviceId = cleanText(body.deviceId, 64);

  if (!bySlug(state)) return jsonError("Unknown state", 400);
  if (lga && lgaBySlug(lga)?.state !== state) return jsonError("That local government is not in the chosen state", 400);
  if (area.length < 2) return jsonError("Please say where (community or street)", 400);
  if (![1, 2, 3].includes(severity)) return jsonError("Severity must be 1, 2 or 3", 400);
  if (deviceId.length < 8) return jsonError("Missing device id", 400);

  const result = await addReport({
    state,
    lga: lga || undefined,
    area,
    note,
    severity: severity as Severity,
    device: hashDevice(deviceId),
  });
  if (!result.ok) return jsonError("Report limit reached for this device. Try again in an hour.", 429);
  return NextResponse.json({ ok: true, id: result.report.id }, { status: 201 });
}
