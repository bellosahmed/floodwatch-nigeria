// Optional bot protection with Cloudflare Turnstile (free, no tracking cookies, no puzzles for most people).
// It is the strongest practical defence against someone scripting fake flood reports from many devices.
// Enabled only when TURNSTILE_SECRET is set; the form then needs NEXT_PUBLIC_TURNSTILE_SITE_KEY too.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export const turnstileEnabled = () => Boolean(process.env.TURNSTILE_SECRET);

/** Fails closed: if the check cannot be completed, the report is refused. */
export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret || !token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] verification failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
