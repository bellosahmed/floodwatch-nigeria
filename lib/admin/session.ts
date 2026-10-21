import { createHmac } from "crypto";
import { safeEqual } from "../http";

// A moderator signs in once with ADMIN_API_KEY and gets a short-lived signed cookie. The key itself is never
// kept in the browser. The cookie is HttpOnly (page scripts cannot read it), SameSite=Strict (other sites cannot
// make the browser send it) and limited to /api/admin. It is an HMAC of its own expiry time, keyed by the admin
// key, so changing the key signs everyone out.

export const ADMIN_COOKIE = "fw_admin";
export const SESSION_TTL_S = 8 * 3600;
export const ADMIN_PATH = "/api/admin";

const sign = (secret: string, exp: string) => createHmac("sha256", secret).update(`admin-session:${exp}`).digest("base64url");

export function createSessionToken(secret: string, nowMs = Date.now(), ttlS = SESSION_TTL_S): string {
  const exp = String(Math.floor(nowMs / 1000) + ttlS);
  return `${exp}.${sign(secret, exp)}`;
}

export function verifySessionToken(secret: string, token: string | null | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 <= nowMs) return false;
  return safeEqual(sign(secret, exp), mac);
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

const attrs = (maxAge: number) =>
  `Path=${ADMIN_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export const sessionCookie = (token: string) => `${ADMIN_COOKIE}=${token}; ${attrs(SESSION_TTL_S)}`;
export const clearedCookie = () => `${ADMIN_COOKIE}=; ${attrs(0)}`;
