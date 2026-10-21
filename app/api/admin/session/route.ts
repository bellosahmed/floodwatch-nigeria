import { NextResponse } from "next/server";
import { ADMIN_COOKIE, clearedCookie, createSessionToken, readCookie, sessionCookie, verifySessionToken } from "@/lib/admin/session";
import { badBody, checkSecret, cleanText, getSecret, hasJsonContentType, isSameOrigin, refuse, readJsonObject } from "@/lib/http";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

// GET    /api/admin/session  ->  { authenticated }
// POST   /api/admin/session  { key }  signs a moderator in (sets a cookie)
// DELETE /api/admin/session  signs out
export async function GET(req: Request) {
  const secret = getSecret("ADMIN_API_KEY");
  const authenticated = Boolean(secret && verifySessionToken(secret, readCookie(req, ADMIN_COOKIE)));
  return NextResponse.json({ authenticated }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return refuse("Cross-site requests are not allowed", 403);
  if (!hasJsonContentType(req)) return refuse("Content-Type must be application/json", 415);

  const body = await readJsonObject(req, 1_024);
  if (!body) return badBody();

  const secret = getSecret("ADMIN_API_KEY");
  const denied = checkSecret(req, secret, cleanText(body.key, 200)); // wrong keys are counted and locked out
  if (denied) return denied;

  const res = NextResponse.json({ authenticated: true }, { headers: NO_STORE });
  res.headers.append("Set-Cookie", sessionCookie(createSessionToken(secret!)));
  return res;
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return refuse("Cross-site requests are not allowed", 403);
  const res = NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  res.headers.append("Set-Cookie", clearedCookie());
  return res;
}
