import { NextResponse } from "next/server";
import { cleanText, clientIp, hasJsonContentType, isSameOrigin, jsonError, RateLimiter, readJsonObject, refuse, badBody } from "../http";
import { HOUR_MS } from "../types";
import { alertsConfig, type AlertsConfig } from "./config";
import { verifyTurnstile, turnstileEnabled } from "../turnstile";

// Shared guard for the public alert endpoints (sign-up, confirm, unsubscribe). Cheap checks first, so abusive
// requests cost as little as possible, in the same order as the report endpoint.

const limiters = {
  subscribe: new RateLimiter(5, HOUR_MS),
  confirm: new RateLimiter(20, HOUR_MS),
  unsubscribe: new RateLimiter(30, HOUR_MS),
};

type Enabled = Extract<AlertsConfig, { enabled: true }>;

export async function guardAlertRequest(
  req: Request,
  kind: keyof typeof limiters,
  options: { turnstile?: boolean } = {},
): Promise<{ body: Record<string, unknown>; config: Enabled } | NextResponse> {
  const config = alertsConfig();
  if (!config.enabled) return jsonError("Alerts are not available yet.", 404);
  if (!isSameOrigin(req)) return refuse("Cross-site requests are not allowed", 403);
  if (!hasJsonContentType(req)) return refuse("Content-Type must be application/json", 415);

  const ip = clientIp(req);
  if (!limiters[kind].allow(ip)) return refuse("Too many attempts from this network. Please try later.", 429);

  const body = await readJsonObject(req);
  if (!body) return badBody();

  if (options.turnstile && turnstileEnabled() && !(await verifyTurnstile(cleanText(body.turnstileToken, 2048), ip))) {
    return jsonError("Verification failed. Please reload the page and try again.", 403);
  }
  return { body, config };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;
