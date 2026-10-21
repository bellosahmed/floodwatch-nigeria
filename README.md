# FloodWatch Nigeria

[![CI](https://github.com/bellosahmed/floodwatch-nigeria/actions/workflows/ci.yml/badge.svg)](https://github.com/bellosahmed/floodwatch-nigeria/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Free, open-source flood and heat early warning for every Nigerian state and all 774 local governments.**

Forecasts give the early warning. Reports from people on the ground, and river-gauge readings from partner agencies, confirm
it. Anyone can read it, and agencies, NGOs, insurers and media can plug into the open API.

> **FloodWatch is not an official warning service.** It is indicative guidance built from public forecasts and
> community reports, and its thresholds have **not** been calibrated against NiMet or NiHSA records. It can be wrong or
> late. In danger, call 112 and follow NEMA and your State Emergency Management Agency.

## What it does

- **Risk for every state and local government.** A 16-day outlook for 36 states, the FCT and 774 LGAs, ranked by *who is hit first and worst*.
- **A calendar you can read.** The previous 30 days, today, and the next 16 days, for flooding or dangerous heat, plus what each month is *typically* like (clearly labelled as typical, not a forecast).
- **Ground truth from people.** Anonymous community reports, deduplicated per device and rate-limited. One report is a "Watch"; it takes several independent reports to raise a level. "No reports" is never shown as "Safe".
- **River gauges from partners.** Agencies and universities can push readings through an authenticated API.
- **Honest about uncertainty.** Days 8-16 are shown faded. If the weather source goes down, the last good forecast stays up (for up to 12 hours) with a notice saying so. Every page carries its limits.
- **Optional phone alerts (SMS/WhatsApp)**, off by default, with encrypted numbers, a one-tap stop link, a cost cap, and a safety switch. See [Phone alerts](#phone-alerts-optional).
- **A moderation screen** to hide abusive reports.
- **A growing training set.** A daily job records the forecast inputs; community reports become the labels for a future prediction model.

Built with low-bandwidth phones in mind: pages are rendered on the server, there are no web fonts, images or tracking scripts, and the layout is
tested at 320-412 px wide.

## Quick start

You need **Node.js 20.9 or newer (22 LTS recommended)**. `.nvmrc` pins 22, so `nvm use` works.

```bash
git clone https://github.com/bellosahmed/floodwatch-nigeria.git
cd floodwatch-nigeria
npm install
npm run dev          # http://localhost:3000
```

That is all: with **no configuration** the app runs with a local file for storage and the optional features off. The
forecast data comes from the free Open-Meteo API, which needs no key.

To turn things on, copy `.env.example` to `.env.local` and set what you need. Every variable is explained in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md). **Never commit `.env.local`.**

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Run the tests (Node's built-in runner). Add `TEST_DATABASE_URL=...` to also run the storage suite against a real Postgres |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run dataset > dataset.csv` | Export the labelled training set |
| `npm run lgas` / `climatology` / `heatclimate` / `riverclimate` | Rebuild the committed reference data in `data/` (rare; heavy on the free API) |

## How it works

```
 Open-Meteo forecast ──► lib/forecast.ts ──┐
 (rain, heat, river flow)                  ├──► lib/combined.ts ──► pages + /api/risk
 People + partner gauges ─► lib/ground.ts ─┘
        ▲                       ▲
   /api/reports            /api/gauges (key)        lib/store/  Postgres (production) or JSON file (development)
```

The forecast layer and the ground layer are scored separately and combined: the higher wins, and agreement raises the level one
step. Local governments are scored from their own rainfall and temperature. The full method, and where the numbers are weakest,
is in **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**. Please read it before relying on, or changing, any threshold.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Postgres (`pg`, no ORM). About 200 tests with Node's built-in runner. See
[docs/PACKAGES.md](docs/PACKAGES.md) for every dependency, its licence and why it is there.

## API

All public read endpoints allow cross-origin requests.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/risk[?state=lagos][&min=2]` | none | Combined risk feed |
| `GET /api/lga?state=lagos[&hazard=heat]` | none | Local governments ranked by outlook |
| `GET /api/lgas?state=lagos` | none | The local governments of a state (static list) |
| `GET /api/climatology?state=lagos` | none | Twelve typical months for one state |
| `POST /api/reports` | none, rate limited | Submit a community report |
| `POST /api/gauges` | `x-api-key` | Push a river-gauge reading |
| `GET /api/health` | none | 200 if the database answers, else 503 (for uptime monitors) |
| `GET /api/cron/snapshot`, `/api/cron/alerts` | `Authorization: Bearer $CRON_SECRET` | Daily jobs |
| `/api/admin/*` | `ADMIN_API_KEY` | Moderation and service counts |
| `POST /api/alerts/subscribe`, `/confirm`, `/unsubscribe` | none, rate limited | Phone-alert sign-up flow |

## Phone alerts (optional)

Off unless configured. Numbers are confirmed with a one-time code, stored encrypted, and deleted by a one-tap stop link in every
message. Messages are capped per day, only fire at High or Severe, and go out once per episode. **Live sending is off by default**
(`ALERTS_LIVE`): until you switch it on, the daily job only *reports* what it would send.

> **Never tested with a real provider.** The Termii and Twilio adapters follow the providers' documentation and pass tests
> against mocked requests, but no real message has been sent through them. Test with your own number first. And do not enable
> live alerts until the thresholds have been checked with NiMet or NiHSA: a false alarm by SMS does real harm.

Details, the safety design, and provider setup: [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [SECURITY.md](SECURITY.md).

## Deploying

A free setup that works for a pilot: **Vercel (Hobby) + Neon (free Postgres) + Cloudflare Turnstile**, with alerts off.

1. Create a Postgres database and set `DATABASE_URL`. The tables are created automatically.
2. Set the secrets and `SITE_ORIGIN` (see `.env.example`). Use `TRUSTED_IP_HEADER=x-vercel-forwarded-for` on Vercel.
3. `vercel.json` schedules the two daily jobs. Elsewhere, call `/api/cron/snapshot` once a day with the cron secret.
4. Point an uptime monitor at `/api/health`.
5. Turn on Turnstile, set `CONTACT_EMAIL`, and **have a lawyer review `/privacy` and `/terms`** before removing the "Draft" banner
   (`LEGAL_REVIEWED=true`).

Free tiers change, so check each provider's current limits. Note that **the free Open-Meteo API is for non-commercial use only**.

## Security

Security is a design goal, not an afterthought: abuse limits, CSRF defence, encrypted personal data, a strict Content-Security-Policy,
and a moderation tool. The full list, the pre-launch checklist and the known limits are in **[SECURITY.md](SECURITY.md)**.
**To report a vulnerability, use GitHub's private reporting** (the repository's *Security* tab, then *Report a vulnerability*), not a
public issue.

## Data sources and licences

The **code** is licensed under the [Apache License 2.0](LICENSE). The **data** keeps its own licences, and must be credited:

- Weather, river and historical data: [Open-Meteo](https://open-meteo.com) (CC BY 4.0). **The free API is non-commercial only**, so a commercial deployment
  needs their paid plan or another licensed source. [Terms](https://open-meteo.com/en/terms).
- Local government boundaries: [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0), republishing GRID3 Nigeria.

See [NOTICE](NOTICE) for the attribution text. The running site shows these credits in its footer; please keep them.

## Contributing

Contributions are very welcome, especially from people who know Nigerian flood and heat risk first-hand. Read
**[CONTRIBUTING.md](CONTRIBUTING.md)** and the [Code of Conduct](CODE_OF_CONDUCT.md). Where help matters most:

- **Calibration** against real NiMet and NiHSA data and event records (the biggest single improvement).
- **Local languages**: Hausa, Yoruba, Igbo and Pidgin text and messages.
- **A real provider test** of the SMS and WhatsApp adapters, and moderator accounts with an audit log.
- **More river-gauge sources**, accessibility review, and offline support.

## Acknowledgements

Forecast and historical data by [Open-Meteo](https://open-meteo.com) (ECMWF/Copernicus ERA5 and GloFAS). Boundaries by
[geoBoundaries](https://www.geoboundaries.org) and GRID3. Bot protection by [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).
