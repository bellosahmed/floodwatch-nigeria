# Contributing to FloodWatch Nigeria

Thank you. This project produces warnings that people may act on, so the bar for correctness and honesty is higher than for most
web apps. This page explains how to help without getting in your own way.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are accepted under the project's
[Apache-2.0 licence](LICENSE) (the licence's section 5 covers this: what you contribute is licensed the same way).

## Where help matters most

1. **Calibration with real data.** The thresholds are first-pass heuristics. Station records from NiHSA and NiMet, and dated event
   records (floods, heatwaves), would let us check them. If you have access or contacts, this is the most valuable contribution.
2. **Local languages.** Hausa, Yoruba, Igbo and Nigerian Pidgin text, including the alert messages.
3. **Real-provider testing** of the SMS/WhatsApp adapters (`lib/alerts/providers.ts`), which have only been tested against mocked requests.
4. **More data sources:** other river-gauge feeds, and better local data than one point per state.
5. **Accessibility and low-bandwidth work:** screen-reader review, offline support, smaller pages.
6. **Moderator accounts and an audit log** (today there is a single moderator key).

Smaller things are just as welcome: typos, unclear docs, a failing edge case with a test that shows it.

## Set up

You need Node.js 20.9 or newer (22 LTS recommended: `nvm use`).

```bash
git clone https://github.com/<your-fork>/floodwatch-nigeria.git
cd floodwatch-nigeria
npm install
npm run dev
```

No configuration is needed for development. To work on a feature that needs settings, copy `.env.example` to `.env.local`
(see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)). **Never commit `.env.local`, keys, or phone numbers.**

## Before you open a pull request

Run all three. CI runs them too, on every pull request:

```bash
npm run typecheck
npm run lint
npm test
```

To also test the storage layer against a real Postgres (CI does):

```bash
docker run -d --name fw-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=floodwatch_test -p 127.0.0.1:5432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/floodwatch_test npm test
```

## How the code is organised

- `lib/` holds the logic, as small pure functions where possible, so it is easy to test. `lib/store/` hides storage (file or Postgres);
  `lib/alerts/` is the phone-alert system; `lib/admin/` is moderator sign-in.
- `app/` is thin: it validates input and calls `lib/`.
- `data/` holds generated reference data. Do not hand-edit it: change the script in `scripts/` and rebuild.
- `tests/` mirrors `lib/`. New logic comes with tests, and a bug fix comes with a test that fails without the fix.

## Rules that protect users

These are not style preferences:

- **Never state an unverified number.** If a README or code comment gives a figure (a rate, a percentage, a threshold's effect), it
  must come from a check you ran or a source you link. Say "not verified" when it is not.
- **Do not weaken a safety control without a reason in the pull request:** rate limits, the consent and code-confirmation flow, the
  daily message cap, `ALERTS_LIVE`, encryption of phone numbers, redaction of contact details in reports.
- **Do not tune a threshold to make something look better.** A change to who gets warned needs evidence and tests. See
  [docs/METHODOLOGY.md](docs/METHODOLOGY.md#changing-a-threshold).
- **"No reports" and "Low" must never read as "safe".**
- **Do not add trackers, analytics or third-party scripts.** Dependencies are kept few on purpose ([docs/PACKAGES.md](docs/PACKAGES.md)).
- **Report security problems privately** (see [SECURITY.md](SECURITY.md)), not in a public issue.

## Pull requests

- Keep them focused: one change, with the reason in the description.
- Describe how you checked it. Screenshots help for anything visual (please check a narrow phone width, 320-360 px).
- Be patient with review: this is safety-relevant code and reviewers will ask for evidence.

## Reporting bugs and ideas

Use the issue templates. For a wrong or surprising risk level, include the state or LGA, the date and time you looked, and what you
expected. Please do not paste phone numbers or other personal data.
