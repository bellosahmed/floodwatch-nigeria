import type { NextResponse } from "next/server";
import { checkSecret, getSecret, isSameOrigin, refuse } from "../http";
import { ADMIN_COOKIE, readCookie, verifySessionToken } from "./session";

/**
 * Who may use the moderation endpoints: a script with the x-api-key header, or a signed-in moderator's cookie.
 * Returns null when allowed, otherwise the response to send. A request with no credentials at all is simply refused:
 * it is not a password guess, so it does not count towards the lockout.
 */
export function adminAuth(req: Request, options: { mutates?: boolean } = {}): NextResponse | null {
  const secret = getSecret("ADMIN_API_KEY");
  const key = req.headers.get("x-api-key");

  if (key !== null) return checkSecret(req, secret, key);

  if (secret && verifySessionToken(secret, readCookie(req, ADMIN_COOKIE))) {
    // Cookies are sent automatically by browsers, so a request that changes anything must also come from this site.
    if (options.mutates && !isSameOrigin(req)) return refuse("Cross-site requests are not allowed", 403);
    return null;
  }
  return refuse("Unauthorised", 401);
}
