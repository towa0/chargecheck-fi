# Data notes

Notes on the Digitraffic AFIR charging network API, from what I measured with `npm run probe`.
All numbers below are from one snapshot taken on 16 November 2026. They will drift.

Source: Fintraffic / digitraffic.fi, licensed CC BY 4.0.
Base URL: `https://afir.digitraffic.fi/api/charging-network/v1/`

## Requests

- Send `Digitraffic-User: chargecheck-fi/<version>`, `Accept: application/json` and `Accept-Encoding: gzip`.
  Without `Accept` the API answers 406.
- `limit` only accepts `500` or `ALL`. Any other value returns 400 with
  `Limit must be one of: 500 or ALL`.
- Paged responses carry `pagination.nextCursor`. Pass it back as `?cursor=...`. The last page has no cursor.
- `operators` is not paged and takes no `limit`. It returns a plain JSON array, not an object.
- `locations/statuses` accepts `modifiedAfter` (ISO timestamp) to fetch only changes.
- CORS is open, so the browser can call it directly.

## Endpoints and fields

### `locations`

GeoJSON `FeatureCollection` under `features`. Each feature has a `Point` geometry
(`[lon, lat]`) and `properties`:

- `id`, `name`, `address` (`street`, `city`, `postalCode`, `countryCode`).
- `operator`: `id` (like `FI*001`), `partyId`, `countryCode`, `details.name`.
- `openingTimes.twentyFourSeven` and `regularHours`. Only set on some locations.
- `evses[]`: each has an `id` (the EVSE id used by statuses) and `connectors[]`.
- `connectors[]`: `standard`, `powerType`, `format`, `maxVoltage`, `maxAmperage`,
  `maxElectricPower` (watts) and `tariffIds[]`.

Tariff references sit on connectors, not on EVSEs. I count an EVSE as "has a tariff"
when any of its connectors references a tariff that exists in `tariffs`.

There is no `timeZone` field on locations. All locations are in Finland, so I use
`Europe/Helsinki` for time-of-day rules.

### `locations/statuses`

`statuses[]` with `evseId`, `status`, `modifiedAt` and `lastUpdatedAt`.
`modifiedAt` is when the status record changed in Digitraffic. `lastUpdatedAt` is when
the operator last reported it. A status can be confirmed often without changing, so
`lastUpdatedAt` is the better signal for how fresh it is.

### `tariffs`

`tariffs[]`, OCPI-style tariffs in camelCase. It follows OCPI 2.2.1 with a few 2.3 fields:

- `taxIncluded` (`YES` / `NO`, from OCPI 2.3) says whether `price` already includes tax.
- `vat` on each price component is a percentage.
- `stepSize` is in Wh for `ENERGY` and seconds for `TIME` and `PARKING_TIME`.

### `operators`

Array of `{ id, partyId, countryCode, details: { name, website } }`.

## Measured on 16 Nov 2026

| What | Count |
| --- | --- |
| Locations | 3,801 (all with geometry; 753 flagged 24/7) |
| EVSEs | 20,210 |
| Connectors | 20,351 |
| Statuses | 20,210 |
| Tariffs | 1,761 |
| Operators (endpoint) | 19 |
| Distinct operator names on locations | 32 |

Pages at limit 500: locations 8, statuses 8, tariffs 4.

### Tariff coverage

- EVSEs with a resolvable tariff: 12,363 (61.2%).
- EVSEs without one: 7,847 (38.8%). Every referenced tariff id exists, so all of these
  simply have no `tariffIds`.
- Every tariff is referenced by at least one connector.
- `tariffIds` per connector: 0 on 7,953, 1 on 11,885, 2 on 475, 3 on 33, and a handful with 4, 5 or 16.

When a connector lists several tariffs, they are usually versions of the same price over
time, told apart by `startDateTime` and `endDateTime`. 207 connectors list two `REGULAR`
tariffs with no dates at all.

### Tariff fields

- `taxIncluded`: `NO` 1,621, `YES` 140. No `N/A`.
- `type`: missing 642, `AD_HOC_PAYMENT` 586, `REGULAR` 533.
- Currency: all `EUR`.
- `startDateTime` on 1,103 tariffs, `endDateTime` on 77. None start in the future. All 77
  end dates are in the past, so those tariffs are no longer valid.
- `minPrice` / `maxPrice`: not used by any tariff.
- `tariffAltText` on 1,108 tariffs, `tariffAltUrl` on 81.

### Price components

| Type | Components |
| --- | --- |
| ENERGY | 2,244 |
| FLAT | 514 |
| TIME | 507 |
| PARKING_TIME | 248 |
| CONGESTION_TIME | 98 |

`CONGESTION_TIME` is not part of OCPI 2.2.1 or 2.3. It appears in 49 tariffs.

Step sizes seen:

| Type | stepSize: components |
| --- | --- |
| ENERGY | 1: 2,222; 1000: 22 |
| FLAT | 1: 514 |
| TIME | 60: 238; 1: 201; 900: 59; 3600: 9 |
| PARKING_TIME | 1: 203; 60: 45 |
| CONGESTION_TIME | 60: 98 |

VAT values: 25.5 on 3,276 components, missing on 274, 0 on 59, 24 on 2.
The 24% values belong to one tariff that ended in 2024. Every component without VAT sits
in a tariff with `taxIncluded: NO` that also has `CONGESTION_TIME`.

### Restrictions

Keys in use, counted per element:

| Key | Elements |
| --- | --- |
| startTime | 958 |
| endTime | 958 |
| minDuration | 594 |
| dayOfWeek | 264 |
| maxDuration | 181 |
| reservation | 7 (all `RESERVATION`) |
| maxPower | 5 |
| minPower | 2 |

Not seen: `startDate`, `endDate`, `minKwh`, `maxKwh`, `minCurrent`, `maxCurrent`.

369 elements have a time window that crosses midnight (`endTime` earlier than `startTime`).

### Common shapes

The top tariff structures (elements split by `|`, restriction keys in brackets):

| Shape | Tariffs |
| --- | --- |
| ENERGY | 712 |
| FLAT+ENERGY | 486 |
| TIME[minDuration] \| ENERGY | 107 |
| ENERGY[endTime,startTime] \| ENERGY[endTime,startTime] | 104 |
| TIME[endTime,minDuration,startTime] \| ENERGY[...] \| ENERGY[...] | 62 |

### Statuses

| Status | EVSEs |
| --- | --- |
| AVAILABLE | 15,225 |
| CHARGING | 2,193 |
| BLOCKED | 1,142 |
| OUTOFORDER | 1,042 |
| UNKNOWN | 338 |
| INOPERATIVE | 222 |
| RESERVED | 33 |
| PLANNED | 15 |

Age of `lastUpdatedAt` at probe time: under 1 h 4,345; 1 to 24 h 12,140; 1 to 7 days 2,075;
over 7 days 1,650.

### Connectors

Standards: `IEC_62196_T2` 14,170, `IEC_62196_T2_COMBO` 5,451, `DOMESTIC_F` 382,
`CHADEMO` 343, `MCS` 5. Power types: `AC_3_PHASE` 13,886, `DC` 5,835, `AC_1_PHASE` 630.
4 connectors have no `maxElectricPower`. The highest value is 1,200,000 W (an MCS connector).

## Oddities and how I handle them

- **Time format.** Most times are `HH:MM`. A few use `00:00:00` and `24:00:00`. I accept
  seconds and read `24:00` as the end of the day.
- **`23:59` as end of day.** 56 elements end at `23:59`. Read literally, that leaves one
  minute a day with no matching element, and OCPI says a dimension with no match costs nothing.
  I follow the spec, and the estimate says so when a session falls into such a gap.
- **`minDuration: 0`, `maxDuration: 86400`.** Several tariffs repeat the same price per weekday
  with these bounds. They only matter for sessions longer than a day.
- **Several tariffs per connector.** I keep only tariffs valid at the session start
  (`startDateTime` ≤ start < `endDateTime`). If more than one is left, I show each estimate
  and the range, instead of picking one.
- **Missing VAT with `taxIncluded: NO`.** OCPI 2.3 says tax is then added on top, at a rate
  the tariff doesn't give. I don't estimate those.
- **`CONGESTION_TIME` and `reservation`.** Not estimated. `CONGESTION_TIME` has no OCPI
  definition, and reservation pricing doesn't apply to a walk-up session in the way the
  tariff might intend.
- **EVSE ids** contain `*`, which is fine in JSON but needs encoding in URLs.

## What the estimate engine refuses

Running `src/tariff/` on every tariff for 30 kWh at 22 kW, starting at probe time:

| Reason | Tariffs |
| --- | --- |
| Validity ended (`endDateTime` in the past) | 77 |
| `CONGESTION_TIME` component | 49 |
| `reservation` restriction | 4 |

The other 1,631 tariffs get an estimate. Every connector with an expired tariff also lists
a current one, so the expired ones cost nothing in coverage. 441 EVSEs that do have tariffs
get no estimate at all: 429 because of `CONGESTION_TIME` and 12 because of `reservation`.

## Example tariffs

Energy only, VAT added on top:

```json
{
  "id": "TRF638672674296554923::vatExempt=false",
  "currency": "EUR",
  "taxIncluded": "NO",
  "elements": [
    { "priceComponents": [{ "type": "ENERGY", "price": 0.2152, "vat": 25.5, "stepSize": 1 }] }
  ]
}
```

Time of day and weekday on every element (one element per weekday, trimmed here):

```json
{
  "id": "dfc763e6f1fdb8d7a868ed29e735a1d0",
  "taxIncluded": "NO",
  "elements": [
    {
      "priceComponents": [{ "type": "ENERGY", "price": 0.2789, "vat": 25.5, "stepSize": 1 }],
      "restrictions": {
        "startTime": "00:00", "endTime": "23:59",
        "minDuration": 0, "maxDuration": 86400,
        "dayOfWeek": ["MONDAY"]
      }
    }
  ]
}
```

Energy plus charging time after two hours, prices with tax included:

```json
{
  "id": "6b7c6de537f950a579ec12c12d8867a9",
  "type": "AD_HOC_PAYMENT",
  "taxIncluded": "YES",
  "elements": [
    {
      "priceComponents": [{ "type": "TIME", "price": 1.2, "vat": 25.5, "stepSize": 60 }],
      "restrictions": { "minDuration": 7200 }
    },
    { "priceComponents": [{ "type": "ENERGY", "price": 0.34, "vat": 25.5, "stepSize": 1 }] }
  ]
}
```
