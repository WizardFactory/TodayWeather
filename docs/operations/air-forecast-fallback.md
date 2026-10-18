# Legacy hourly air forecast fallback (#2831)

This repair serves existing stored station forecasts with OpenWeather or other
coordinate-provider current observations. It does not improve acquisition, change
the eight-hour observation freshness rule, enable KAQ, alter keys/quotas or add
request-time forecast acquisition. Observation and publication recovery remains
[#2636](https://github.com/WizardFactory/TodayWeather/issues/2636). Stored forecasts
can eventually expire even while this selector works; record observation age,
publication age, valid future rows and provider rejection outcomes separately.
Cached quota rejections are not counts of new HTTP attempts or proof of remaining
provider allowance.

The selected station is the nearest named result of the existing AirKorea metadata
query; this bounded lookup is not a guarantee of nationwide metadata freshness or
of usable forecasts at another station. Missing metadata or usable rows leaves a
safe current-only result. Client chart horizon and KST times are unchanged.

## Pre-deployment checks

Deployment and service restart require separate AK approval. Pre-merge work does
not authorize either action. Production has selective overlays; do not replace the
whole checkout or infer deployed behavior from repository HEAD.

1. Record the approved candidate and current deployed hashes/copies of
   `server/controllers/kecoController.js`, `controllerTown.js` and
   `controllerTown24h.js`. Compare their complete diffs with existing overlays.
2. Run `npm --prefix server run test:offline` with isolated test dependencies and
   `node server/test/offline/air-forecast-observation-http-smoke.js` with
   `mongodb-memory-server-core@10.1.4`, `mongoose-smoke@npm:mongoose@5.13.23`,
   `async@2.6.4`, `express@4.13.4`. The real local Mongo/HTTP smoke uses the captured
   OpenWeather fixture and creates/removes only its own temporary DB/listener.
   Node 16.20.2 compatibility must pass. No collector/app startup is required.
3. Establish a non-AirKorea current-observation response for the target location
   and record a nearby metadata station plus usable stored forecast rows. If
   current observations have recovered, a successful AirKorea response cannot
   prove this repair. Use the isolated replay; await a genuine fallback condition
   for the post-rollout acceptance record, without forcing a production outage.

## Approved rollout and observation

1. Apply only the reviewed three-controller repair while preserving unrelated
   overlays. Restart/reload service workers only under the separate approval.
   No gather restart, DB migration or config/provider change is needed.
2. Read the normal origin and public legacy requests for the same location, with
   source omitted, `airForecastSource=kaq` and `airForecastSource=airkorea`.
   Record UTC capture time, response `Date`/cache status and observation time.
3. Require `airInfo.source` and `last.source` to remain the fallback provider;
   compare all current readings and attribution before/after. Require
   `forecastStationName` to match nearby metadata, then compare returned PM10/PM2.5
   values and KST hours with the station's stored rows. Require numeric future PM
   and derived AQI slots, actual forecast source/publication and no values beyond
   the supported horizon. Date-only placeholders do not count.
4. Record acquisition freshness separately. Keep #2831 open until this
   non-AirKorea origin/public proof exists. A local replay or recovered AirKorea
   current observation alone is not production acceptance.

## Rollback

On station/provenance mismatch, current-value mutation, response errors or missing
usable stored forecasts after enrichment, restore the three saved deployed files
and hashes, preserving all other overlays. Perform the separately authorized
service restart/reload; confirm ordinary weather/current responses. Rollback
restores the old forecast omission during provider fallback. No DB cleanup or
provider/quota/key rollback is required.

[Architecture](../architecture/mobile-api.md#stored-hourly-air-forecast-fallback-2770-2831) ·
[Selected verification evidence](../evidence/tasks/issue-2831/verification.md)
