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

Each provider is asked at most once per request (a provider that failed in the free phase is not retried in the paid phase), so a request makes at most four provider calls. The first observation that is at most 8 hours old, from a station at most 30 km away (WAQI only; the others are modeled for the requested point) and has PM10 or PM2.5 wins. A `401`/`403` or `429` answer marks the provider down for 10 minutes for all workers. Every request, including failures, is counted. Paid requests require an acknowledged atomic monthly reservation before HTTP; a paid policy-read or reservation failure skips that candidate (D20).

## Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `AIR_GOOGLE_MONTHLY_CAP` | `10000` | Google free calls per UTC calendar month; the chain stops using the free phase at 95 % of it |
| `AIR_OWM_MONTHLY_CAP` | `1000000` | OpenWeather free calls per UTC calendar month (95 % rule) |
| `AIR_OWM_MINUTE_CAP` | `60` | OpenWeather calls per rolling minute across all workers (current minute plus the weighted previous minute) |
| `AIR_PAID_PROVIDERS_ENABLED` | `false` | Allow paid calls after the free budgets are exhausted |
| `AIR_PAID_MONTHLY_CALL_CAP` | `100000` | Paid call reservations per provider per UTC month while enabled |
| `AIR_PROVIDER_TIMEOUT_MS` | `3000` | Per-request timeout (500–10000); no retry |
| `AIR_RESPONSE_DEADLINE_MS` | `4000` | Whole overseas optional-air branch deadline (500–8000); late work can fill cache |
| `VC_DAILY_RECORD_LIMIT` | (unset = none) | Existing overseas budget; air calls count their `queryCost` (1) against it |

Invalid values stop the process at start-up, like `config/gather.js`. A cap of `0` blocks the provider in that window from the first call. Google's billing month is not UTC; the UTC month plus the 5 % reserve approximates it.

## Paid admission and storage failures (D20)

Before contacting a paid provider, the chain checks its applicable down marker, monthly allowance, OpenWeather minute window or Visual Crossing shared policy, then atomically reserves one monthly call in Mongo. A failed paid-policy read denies the request with `store-error`; a failed or unacknowledged reservation returns `reserve-error`, and an exhausted allowance returns `paid-cap`. Concurrent workers cannot reserve beyond `AIR_PAID_MONTHLY_CALL_CAP`; free counters and the minute-window approximation retain their existing behavior.

The reserved call is not counted again after HTTP. Result accounting uses the reservation's month even if the response crosses UTC month-end. Reservations are never refunded: a crash or an ambiguous write result may conservatively consume an allowance without an external call. A later accounting failure does not erase the reserved call. Recovery permits only the remaining allowance. Free-phase reads remain fail-open; neither this policy nor the provider HTTP timeout bounds a hung Mongo operation.

## Demand and cost

If AirKorea stops entirely, the fallback fetches once per 0.01° town cell per 30 minutes (2 minutes after a failure): a few thousand active cells make roughly 50K–150K calls per day. Google's free cap then lasts hours and OpenWeather's days; without the paid flag the chain continues on WAQI only. With the paid flag, Google costs about $5 per 1,000 calls, so keep `AIR_PAID_MONTHLY_CALL_CAP` low or leave the flag off.

## Storage

- `air.provider.usage`: counters per provider and window (`google:m:2026-09`, `openweather:min:2026-09-27T15:20`, `openweather:paid:m:2026-09`, `google:down`), TTL on `expireAt`. `db.air.provider.usage.find().sort({_id: 1})` shows the month's usage.
- `air.observation.caches`: one document per town cell with the normalized observation (30 minutes) or the failure (2 minutes); shared by all workers.
- `air.observation.caches` is disposable (dropping it only costs provider calls). Dropping `air.provider.usage` is **not** harmless: it resets this month's spending counters and the down markers, so the chain may call providers it should have skipped.

## Rollback

Revert the change or set `AIR_PAID_PROVIDERS_ENABLED=false` (restart) to stop paid calls. Unsetting `WAQI_SECRET_KEY` or `VC_SECRET_KEY` also disables overseas air or weather, so they are not domestic-only switches.

## Overseas requests (#2628 PR 2)

Active overseas DSF v000901–v000903 and widget new-form weather requests use this same policy and Mongo observation cache, in parallel with weather retrieval. Weather cache hits still check the air cache; they do not force a new provider request. Free allowances and paid caps are shared with domestic fallback, not separate regional allocations. Existing environment variables and D20 paid reservation apply unchanged.

Current air is rendered using the request's airUnit and response timezone, with the actual provider source. A missing or failed air result does not fail weather. No current observation is presented as yesterday's air or a forecast. Legacy aqi documents are not migrated or deleted by this request path. Reverting PR2 restores the previous overseas WAQI path while retaining PR1 domestic behavior. A server deployment is required for production to use the new path.

### Overseas optional-air response deadline and attribution (D22)
`AIR_RESPONSE_DEADLINE_MS` defaults to 4000 ms (integer 500–8000). It bounds the entire overseas air branch including Mongo waits, so serial provider timeouts cannot hold the weather join indefinitely. Timed-out requests omit air; in-flight work may finish caching for later requests, without late response mutation, duplicate continuation or an extra billing attempt. It does not bound earlier geocoding, weather work, or domestic requests. A background Mongo operation that never finishes remains an underlying store availability concern.

`source` remains the provider id. Accepted metadata includes optional plain-text `attribution`: DSF `current.arpltn`, `airInfo` and `airInfo.last`; `/ww` keeps raw `airSource`/`airAttribution`. Shared domestic arpltn also carries attribution when supplied. The client owns source labels/links and safe text display of the WAQI/original-agency attribution. This server contract does not implement client UI or approve provider terms; confirm display and operator licensing readiness before deployment.

D23 response hint: when the overseas air deadline expires with work outstanding, both DSF and `/ww` add top-level `airStatus: {"state":"pending","retryAfterSeconds":3}`. It describes the cutoff state and suggests a delay; the client decides whether to request again. It guarantees neither success nor completion within three seconds. Early success and terminal no-air failures omit it. The hint is request-local, never cached, and late callbacks cannot alter it. No automatic retry or HTTP Retry-After is added.
