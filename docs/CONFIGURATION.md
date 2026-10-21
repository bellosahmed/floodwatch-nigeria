# Configuration

All configuration is through environment variables. Copy `.env.example` to `.env.local` and uncomment what you need.
**Never commit `.env.local` or any real secret**: `.gitignore` already excludes every `.env*` file except `.env.example`.

For local development you can set nothing at all. The app then stores data in a local JSON file and keeps every optional
feature off.

Generate a strong secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Secrets shorter than 24 characters are **refused**, and the endpoint they protect stays disabled (a warning is logged).

## Storage

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | **Yes in production** | unset | Postgres connection string. Tables are created automatically on first use. If unset, a local JSON file is used. On Vercel the app refuses to start without it, because serverless filesystems cannot persist. |
| `FLOODWATCH_DB` | No | `./data/db.json` | Path of the local JSON file used when `DATABASE_URL` is unset. Development only. |

## Endpoint secrets

Each endpoint stays disabled until its secret is set.

| Variable | Protects | Notes |
|---|---|---|
| `GAUGE_API_KEY` | `POST /api/gauges` | Partners (agencies, universities) pushing river-gauge readings. Sent as the `x-api-key` header. |
| `CRON_SECRET` | `GET /api/cron/snapshot`, `GET /api/cron/alerts` | Sent as `Authorization: Bearer <secret>`. Vercel sends it automatically to its own cron jobs. |
| `ADMIN_API_KEY` | `/admin` and `/api/admin/*` | The moderator key. Signing in at `/admin` swaps it for a short-lived HttpOnly cookie, so it is never kept in the browser. |

## Abuse protection

| Variable | Recommended | What it does |
|---|---|---|
| `SITE_ORIGIN` | Yes | Your public address (for example `https://floodwatch.example`). Pins which website may submit reports and forms (CSRF defence). Also builds the unsubscribe link in alert messages, and is required for alerts. |
| `TRUSTED_IP_HEADER` | Yes, behind a CDN | The header carrying the real visitor IP (`cf-connecting-ip` on Cloudflare, `x-vercel-forwarded-for` on Vercel, `x-real-ip` on nginx). If unset, the rightmost `X-Forwarded-For` value is used, which behind a CDN is the CDN's address, so every visitor would share one rate limit. |
| `TURNSTILE_SECRET` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Yes | [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) bot check on the report and alert sign-up forms. Free. Set **both** or neither. The single most useful defence against fake reports and sign-up abuse. |

## Legal pages

| Variable | What it does |
|---|---|
| `CONTACT_EMAIL` | Shown on `/privacy` and `/terms`. |
| `LEGAL_REVIEWED` | Set to exactly `true` to remove the "Draft, not yet reviewed by a lawyer" banner. Do this only after a qualified lawyer has reviewed the two pages for your deployment. |

## Phone alerts (SMS and WhatsApp)

The whole feature stays **off** unless `SMS_PROVIDER`, `PII_ENCRYPTION_KEY` and `SITE_ORIGIN` are all set. Nothing here sends a
message by itself: the daily alert job only reports what it would send until `ALERTS_LIVE=true`.

| Variable | Required for alerts | What it does |
|---|---|---|
| `SMS_PROVIDER` | Yes | `termii`, `twilio`, or `dry-run` (sends nothing; for testing and staging). |
| `PII_ENCRYPTION_KEY` | Yes | 64 hex characters. Encrypts phone numbers at rest (AES-256-GCM) and keys the lookup hashes. **Losing it means losing the ability to message existing subscribers: back it up.** |
| `ALERTS_LIVE` | No | The safety switch. Only the exact value `true` makes the alert job really send. Do not enable it until the thresholds have been checked with NiMet or NiHSA. |
| `SMS_DAILY_CAP` | No (default 300) | Hard limit on messages (codes plus alerts) in any rolling 24 hours. If the cap cuts a run short, the most dangerous cases are messaged first. |

### Termii

| Variable | Notes |
|---|---|
| `TERMII_API_KEY` | Your Termii API key. |
| `TERMII_BASE_URL` | Your account's base URL (it is account-specific). Must be `https`. |
| `TERMII_SENDER_ID` | The registered sender ID, 3 to 11 characters. |
| `TERMII_SMS_CHANNEL` | `dnd` (default, transactional, must be activated on your account) or `generic` (promotional: can fail to deliver codes, not recommended). |
| `TERMII_WHATSAPP_FROM` | Your WhatsApp device name, only if you offer WhatsApp. |

### Twilio

| Variable | Notes |
|---|---|
| `TWILIO_ACCOUNT_SID` | Starts with `AC`. |
| `TWILIO_AUTH_TOKEN` | Your auth token. |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | The SMS sender: a number, or a Messaging Service (`MG...`). |
| `TWILIO_WHATSAPP_FROM` | The approved WhatsApp sender, for example `whatsapp:+14155238886`. |
| `TWILIO_WHATSAPP_ALERT_CONTENT_SID`, `TWILIO_WHATSAPP_OTP_CONTENT_SID` | Your WhatsApp-approved templates (`HX...`), each with one variable. Messages to people who have not messaged you in the last 24 hours need approved templates. |

> **No real message has been sent through the Termii or Twilio adapters yet.** They follow the providers' documentation and
> pass tests against mocked requests only. Send yourself a test with `ALERTS_LIVE` unset before launch.

## Development and testing only

| Variable | What it does |
|---|---|
| `DRY_RUN_OUTBOX` | With `SMS_PROVIDER=dry-run`, also append full messages (including one-time codes) to this file as JSON lines, for end-to-end tests. |
| `TEST_DATABASE_URL` | Make `npm test` also run the storage suite against a real Postgres. |

`NODE_ENV` and `VERCEL` are set by Node and by the hosting platform. You never set them yourself.

## What turns on when

| You set | You get |
|---|---|
| nothing | Everything public works, with local file storage. |
| `DATABASE_URL` | Durable storage. Required for any real deployment. |
| `GAUGE_API_KEY` | Partners can push river-gauge readings. |
| `CRON_SECRET` | The daily snapshot job (the training data) can run. |
| `ADMIN_API_KEY` | The `/admin` moderation screen. |
| `SMS_PROVIDER` + `PII_ENCRYPTION_KEY` + `SITE_ORIGIN` | The `/alerts` sign-up page appears (in dry-run or reporting-only mode). |
| `+ ALERTS_LIVE=true` | The alert job really sends messages. |
