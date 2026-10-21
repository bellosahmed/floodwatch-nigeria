import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { HOUR_MS } from "./types";

export const PUBLIC_CORS = { "Access-Control-Allow-Origin": "*" } as const;

export function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

// ---------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------

export const MIN_SECRET_LENGTH = 24;
const warned = new Set<string>();

/**
 * Read a secret from the environment. A missing secret disables the endpoint that needs it, and so does a
 * guessable one: anything shorter than MIN_SECRET_LENGTH is refused, with a warning in the server log.
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function getSecret(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  if (value.length < MIN_SECRET_LENGTH) {
    if (!warned.has(name)) {
      warned.add(name);
      console.error(`[security] ${name} is shorter than ${MIN_SECRET_LENGTH} characters and was ignored. The endpoint stays disabled.`);
    }
    return null;
  }
  return value;
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Response for a request we refused before reading its body (blocked, rate-limited, too big, or not JSON). The Connection: close header makes the
 * server hang up right after answering. Without it the socket would stay open while a client keeps trickling in
 * data we have stopped reading, which is a cheap way to tie up connections (a slow-upload attack).
 */
export const refuse = (message: string, status: number) => jsonError(message, status, { Connection: "close" });
export const badBody = () => refuse("Invalid or oversized JSON body", 400);

// ---------------------------------------------------------------------------------------------
// Request reading and validation
// ---------------------------------------------------------------------------------------------

/**
 * Parse a JSON object body with a hard size cap. The body is read as a stream and abandoned as soon as it
 * exceeds the cap, so a client that lies about (or omits) Content-Length cannot make the server buffer a huge
 * payload. Returns null for anything that is not a plain JSON object.
 */
export async function readJsonObject(req: Request, maxBytes = 8_192): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Only accept real JSON requests. A browser cannot send this content type cross-site without a CORS preflight. */
export const hasJsonContentType = (req: Request) => (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");

/**
 * Block cross-site form posts (CSRF). Browsers always send Origin (and Sec-Fetch-Site) on cross-site POSTs, so
 * those are checked. Non-browser clients such as curl or a partner's server send neither, and are allowed:
 * CSRF is a browser-only attack. Set SITE_ORIGIN (for example https://floodwatch.example) to pin the allowed origin.
 */
export function isSameOrigin(req: Request, pinnedOrigin = process.env.SITE_ORIGIN): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (pinnedOrigin) return origin === pinnedOrigin.replace(/\/$/, "");
  try {
    return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

/** Trim, strip control characters and cap length. React escapes output, this keeps stored data tidy. */
export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|org|net|io|me|ly|co|info|biz|xyz|app|link)\b\S*/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 7+ digits, optionally separated by single spaces, dots, dashes or brackets. Must start and end on a digit,
// so the space after a number is kept.
const PHONE = /\+?\d(?:[\s().-]?\d){6,}/g;

/**
 * Public reports are shown to everyone, so strip links (spam, phishing), emails and phone numbers (privacy,
 * harassment) before storing them. This is a safety net, not a complete moderation system.
 */
export function redactContactDetails(text: string): string {
  return text
    .replace(LINK, "[link removed]")
    .replace(EMAIL, "[email removed]")
    .replace(BARE_DOMAIN, "[link removed]")
    .replace(PHONE, "[number removed]");
}

// ---------------------------------------------------------------------------------------------
// Client identity and rate limiting
// ---------------------------------------------------------------------------------------------

/**
 * Best-effort client IP for abuse limits only. The leftmost X-Forwarded-For value is supplied by the client and
 * can be forged, so by default this uses the rightmost one, which the nearest proxy added. Behind a CDN, name the
 * header your platform sets with TRUSTED_IP_HEADER (for example cf-connecting-ip on Cloudflare), otherwise every
 * visitor would share the CDN's address.
 */
export function clientIp(req: Request): string {
  const trusted = process.env.TRUSTED_IP_HEADER?.toLowerCase();
  if (trusted) {
    const value = req.headers.get(trusted)?.split(",")[0].trim();
    if (value) return value;
  }
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.length ? forwarded[forwarded.length - 1] : "unknown";
}

/**
 * Sliding-window limiter held in memory (per server instance). Old keys are pruned and the table has a hard
 * size cap, so a flood of forged addresses cannot exhaust memory. On serverless hosts each instance has its own
 * table, so treat this as a brake, not a guarantee: use the platform's firewall or Turnstile for real protection.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    this.prune(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest); // evict rather than grow without bound
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private prune(now: number) {
    if (now - this.lastPrune < this.windowMs) return;
    this.lastPrune = now;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Counts failed secret guesses per address, to slow brute-forcing of API keys. */
const failedAuth = new RateLimiter(10, HOUR_MS);

/**
 * Check a secret-protected request. A correct secret always passes. A wrong one returns 401, and after 10 wrong
 * guesses from the same address in an hour, 429.
 */
export function checkSecret(req: Request, expected: string | null, given: string): NextResponse | null {
  if (expected && safeEqual(expected, given)) return null;
  if (!failedAuth.allow(clientIp(req))) return refuse("Too many failed attempts. Try again later.", 429);
  return refuse("Unauthorised", 401);
}
