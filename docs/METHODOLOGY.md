# Methodology and known limits

How the risk levels are produced, what they can and cannot tell you, and where the numbers are weakest. Read this before
relying on the output, and before changing any threshold.

> **This is not an official warning service.** It is indicative guidance built from public forecasts and community
> reports. Always follow NiMet, NiHSA, NEMA and your State Emergency Management Agency.

## The two layers

```
 Open-Meteo forecast ──► lib/forecast.ts ──┐
 (rain + river flow)                       ├──► lib/combined.ts ──► pages + /api/risk
 People + partner gauges ─► lib/ground.ts ─┘
```

- **Forecast layer** (`lib/forecast.ts`): rainfall and river-flow models, scored per state. A river rise only counts in full when it is unusual for
  that state and month (`data/river-climate.json`, `npm run riverclimate`). If the source is
  down the app keeps working on the ground layer alone and shows a notice.
- **Ground layer** (`lib/ground.ts`): each device counts once. 2+ devices reporting "dangerous" gives High, 3+
  reporting "severe" gives Severe, a gauge above its danger level forces Severe. No reports is shown as
  "No reports", never "Safe".
- **Combined** (`lib/combined.ts`): the higher of the two layers, raised one step when both agree.

## Calendar: what you can and cannot see ahead

| Horizon | Where | How reliable |
|---|---|---|
| Next 16 days, day by day | `/calendar`, each state page | Days 1-3 good, 4-7 fair, 8-16 indicative only (shown faded) |
| Months ahead | "A typical year" strip and heatmap | **Typical conditions from 10 years of history, not a forecast for this year** |

There is deliberately no "wetter than normal this season" feature. The free seasonal forecast was compared with the
10-year record and disagreed with it by factors from 0.06x to 2.4x for the same state and month, so any anomaly
would mostly be model bias. Add it only with a properly bias-corrected seasonal source.

## Local governments, the past month, and heat

| Feature | Where | How it works |
|---|---|---|
| Local governments (774) | Bottom of each state page, `/api/lga?state=` | Each LGA gets its own 16-day rainfall and temperature outlook, ranked by who is hit first and worst. Points come from open boundary data (`npm run lgas`) |
| Previous 30 days | Calendars (dotted cells) | What already happened, modelled from observations |
| Heat | "Heat" switch (`?hazard=heat`) | Health-based bands on max and feels-like temperature, lowered one step on days that are normal for the state and month (`data/heat-climate.json`, `npm run heatclimate`), with 3 or more hot days in a row counted as a heatwave |

## Known limits

- Thresholds are first-pass heuristics, **not calibrated** against NiHSA station records.
- Anonymous reports can be wrong or malicious. Device deduplication and rate limits raise the cost of abuse but do
  not stop a determined attacker. Gauges and agency data are the trusted layer.
- IP rate limits use the rightmost `X-Forwarded-For` value, or the header named in `TRUSTED_IP_HEADER`. They are per server instance and are a brake, not a guarantee.
- The "on the 2026 flood outlook" flag comes from a state list in news reports. Verify against the NiHSA publication.
- **LGA flood scoring uses rainfall only.** River flow is not scored per LGA because the river model is gridded and an LGA point is often not on a river.
- **The river rule is softened by the season and has a minimum flow, not calibrated.** Rivers rise every rainy season, and the old rule (flow at least 1.6x its previous 30-day mean) said "Severe" on about 44 days per state per year. Now flow at or below the state's usual 90th percentile for the month (2015-2024) is lowered one step (two near the usual middle), and flow under 10 m3/s is ignored: in 25 of 37 states the modelled river never exceeds 20 m3/s even in the wet season, so a rise there is noise. On 2015-2025 history, rain+river Severe days fell from 44 to 4.5 per state per year and High+ from 72 to 14. It still flags the fortnight before the Sept 2024 Maiduguri flood (as High), but it cannot see a dam failure or a small intense storm: the May 2025 Mokwa flood showed no signal in rain or river data, and in most states the river layer adds little. Stored snapshot `forecastLevel` values from before this change are not comparable with later ones.
- **One forecast point per state.** In 16 states the farthest local government is over 150 km from it, where daily rain agrees only weakly (correlation about 0.47, against 0.61 within 150 km). Those state pages carry a notice pointing to the local government table.
- **LGA points are one spot inside each LGA**, not the whole area. Large LGAs can have very different weather in different places.
- **Heat is softened by a local baseline, but still uncalibrated.** Days at or below the state's usual (90th percentile, 2015-2024) maximum for that month are lowered one step. On March-May 2026 this cut "hot" days from 58% to 10% in Borno and 60% to 16% in Sokoto, and left Lagos, Port Harcourt and Abuja unchanged. The baseline is per state, so LGAs use their state's values. The bands themselves have not been checked against NiMet advisories.
- **Free-tier budget:** LGA data loads per state on demand and is cached 6 hours, state data 3 hours. Worst case is a few thousand calls a day against the 10,000 limit.

## Building toward prediction

`/api/cron/snapshot` records each state's forecast inputs once a day. Community reports in the following 72 hours
are the labels. `npm run dataset` joins them into a CSV. **Schedule the snapshot job as early as possible**: every
day it does not run is training data you cannot get back. Train a model only after a full rainy season, and
only adopt it if it beats the rule-based thresholds on held-out data.

## Changing a threshold

These numbers decide who gets warned. A change should come with: the evidence for it (real station data, an event
record, or a documented comparison), the effect it has on historical days (see the figures above for the style), and
tests. Do not tune thresholds to make a demo look better.
