# Air quality provider chain policy (#2628)

Domestic responses take air quality from AirKorea. When no nearby AirKorea station has an observation within eight hours, the v000903 KMA routes ask a chain of providers through one adapter interface (`server/lib/air`). This page lists the policy variables, the order, the budgets and what an operator must set up. Behaviour details: [mobile API](../architecture/mobile-api.md#domestic-air-fallback-and-the-air-provider-chain-issues-2622-2628).

## Providers and keys

| Provider (adapter id) | Key variable | Free tier (2026-09-27) | Paid |
| --- | --- | --- | --- |
| Google Air Quality API (`google`) | `GOOGLE_SECRET_KEY` (the existing Maps key; the **Air Quality API must be enabled** on its Cloud project and billing must be on) | 10,000 calls per month | $5.00 per 1,000 to 100K, then $4 / $2 / $0.50 / $0.25 per 1,000 |
| OpenWeather Air Pollution API (`openweather`) | `OWM_SECRET_KEY` (**the configured key was rejected on 2026-09-27; issue a new one**) | 60 calls per minute, 1,000,000 per month | Startup plan 35 EUR per month (600 per minute, 10M per month) |
| Visual Crossing Timeline API, air quality elements (`visualcrossing`) | `VC_SECRET_KEY` (shared with overseas weather) | 1,000 records per day, **shared with overseas weather** (`vc.usage`, `VC_DAILY_RECORD_LIMIT`) | $0.0001 per record |
| WAQI geo feed (`aqicn`) | `WAQI_SECRET_KEY` | token quota per second, no monthly cap | none (free only; attribution mandatory, for-profit use needs an agreement with WAQI) |

A provider whose key is missing or still the placeholder is skipped without a request.

## Order

1. **Free phase**, while the free budgets last: Google → OpenWeather → WAQI. Visual Crossing is not used here because its free records are the overseas weather budget.
2. **Free budgets exhausted:** WAQI first (no cost), then — only when `AIR_PAID_PROVIDERS_ENABLED=true` — OpenWeather → Visual Crossing → Google, cheapest first, each within `AIR_PAID_MONTHLY_CALL_CAP`.

The first observation that is at most 8 hours old, from a station at most 30 km away (WAQI only; the others are modeled for the requested point) and has PM10 or PM2.5 wins. A `401`/`403` or `429` answer marks the provider down for 10 minutes for all workers. Every request, including failures, is counted.

## Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `AIR_GOOGLE_MONTHLY_CAP` | `10000` | Google free calls per UTC calendar month; the chain stops using the free phase at 95 % of it |
| `AIR_OWM_MONTHLY_CAP` | `1000000` | OpenWeather free calls per UTC calendar month (95 % rule) |
| `AIR_OWM_MINUTE_CAP` | `60` | OpenWeather calls per minute across all workers |
| `AIR_PAID_PROVIDERS_ENABLED` | `false` | Allow paid calls after the free budgets are exhausted |
| `AIR_PAID_MONTHLY_CALL_CAP` | `100000` | Paid calls per provider per UTC month while enabled |
| `AIR_PROVIDER_TIMEOUT_MS` | `3000` | Per-request timeout (500–10000); no retry |
| `VC_DAILY_RECORD_LIMIT` | (unset = none) | Existing overseas budget; air calls count their `queryCost` (1) against it |

Invalid values stop the process at start-up, like `config/gather.js`. Google's billing month is not UTC; the UTC month plus the 5 % reserve approximates it.

## Demand and cost

If AirKorea stops entirely, the fallback fetches once per 0.01° town cell per 30 minutes (2 minutes after a failure): a few thousand active cells make roughly 50K–150K calls per day. Google's free cap then lasts hours and OpenWeather's days; without the paid flag the chain continues on WAQI only. With the paid flag, Google costs about $5 per 1,000 calls, so keep `AIR_PAID_MONTHLY_CALL_CAP` low or leave the flag off.

## Storage

- `air.provider.usage`: counters per provider and window (`google:m:2026-09`, `openweather:min:2026-09-27T15:20`, `openweather:paid:m:2026-09`, `google:down`), TTL on `expireAt`. `db.air.provider.usage.find().sort({_id: 1})` shows the month's usage.
- `air.observation.caches`: one document per town cell with the normalized observation (30 minutes) or the failure (2 minutes); shared by all workers.
- Both collections are disposable; dropping them only costs provider calls.

## Rollback

Revert the change or set `AIR_PAID_PROVIDERS_ENABLED=false` (restart) to stop paid calls. Unsetting `WAQI_SECRET_KEY` or `VC_SECRET_KEY` also disables overseas air or weather, so they are not domestic-only switches.
