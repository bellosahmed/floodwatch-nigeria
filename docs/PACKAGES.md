# Packages and data sources

What this project depends on, why, and under which licence. The project deliberately keeps its dependency list short:
fewer packages means fewer things to audit, update and trust.

**Runtime:** Node.js 20.9 or newer (22 LTS recommended; `.nvmrc` pins 22). Package manager: npm (`package-lock.json` is committed).

## Runtime packages

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| [`next`](https://nextjs.org) | 16.x | MIT | The web framework (App Router): pages, API routes, server rendering, security headers. |
| [`react`](https://react.dev), `react-dom` | 19.x | MIT | The UI. Most pages are server components with no client JavaScript; only forms and the moderation screen are client components. |
| [`pg`](https://node-postgres.com) | 8.x | MIT | The Postgres driver. Used directly, with no ORM, so the SQL is short and visible in `lib/store/postgres.ts`. |

## Development packages (not deployed)

| Package | Licence | Why |
|---|---|---|
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/pg` | Apache-2.0 / MIT | Static typing. `npm run typecheck`. |
| `eslint`, `eslint-config-next`, `@eslint/eslintrc` | MIT | Linting. `npm run lint`. |
| `tsx` | MIT | Runs TypeScript directly for the tests and the data-building scripts. |

Tests use Node's **built-in** test runner (`node:test`), so there is no test framework to install.

## What is deliberately not used

No analytics or tracking packages, no advertising code, no UI component library, no CSS framework (the styling is one
small stylesheet), no ORM, no state-management library, and no third-party scripts in the browser except the optional
Cloudflare Turnstile bot check.

## Licence summary of everything installed

All installed packages (about 360, including transitive ones) use permissive licences (MIT, Apache-2.0, ISC, BSD and
similar), with these exceptions worth knowing:

| Package | Licence | Notes |
|---|---|---|
| `@img/sharp-libvips-*` and `@img/sharp-wasm32` (via `sharp`, installed by Next.js) | LGPL-3.0-or-later (libvips) | Optional native image-processing libraries pulled in by Next.js. The app **does not use them**: the image optimizer is disabled in `next.config.ts` because the site shows no images. They are installed as separate files, not bundled into this project's source. |
| `axe-core` (via the lint toolchain) | MPL-2.0 | Development only. |
| `caniuse-lite` (via the build toolchain) | CC-BY-4.0 | Browser-support data, development and build only. |

Run `npm ls --all` for the full tree. Nothing here is GPL, AGPL or SSPL.

## Keeping packages healthy

```bash
npm audit --omit=dev     # vulnerabilities in what actually ships. Clean when this was written (2026-10-21).
npm audit                # also the development tools; findings in the lint toolchain never ship
npm outdated             # what could be upgraded
```

GitHub Dependabot (see `.github/dependabot.yml`) opens weekly update pull requests, and CI runs the full test suite on each.
Upgrade `next` and `react` together.

## Data sources and external services (not npm packages)

| What | Source | Licence / terms | Used for |
|---|---|---|---|
| Rain, temperature and river-flow forecasts; the past 30 days | [Open-Meteo](https://open-meteo.com) | CC BY 4.0. **The free API is for non-commercial use only**, limited to about 10,000 calls a day, with no uptime guarantee. [Terms](https://open-meteo.com/en/terms). | The forecast layer (`lib/forecast.ts`, `lib/lga-forecast.ts`). |
| 10 years of historical rain, temperature and river flow (ERA5, GloFAS) | Open-Meteo archive and flood APIs | CC BY 4.0 | One-off build scripts that produced `data/climatology.json`, `heat-climate.json` and `river-climate.json`. |
| Local government boundaries | [geoBoundaries](https://www.geoboundaries.org), republishing GRID3 Nigeria | CC BY 4.0 | One-off build script that produced `data/lgas.json`. |
| Bot check (optional) | [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) | Free; Cloudflare's terms | The report and alert sign-up forms. |
| SMS / WhatsApp (optional) | [Termii](https://termii.com), [Twilio](https://www.twilio.com) | Paid services; their terms | Phone alerts. Off by default. |
| Database | Any Postgres | Your provider's terms | Production storage. |

The generated files in `data/` are committed so that nobody has to call the archive APIs to run the project. Rebuild them
with `npm run lgas`, `npm run climatology`, `npm run heatclimate` and `npm run riverclimate`. These calls are heavy for
the free tier, so run them rarely and expect a rate-limit response on the first try (the scripts retry).
