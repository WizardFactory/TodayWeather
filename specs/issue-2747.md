Task: issue-2747-s13d; revision/base: 05c06c67; date: 2026-10-14. Inputs: [intent](../intent/issue-2747.md).

# Specification

## Sources of each decision

Every rule below follows (1) the provider's documentation, (2) the legacy collector, and (3) how the
legacy service (`tw_svc`) assembles a response when data is missing. Legacy references are at
`server/` on master `f49921b6` (the base after merging #2746; other cited files are unchanged since `05c06c67`).

| Service | Legacy per-request timeout | server2 constant |
| --- | --- | --- |
| VilageFcst 2.0, MidFcst | `server/lib/collectTownForecast.js:373` (`timeout: 1000*10`) | `legacy_timeout::TOWN_FORECAST` 10 s |
| Forecast zone `getFcstZoneCd` | `server/controllers/kma/kma.forecast.zone.controller.js:123` (10000) | `TOWN_FORECAST` 10 s |
| UV V5, pollen V3 | `server/lib/lifeIndexKmaRequester.js:1277`, `:1495` (30 s) | `LIFE_INDEX` 30 s |
| Warnings `WthrWrnInfoService` | `server/lib/kmaWarningRequester.js:20` (`TIMEOUT_MS = 30*1000`) | `WARNINGS` 30 s |
| AirKorea B552584 (all four operations) | `server/lib/airkoreaObservation.js:189` (`timeoutMs` default 5000) | `AIRKOREA` 5 s |
| KASI `getAreaRiseSetInfo` | `server/controllers/kasi.riseset.controller.js:92` (5000) | `KASI` 5 s |
| KMA AWS and city pages | `server/lib/kmaScraper.js:206`, `:269` (30000) | `KMA_WEB` 30 s |
| KMA town RSS | `server/controllers/kma/kma.town.short.rss.controller.js:107` (no timeout) | `KMA_WEB` 30 s (bounded) |
| Visual Crossing | `server/controllers/worldWeather/dsf.controller.js:53` (`fetchTimeoutMs` 8000) | `VISUAL_CROSSING` 8 s (S11 already used it) |
| World air providers | `server/config/air.js:49` (`providerTimeoutMs` 3000) | unchanged S13a 3 s |

A data.go.kr path that names none of these services keeps the former 3 s. The connect timeout is
3 s; the attempt timeout includes it.

Absent-data output in legacy assembly:

- Domestic: the v000903 chain reads stored products only and is best effort; a missing product
  leaves its section out or keeps its placeholders, and `makeResult` still sends the body
  (`docs/rewrite/server-response-assembly.md` sections 2-3, lines 48, 103 and 169;
  `docs/architecture/mobile-api.md:83` and `:95` for UV/pollen/air absence).
- World weather: a fetch slower than the 2.5 s response budget answers through `_fallback`
  (`dsf.controller.js:52`, `:1016`): stored current or a stale current up to 6 h, with stored
  yesterday/today; with no current record it is an error, as before
  (`server-response-assembly.md:189-190`).
- World air: the air deadline answers `airStatus: {state: pending, retryAfterSeconds: 3}`
  (`server/controllers/worldWeather/controllerWorldWeather.js:679`, `mobile-api.md:323`).
- 503 `EWEATHERUNAVAILABLE` stays only where legacy returns it (VC provider-down marker and daily
  budget, `dsf.controller.js:898`, `:916`). S13d adds no use.

Pollen V3 fields: the [dataset 15085289](https://www.data.go.kr/data/15085289/openapi.do) Swagger
(read 2026-10-15) names the day+3 field `todaysaftertomorrow` ("글피 예측값"). The attached manual
(`기상청_보건기상지수 조회서비스(3.0)_오픈API활용 코드 상세 설명서(20240425)`) says the 18시 issue covers
tomorrow, the day after and day+3 (내일, 모레, 글피) and lists no field names. Two live weeds calls
on 2026-10-15 00:07 KST (issues 2026101418 and 2026101406) returned `today`, `tomorrow`,
`dayaftertomorrow` and `twodaysaftertomorrow`, and no `todaysaftertomorrow`. Both names are
accepted; legacy `lifeIndexKmaRequester.js:1462` reads only `todaysaftertomorrow` and so drops
day+3.

## Behavior

1. **Transport.** `providers::attempt_timeout(provider, endpoint)` selects the table value from the
   service segment of the request path (`1360000/<Service>/...`, `B552584/...`, `B090041/...`).
   `HttpProviderTransport` sets it per request. `HttpPublicTransport` uses `KMA_WEB`.
   `family::Service::attempt_timeout` and `WebFamily::attempt_timeout` expose the same values to
   owned callers; a test checks that both agree for every family path.
2. **Owned time.** `family::owned_provider_time(attempt, pages) = 2 x attempt x pages`: the two
   HTTP attempts that S08/S13 allow on each page. S14 capture uses
   `now + owned_provider_time(attempt, family max pages) + call_timeout` (the former
   3 s is now only the publication allowance). The S07 resolver default `acquisition` is 63 s (two
   30 s attempts plus 3 s), at most 600 s; callers set it per family.
3. **Shared owned acquisition (`resolver::OwnedFlights`).** One owned task per key. The key is a
   grid publication or a national dataset and publication time. The first joiner starts the task
   with `owned_for` (at most 600 s); the task never observes a waiter. `join` returns at
   `min(ready_by, now + 3 s)`:
   - `Ready(T)` when the task finished (also within `retain` after it finished, so a request that
     read the store just before publication does not start a second acquisition);
   - `Pending { owner_deadline }`: the caller omits the section;
   - `Expired`: the task hit its own deadline; `Failed`: it ended without an outcome (a panic), and the key is free again;
   - `Busy`: the running bound is full; nothing started.
   `wait` is the same without the 3 s cap, for an owned caller such as an S07 response owner.
4. **S07 resolver.** The request waiter is capped at 3 s (`WAITER_BOUND`). The response owner
   reads S3 first; on a proved miss it joins the shared acquisition keyed by the repair scope
   (catalog and periods, not the response key), so responses for other locations, locales or units
   share one provider call. The shared task funds through the `FundedAcquirer` (S08 before HTTP),
   invalidates response reuse before a possible write and publishes the complete group (S06). The
   owner then reads the published scope and assembles within a new stage bound. A waiter that timed
   out leaves all of this running; the next request is a response-cache hit or a cold S3 read.
5. **S11 world.** The weather waiter ends 150 ms before the attempt deadline (and at most 3 s), so
   the legacy `_fallback` answer is assembled before the S10 dispatcher's own attempt timeout. The
   owned VC fetch (8 s) and the owned air task continue and publish. Behavior otherwise unchanged.
6. **S10 dispatcher.** Unchanged: one native attempt of `min(3 s, remaining gateway deadline)`.
7. **Pollen.** `twodaysaftertomorrow` is an index field for the life-index row check.

## Non-goals

No new HTTP status, header or response field. No route switch. No live production behavior claim.
