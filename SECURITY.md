# Security

FloodWatch publishes flood and heat warnings that people may act on, so the main security goals are:
**nobody can forge a warning, nobody can take the site or its data, and reporters stay anonymous.**

## What is protected, and how

| Threat | Defence | Where |
|---|---|---|
| Forged community reports raising a false alarm | Each device counts once; 2+ devices needed for High, 3+ for Severe; per-device (5/hr) and per-address (20/hr) limits; optional Cloudflare Turnstile bot check | `lib/ground.ts`, `lib/store/`, `lib/turnstile.ts` |
| A malicious website making visitors' browsers submit reports (CSRF) | JSON-only content type, plus Origin and Sec-Fetch-Site checks; pin with `SITE_ORIGIN` | `lib/http.ts` |
| Guessing the gauge or cron key | Constant-time comparison, secrets under 24 characters refused, lockout after 10 wrong guesses per address per hour | `lib/http.ts` |
| Oversized or endless request bodies | Body is streamed and abandoned at 8 KB, even without a Content-Length | `lib/http.ts` |
| Memory exhaustion from forged addresses | Rate-limit table has a hard size cap with eviction | `lib/http.ts` |
| Links, phone numbers and emails posted in public reports | Redacted before storing | `lib/http.ts` |
| Cross-site scripting | React escapes all output; no raw HTML is ever rendered; strict Content-Security-Policy | `next.config.ts` |
| Clickjacking, MIME sniffing, downgrade to HTTP | `frame-ancestors 'none'`, `nosniff`, HSTS (production) | `next.config.ts` |
| Database theft or silent loss | Postgres in production; the dev file store is owner-only (0600) and a corrupt file stops the app instead of being overwritten | `lib/store/` |
| Reporter identity | No name or phone is collected; only a SHA-256 hash of a random browser id is stored; raw ids and hashes never leave the server | `lib/store/`, `lib/ground.ts` |
| Bypassing the per-device report limit with simultaneous requests | Per-device lock inside a transaction. Measured: a burst of 25 let 10-11 reports through without it, exactly 5 with it | `lib/store/postgres.ts` |
| Fake or abusive reports already posted | Moderator can hide a report, or everything from one device, via `/api/admin/reports`. Hidden reports leave every public view, the alert levels and the training data | `app/api/admin/reports/route.ts` |
| Image-processing library flaws | Image optimizer disabled (the site shows no images) | `next.config.ts` |
| Phone numbers leaking from the database | Encrypted (AES-256-GCM) with a key outside the database; looked up by keyed hash; never shown in the admin screen or logs; deleted on unsubscribe; unconfirmed sign-ups deleted after a day | `lib/alerts/pii.ts`, `lib/store/` |
| Enrolling someone else's number, or spamming strangers with codes | Number must be confirmed with a one-time code before anything starts; codes are keyed to the phone; already-subscribed numbers get an identical answer and no message (no enumeration) | `lib/alerts/subscribe.ts` |
| Guessing the 6-digit code, even in parallel | 5 tries then locked; the check holds a row lock so parallel guesses cannot beat the counter (measured: 20 parallel guesses all evaluated without the lock, exactly 5 with it) | `lib/store/postgres.ts` |
| SMS-pumping fraud (running up the message bill) | Codes per number per day, per-network limit, optional Turnstile, and a hard daily cap on all messages | `lib/alerts/` |
| A false alarm sent by SMS | Off by default (`ALERTS_LIVE`); only High or Severe; one message per episode; unofficial wording in every message | `lib/alerts/dispatch.ts` |
| Moderator account takeover | Signed HttpOnly, SameSite=Strict cookie limited to `/api/admin`; the key is never kept in the browser; origin check on every change; wrong keys are locked out | `lib/admin/` |
| Slow-upload attacks holding connections open | Refused requests close the connection | `lib/http.ts` |

## Before you go live

1. **Set `DATABASE_URL`** and strong secrets (see `.env.example`). Short secrets are refused.
2. **Set `PII_ENCRYPTION_KEY` and back it up** if you offer alerts. **Set `SITE_ORIGIN`** to your public address.
3. **Set `TRUSTED_IP_HEADER`** if you sit behind a CDN, or every visitor shares one address.
4. **Turn on Turnstile** (`TURNSTILE_SECRET` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`). This is the single most useful
   defence against fake reports.
5. Run `npm audit --omit=dev` before each release (it is clean today: Node 22 and Next.js 16 are in place).
6. **Serve over HTTPS only.**

## Known limits (be honest with users and partners)

- **Anonymous reports can still be gamed.** Without Turnstile, a determined person with many IP addresses can fake
  several devices. With it, the cost rises sharply but is not infinite. Gauge readings from partner agencies are the
  trusted layer, and reports alone should never trigger an official alert.
- **Rate limits are per server instance.** On serverless hosts each instance has its own counters, so they slow
  abuse but do not stop it. Add your platform's firewall or rate-limiting rules.
- **Real SMS/WhatsApp delivery is untested.** The Termii and Twilio adapters follow the providers' documentation and pass mocked-request tests, but no real message has been sent. Test with your own number first.
- **Alert thresholds are uncalibrated.** Until NiMet or NiHSA review them, keep `ALERTS_LIVE` off or limit it to a small trial.
- **Nigerian data protection law.** Holding phone numbers is processing personal data: get legal advice on registration and notices before launch.
- **A single moderator key.** There are no individual moderator accounts or audit log yet.
- **Content-Security-Policy allows inline scripts** because Next.js needs them to start. This is acceptable only
  because the app renders no user-supplied HTML. Keep it that way.
- **Accepted audit findings:** five high-severity findings remain in the lint tooling (`eslint-config-next` and its glob
  dependencies). It is a build-time dev dependency that is never deployed, and `npm audit --omit=dev` reports 0.

## Reporting a vulnerability

Please report security problems **privately**. Use GitHub's private vulnerability reporting: open this repository's **Security**
tab and choose **Report a vulnerability**. Please do not open a public issue, and do not include real phone numbers or other
personal data. Include steps to reproduce. We aim to acknowledge within 3 working days.

This is a volunteer-maintained project. There is no bug bounty.
