# ChargeCheck Finland

Find a charger in Finland that's free right now, and see what charging there would cost.

Open data from [Fintraffic](https://www.digitraffic.fi/) (Data: Fintraffic / digitraffic.fi, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Costs are estimates from published tariffs. Not affiliated with any operator.

<!-- Screenshot placeholder: add docs/screenshot.png and link it here. -->

Live site: https://towa0.github.io/chargecheck-fi/

## What it does

- Lists chargers in Oulu or all of Finland with live availability, like "3 of 6 available", and how old that status is.
- Estimates what your charge would cost at each one, with a breakdown of energy, time and fees.
- Filters by connector, fast charging and start time, sorts by cost, distance or power, and shows the same chargers on a map.

## How the price estimate works

Operators publish tariffs in the OCPI format. A tariff is a list of elements. Each element has prices for energy, charging time, parking time or a flat fee, and can have rules like "only between 07:00 and 21:00" or "only after two hours".

For your session I assume the car charges at a steady power: the charger's maximum, capped at 11 kW on AC and 100 kW on DC. That gives a duration. I split the session wherever a rule could switch on or off, and for each piece I use the first element whose rules match, separately for each kind of price. That is how OCPI 2.2.1 defines it. Step sizes round up once per session, and VAT is added when the tariff lists prices without it.

A real example, from a tariff in the open data with VAT included: 0.28 €/kWh from 07:00 to 21:00 and 0.19 €/kWh from 21:00 to 07:00. Charging 44 kWh at 22 kW from 20:00 takes two hours:

| Time | Energy | Price | Cost |
| --- | --- | --- | --- |
| 20:00 to 21:00 | 22 kWh | €0.28 / kWh | €6.16 |
| 21:00 to 22:00 | 22 kWh | €0.19 / kWh | €4.18 |
| Total | | | €10.34 |

This case is one of the tests in `tests/tariff/fixtures.test.ts`.

## Limits

- These are estimates, not quotes. The price you pay is set by the operator or your charging app.
- Prices in apps or via roaming can differ from the published tariff.
- Some chargers have no price in the open data. In my snapshot that was 7,847 of 20,210 EVSEs. The app says "Price not in the open data" and never guesses.
- Live statuses come from operators through Fintraffic and can be late or stuck. The app shows how old each status is and flags anything older than 24 hours.
- Tariffs with congestion fees (`CONGESTION_TIME`) or reservation pricing are not estimated. The app says why. In my snapshot that covered 441 EVSEs.
- The counts above come from one snapshot on 16 November 2026 and will change.

## For developers

You need Node.js 22 or later.

```sh
npm ci
npm run data      # fetch the API and write public/data/
npm run dev       # local server at http://localhost:5173/chargecheck-fi/
npm test          # unit and UI tests
npm run typecheck
npm run build     # production build in dist/
npm run probe     # fetch everything into .cache/ and print what the data looks like
```

`npm run data -- --cached` and `npm run probe -- --cached` reuse `.cache/` instead of calling the API again.

The live status poller asks for changes once a minute while the page is visible, and stops when the tab is hidden.

```
.github/workflows/pages.yml   test, build data, build and deploy to GitHub Pages
docs/data-notes.md            what the API fields mean and what I measured
scripts/
  lib/digitraffic.ts          API client with paging
  probe.ts                    data probe
  build-data.ts               writes and validates public/data/*.json
src/
  tariff/                     estimate engine (pure TypeScript, no DOM or network)
  live/statuses.ts            status loading, merging and polling
  data/                       data types, regions and shape checks
  logic/                      filtering, sorting and formatting
  components/                 controls, result card and map
  App.tsx
tests/
  tariff/                     hand-written and real-tariff cases
  fixtures/tariffs.json       13 real tariffs (Fintraffic, CC BY 4.0)
  live/ data/ ui/
```

More about the data and its quirks: [docs/data-notes.md](docs/data-notes.md).

Map tiles from [OpenStreetMap](https://www.openstreetmap.org/copyright).
