# Server data lifecycle and rewrite dependencies

Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected 2026-09-23. This document follows acquisition → persistence → read-time composition. Provider availability, credentials, current data freshness and present deployment were not tested. The [response assembly reference](server-response-assembly.md) contains the exact consumer order; [existing collection architecture](../architecture/weather-collection.md) supplies additional historical context.

## Product and storage map

Paths below identify checked-in models/adapters, not an inventory from a live MongoDB. Collection names derive from Mongoose models and can be pluralized by its configuration; do not migrate by guessing a collection name from a filename.

| Product | Producer / acquisition | Model or adapter | Read-time role and important key |
| --- | --- | --- | --- |
| Town/address/grid metadata | Town/geocode maintenance and local metadata | [town](../../server/models/town.js), [area numbers](../../server/models/modelAreaNo.js), [forecast zones](../../server/controllers/kma/kma.forecast.zone.controller.js) | Address → `{mx,my}` and `{lat,lon}`; life/health area and medium forecast zone selection |
| Grid current observation | Manager `/gather/current` → KMA requester | [legacy current](../../server/models/modelCurrent.js), [v2 current model](../../server/models/kma/kma.town.current.model.js), [v2 adapter](../../server/controllers/kma/kma.town.current.controller.js) | Current/history; grid + valid time; observation priority and yesterday |
| Short forecast | Manager `/gather/short` | [legacy short](../../server/models/modelShort.js), [v2 short adapter](../../server/controllers/kma/kma.town.short.controller.js) | Three-hour forecast baseline; grid, forecast time, publication |
| Shortest forecast | Manager `/gather/shortest` | [legacy shortest](../../server/models/modelShortest.js), [v2 shortest adapter](../../server/controllers/kma/kma.town.shortest.controller.js) | Current fallback, sky and near-term/rain corrections |
| Short RSS | Manager `/gather/shortrss` | [legacy RSS](../../server/models/modelShortRss.js), [RSS adapter](../../server/controllers/kma/kma.town.short.rss.controller.js) | Newer publication overrides / equal publication fills gaps in future slots |
| Medium forecast/land/temp/sea | Manager medium gather endpoints and RSS requester | [medium adapter](../../server/controllers/kma/kma.town.mid.controller.js), [legacy forecast](../../server/models/modelMidForecast.js), [land](../../server/models/modelMidLand.js), [temperature](../../server/models/modelMidTemp.js) | Forecast point, land region and temperature city/zone have different keys. Full mobile assembly consumes forecast/land/temp; collection of sea data does not mean this route returns it. |
| Station hourly/minute | Scraper jobs | [station controller](../../server/controllers/controllerKmaStnWeather.js), [hourly v2](../../server/models/modelKmaStnHourly2.js), [minute v2](../../server/models/modelKmaStnMinute2.js), older models also imported by controller | Nearest station, station timestamp, observed rain/cloud/temperature; repairs grid history/current |
| Weather warnings | Scraper special-weather job | [special controller](../../server/controllers/kma.specialweather.controller.js), [situation model](../../server/models/modelKmaSpecialWeatherSituation.js) | Town/near-station filtering; current warnings and separate `/kma/special` |
| Life indices | Scheduled life-index requester | [life controller](../../server/controllers/lifeIndexKmaController.js), [v2 model](../../server/models/kma/kma.lifeindex.model.js), [legacy model](../../server/models/lifeIndexKma.js) | Area number/geography and date; daily indices |
| Health indices | Scheduled health-day controller | [health model](../../server/models/modelHealthDay.js) | Area number, date, nearest-area fallback |
| AirKorea station/regional observations | Scheduled `keco` / `kecoSido` | [air controller](../../server/controllers/kecoController.js), [station readings](../../server/models/arpltnKeco.js), [region readings](../../server/models/sido.arpltn.keco.model.js), [station metadata](../../server/models/modelMsrStnInfo.js) | Town→station(s), measurement time; latest air + history + air standards |
| Regional daily air forecast | `/gather/kecoForecast` | [forecast model](../../server/models/modelMinuDustFrcst.js) | Region + date; daily pollutant forecasts |
| Hourly air forecast | KAQ/AirKorea image collection and decoding | [KAQ controller](../../server/controllers/kaq.hourly.forecast.controller.js), [hourly KAQ](../../server/models/kaq.hourly.forecast.model.js), [map case](../../server/models/kaq.map.case.model.js), [AirKorea controller](../../server/controllers/airkorea.hourly.forecast.controller.js), [hourly AirKorea](../../server/models/arpltn.hourly.forecast.js) | Station forecast and publication; query `airForecastSource` chooses source |
| Sunrise/sunset | Scheduled KASI collection | [KASI controller](../../server/controllers/kasi.riseset.controller.js), [rise/set model](../../server/models/modelKasiRiseSet.js) | Nearest geographic location/date; enrich daily weather |
| World DSF | Request-time fill in `getDsfData` | [DSF cache controller](../../server/controllers/worldWeather/dsf.controller.js), [DSF model](../../server/models/worldWeather/dsf.model.js) | Exact `[lon,lat]` + `dateObj`, local day/history coverage and current freshness |
| World air (WAQI) | Request-time station/feed or geographic lookup | [AQI controller](../../server/controllers/worldWeather/controllerAqi.js), [AQI model](../../server/models/worldWeather/modelAqi.js) | Geography/feed ID/measurement time; independently aged air enrichment |
| Time zone | Zone/coordinate cache and external resolution | [time-zone controller](../../server/controllers/timezone.controller.js) | Offset minutes; world local-day/history and DST-sensitive alignment |

Legacy KMA per-grid documents contain an array (`currentData`, `shortData`, etc.) and `pubDate` as `YYYYMMDDHHMM`. V2 current/short families use separate valid-time records with `mCoord`, `fcsDate`, `pubDate` Date and a weather payload. Their adapters project back to the older `{pubDate, ret}` request context. Medium products have their own schema and publication types; they are not covered by a single current/short migration.

The world cache stores UTC observation dates, an offset in minutes, current/hourly/daily data and `address`. In the DSF mapping, `address.country` can contain a provider time-zone identifier: it must not be interpreted as an ISO country code. `geo` is `[longitude, latitude]`; the client uses `{lat, long}`, the world JSON location uses `{lat, lon}`, and several intermediate helpers use `{lat,lon}`.

## Process modes and startup dependencies

`SERVER_MODE` defaults to `local`; `DB_DATA_VERSION` defaults to `1.0`. [Configuration](../../server/config/config.js), [startup](../../server/app.js).

| Mode | Automatic work established by `app.js` | Meaning for rewrite |
| --- | --- | --- |
| `service` | HTTP routes and Manager construction; no `startManager`/`startScrape` or push loops | Request-time DSF/AQI fills still occur; mode is not a guarantee of read-only process behavior |
| `gather` | `startManager` | Metadata/key setup, immediate collection pass, timer, DSF/time-zone maintenance |
| `scrape` | `startScrape` | Station minute/hourly and special-weather scraping |
| `local` | Both gather and scrape startup | Running the app can immediately call providers and write data; two `task()` loops share the same task array |
| `push` | Push controller and alert-push loops | Scheduled alarm/special-alert dependencies are separate from weather read APIs |

Routes are mounted independently of mode. `/gather/*` GET endpoints remain visible and can write data; some require objects initialized only by gather startup. A listener or `/health` response does not prove collector readiness or product freshness. A rewrite should make role ownership, initialization and route authorization explicit without assuming mode currently provides access control.

## Scheduled domestic ingestion

1. `startManager` initializes forecast-zone, air-station/key and life-index state, starts DSF/time-zone maintenance, then performs `checkTimeAndRequestTask(true)` and checks due tasks every 60 seconds.
2. `_requestApi` sends self-HTTP to configured `/gather/<name>` with a 24-hour request timeout. The gather route invokes the product collector; this timeout is distinct from each provider HTTP timeout.
3. KMA forecast collection determines publication time/grid, calls `collectTownForecast.requestData`, parses XML/category rows and normalizes product fields. Provider requests use a 10-second timeout; requester retry policy and Manager recursion are separate layers.
4. `_recursiveRequestData` starts with budget 70 for whole-grid current/short/shortest work. Completed results save serially; failed or invalid coordinates can be recursively retried (zero-delay rescheduling, not exponential backoff). Some invalid-temperature retry paths adjust publication time.
5. `getSaveFunc` dispatches to a product writer. Current/short/shortest writer wrappers recognize DB versions `1.0` and `2.0`; an unknown value has no generic successful save branch. Product cleanup and publication checks vary by product. No transaction covers weather, station, air, life and astronomy together.

Sources: [Manager](../../server/controllers/controllerManager.js) (`startManager`, `_requestApi`, `_recursiveRequestData`, `getSaveFunc`), [gather routes](../../server/routes/v000001/routeGather.js), [KMA requester](../../server/lib/collectTownForecast.js).

### Trigger matrix

Times below are literal scheduler checks, **not provider publication guarantees**. Minutes are UTC (the minute value happens to match Korea's whole-hour offset).

| Task | Check | Dispatch |
| --- | --- | --- |
| Current | Minutes 2,12,22,32,42,52 | Direct self-HTTP |
| Shortest | 48,54,4,14 | Direct self-HTTP |
| Short | 13 | Direct self-HTTP |
| Station air / regional air | 3,13,23,33,43,53 / 4,14,24,34,44,54 | Direct self-HTTP |
| Past, dust forecast, medium temp/land/forecast/sea, medium/short RSS | 2 | Queued |
| Life | 10 | Queued |
| Health | 10 and `getUTCHours()+9 === 6 || === 18` | Queued; no modulo 24 in this expression |
| KAQ hourly | 7 at UTC hours 8,9,10,11,20,21,22,13 | Queued controller call |
| Station rain hit-rate | 50 | Direct, not forced by startup `putAll` |
| KASI rise/set | 55 | Direct self-HTTP |
| Scrape station minute | Even minutes | Queued by `startScrape` timer |
| Scrape warnings | Minutes divisible by 3 | Queued |
| Scrape station hourly | 4,6,9,15 | Queued |

Startup `putAll` forces Manager tasks other than rain hit-rate. The health expression cannot reach 6 because adding nine yields 9–32; the KAQ hour list ends in literal `13`. These are observed source quirks, not corrected intentions or proven current production schedules.

`task()` pops the pending array into a batch and runs `async.series`: **LIFO batches**, not FIFO delivery. The next drain is scheduled 30 seconds after completion. Direct self-HTTP jobs bypass this series and can overlap; multiple processes have no visible shared scheduler lock in this path. A pending array longer than 17 causes a logged process exit. Durable queueing, leader election, idempotency keys and rate limits are rewrite design decisions, not capabilities demonstrated by this code.

## Freshness, fallback and failure boundaries

| Boundary | Observed behavior | Required rewrite decision / test |
| --- | --- | --- |
| Domestic weather read | Primarily DB reads; per-product publication dates survive assembly; read errors often log and continue | Define required versus optional products, maximum age and explicit partial response metadata |
| Current grid observation | Exact hour, then observation under three hours old, then forecast-derived current if a stale record was returned | Distinguish stale, unavailable, estimated and observed values |
| Station correction | Hourly history repairs invalid temperature; minute/station fields merge with per-field validity and timestamp rules | Characterize overlapping and disagreeing stations, valid zero, missing and sentinel values |
| KASI read | `getRiseSetList` returns DB results even when empty because `rsListFromDB.length >= 0`; the following API fallback is unreachable on normal array results | Do not promise on-demand sunrise recovery because a requester function exists. Decide whether to activate fallback in a new contract. |
| Nationwide overview | Regional air read followed by 15 parallel configured API-server HTTP weather requests, each with 9s timeout | Define aggregate concurrency budget, partial-city policy and retry amplification |
| KMA preload | Independent family groups and later re-reads; no coherent all-product snapshot | Freeze clocks/publications in comparison fixtures; do not infer atomic freshness from request completion |
| DSF cache | 15-minute current check plus local-day/history completeness; missing current may call provider | Model cache key, source, valid time, fetch time and local date separately |
| DSF yesterday | Complete hourly day plus comparison time required; fills holes from DB, otherwise refetches history up to three attempts | Test midnight, DST days, missing one hour and missing yesterday entirely |
| DSF current/time zone | Errors can propagate and fail request; lookup error can use an existing offset if available | Explicit time-zone fallback policy; avoid silently assigning wrong day |
| DSF history/write | Some historical fetch/parse/save errors log and continue | Current response availability does not establish durable history or cache consistency |
| AQI cache | 60-minute freshness; known-feed then geographic fallback; missing air often tolerated, propagated errors still fail parallel join | Test absence separately from callback error and corrupt records |
| AQI join | `_compareDate` requires equal `getUTCDate()` and `(weatherTime-airTime)/hours <= 6`, with **no lower bound** | Source quirk: future measurements may qualify; month/year equality is not explicitly checked. Decide and test intended temporal window. |
| Gather handler | Some routes log collection errors but still send an empty successful response | Measure product publication progression and ingestion failures, not just HTTP status |
| DSF maintenance | Daily removal of records older than two days starts with gather Manager, not service mode | Assign retention/cleanup ownership explicitly |

Sources: [domestic assembly](../../server/controllers/controllerTown.js), [KASI reader](../../server/controllers/kasi.riseset.controller.js), [DSF cache](../../server/controllers/worldWeather/dsf.controller.js), [AQI join and retrieval](../../server/controllers/worldWeather/controllerWorldWeather.js), [gather routes](../../server/routes/v000001/routeGather.js).

The DSF requester still targets the historical `api.darksky.net/forecast/` shape with a 5-second request timeout and retry counter initially 5 for selected connection/reset/invalid-JSON errors. This documents the code's dependency, not current provider viability. [DSF requester](../../server/lib/DSF/dsfRequester.js). Modules for older WU/other providers and a legacy `controllerCollector.doCollect` loop are not evidence that they run on the current v000903 path; the inspected app startup does not invoke that collector loop.

## Rewrite dependency inventory

| Dependency | What must be recovered or replaced | Evidence boundary |
| --- | --- | --- |
| Gateway | Public path/version mapping, country/geocode dispatch, headers, TTL/error behavior | Outside checkout; [2026-09-20 AWS/code evidence](../architecture/aws-code-correlation.md) is a timestamped starting point |
| Geographic data | Domestic town/grid mappings, address aliases, station lists, forecast zones, world time-zone lookup | DB/import content and current completeness not verified by source inspection |
| Weather providers | Raw fixtures, credentials, quotas, publication calendars, history availability, rain/snow/unit semantics | Historical source URLs alone do not prove a usable provider |
| Air data | Station identity, geographic coverage, index standard, daily/hourly projections and map images | Air standards cannot be treated as interchangeable display labels |
| KASI/life/health | Area matching, locality/date granularity, missingness and update schedule | Sparse products are currently tolerated in several paths |
| Persistence | Both DB formats, Date/string timestamp conversion, geographic index order, retention and duplicate handling | No live export or schema migration was executed |
| Localized summaries | Locale messages, severity ranking, warning precedence, unit-aware text | Shared domestic helpers also shape world responses |
| Native clients | Unversioned/v000901 routes, shared preference format, widgets, push tokens/settings | Current Angular source does not enumerate every shipped consumer |
| Operations | Gather/scrape/service/push role ownership, scheduler liveness, per-product age, error logs, request correlation | Historical service host used a different revision; separate gather host internals remain unverified |

Before replacement, retain approved raw input fixtures and expected composed responses, each carrying source revision, clock/time zone, database version, units, locale and product publication dates. Keep live credentials out of fixtures and documentation. Design comparison tests around business semantics (extrema, rain totals, missingness, yesterday and station selection), not merely structural JSON equality. The [verification matrix](verification-matrix.md) and [rewrite playbook](rewrite-playbook.md) translate these dependencies into migration gates.

## Scope and limitations

This lane changed documentation and diagrams only. Diagram artifact validation, browser containment and image review are recorded separately in [server diagram verification](../../reports/rewrite-verification/server-diagram-verification.md). No live database/provider check, server test suite, collection job or deployment was run. Existing integration suites include provider/database dependencies and cannot be reported as passed from static reading.
