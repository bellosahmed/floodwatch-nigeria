import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/admin/auth";
import { badBody, cleanText, hasJsonContentType, jsonError, readJsonObject, refuse } from "@/lib/http";
import { lgaBySlug } from "@/lib/lgas";
import { bySlug } from "@/lib/locations";
import { listReports, setReportHidden } from "@/lib/store";

export const dynamic = "force-dynamic";

// Moderation. Needs ADMIN_API_KEY (24+ characters), sent as the x-api-key header, or a moderator signed in at /admin
// (a signed cookie). No CORS headers are sent, so browsers on other sites cannot call it.
//
//   GET  /api/admin/reports?state=lagos&limit=50     newest first, includes hidden reports
//   POST /api/admin/reports  { "id": "...", "hidden": true, "alsoSameDevice": false }
//
// Hiding keeps the report in the database but removes it from every public page, the API, alert levels and the
// training data. "alsoSameDevice" hides everything from the same anonymous device, for spam.
export async function GET(req: Request) {
  const denied = adminAuth(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const state = params.get("state")?.toLowerCase() || undefined;
  if (state && !bySlug(state)) return jsonError("Unknown state", 400);
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);

  const reports = await listReports({ state, limit });
  return NextResponse.json(
    {
      reports: reports.map(({ id, at, state, lga, area, severity, note, hidden, device }) => ({
        id, at, state, lga, lgaName: lga ? lgaBySlug(lga)?.name : undefined, area, severity, note, hidden: Boolean(hidden),
        deviceTag: device.slice(0, 8), // enough to spot one device posting repeatedly, not enough to identify anyone
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const denied = adminAuth(req, { mutates: true });
  if (denied) return denied;
  if (!hasJsonContentType(req)) return refuse("Content-Type must be application/json", 415);

  const body = await readJsonObject(req);
  if (!body) return badBody();

  const id = cleanText(body.id, 64);
  if (!id) return jsonError("id is required", 400);
  const hidden = body.hidden === undefined ? true : body.hidden === true;
  const changed = await setReportHidden(id, hidden, body.alsoSameDevice === true);

  return NextResponse.json({ ok: true, changed }, { headers: { "Cache-Control": "no-store" } });
}
