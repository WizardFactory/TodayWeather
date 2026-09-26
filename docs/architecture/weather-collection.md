# Weather data collection

## Two collection strategies

Domestic KMA and air products are gathered on a schedule and combined when requested. World-weather requests use database lookup and on-demand Visual Crossing/WAQI fetching. A legacy world collector also exists, but its recurring `doCollect()` loop is not invoked by the inspected application startup.

[Interactive domestic pipeline](diagrams/weather-collection.html) · [World-weather request](diagrams/mobile-weather-request.html)

## Domestic startup and dispatch

`app.js` creates a global `Manager`. In `gather` or `local`, `startManager()` initializes AirKorea/geographic keys and station metadata, life-index timing, forecast-zone data, DSF database maintenance and time-zone maintenance. After station initialization, it calls `checkTimeAndRequestTask(true)` for an immediate pass, starts `task()`, then checks due work every 60 seconds.

`_requestApi(name)` sends HTTP to `http://<configured bind address>:<port>/gather/<name>` with a 24-hour request timeout. This works because `/` mounts the oldest router, which includes `/gather`. The versioned routers also expose collection handlers. These GET routes can perform provider calls and database writes; they are not passive health checks.

`task()` removes pending functions with `pop()` into a temporary list and executes `async.series`. It waits 30 seconds **after completion** before draining again. This is a process-local LIFO batch, not a FIFO broker. Several freshness-sensitive tasks bypass the array and send self-HTTP requests directly, so not all collection work is serialized. When the pending array exceeds 17 entries, the schedule check logs it and exits the process. No distributed lock or shared leader election is visible in this path.

Evidence: [startup](../../server/app.js), [Manager: `task`, `_requestApi`, `checkTimeAndRequestTask`, `startManager`](../../server/controllers/controllerManager.js), [collection endpoints](../../server/routes/v000001/routeGather.js).

## Schedule as implemented

These are scheduler trigger times, **not provider publication guarantees**. `getUTCMinutes()` drives the minute checks. Startup `putAll=true` forces the listed work except `updateStnRnsHitRate`. Individual requesters can decide that a product is not yet due.

| Task / endpoint | UTC minute check | Dispatch |
| --- | --- | --- |
| `current` | 2, 12, 22, 32, 42, 52 | Direct self-HTTP |
| `shortest` | 48, 54, 4, 14 | Direct self-HTTP |
| `short` | 13 | Direct self-HTTP |
| `keco` real-time station air | 3, 13, 23, 33, 43, 53 | Direct self-HTTP |
| `kecoSido` regional air | 4, 14, 24, 34, 44, 54 | Direct self-HTTP |
| `past`, `kecoForecast`, `midtemp`, `midland`, `midforecast`, `midsea`, `shortrss` | 2 | Queued, drained in reverse insertion order; `past` only while `GATHER_PAST_ENABLED` is not `false` |
| `lifeindex` | 10 | Queued |
| `healthday` | 10, with `getUTCHours()+9 === 6 || === 18` | Queued; actual expression has no modulo 24 |
| KAQ hourly forecast | 7, UTC hours 8, 9, 10, 11, 20, 21, 22, 13 | Queued controller call, not self-HTTP; only while `GATHER_AIR_FORECAST_ENABLED` is not `false` |
| `updateStnRnsHitRate` | 50 | Direct; not forced at startup |
| `gatherKasiRiseSet` | 55 | Direct self-HTTP |

The health-day expression can reach 18 at UTC 09, but cannot reach 6 because adding 9 produces 9–32. The KAQ hour list includes 13 literally; do not silently correct it to 23. Periodic CloudFront invalidation and `updateInvalidt1h` dispatch are commented out. These observations describe existing code; this task changes no schedules. The [gather runtime policy](../operations/gather-runtime-policy.md) flags can disable the `past` and KAQ jobs; the minute checks stay fixed.

## KMA fetch → normalize → persist

1. `/gather/current`, `/short`, and `/shortest` select a key and call the corresponding manager method with base offset `9`. Query-time helpers select product-specific base date/time; `town.getCoord()` supplies domestic grid coordinates.
2. `_recursiveRequestData(..., retry, ...)` dispatches through `collectTownForecast.requestData()`, choosing a random key from the configured town forecast key list for each recursive pass. The retry budget defaults to 70 passes (town and mid products) and 50 for the invalid-T1H current update. [Gather runtime policy](../operations/gather-runtime-policy.md) lists the environment overrides.
3. The requester builds `http://apis.data.go.kr` URLs for current, shortest, short and medium-range products, performs HTTP with a 10-second per-request timeout, accepts success code `00`, parses XML through `xml2js`, and maps category values into forecast records. Invalid/empty responses fail collection without logging service-key-bearing URLs. The requester's own retry count defaults to zero when constructed without options; manager recursion is a separate retry layer.
4. `async.mapSeries` saves completed items via `getSaveFunc()`. Failed coordinates are retried using a decremented recursion count. Invalid temperature coordinates can be retried with an adjusted shortest publication time. Recursion uses a fixed timer delay (`GATHER_RETRY_DELAY_MS`, default 0), not exponential backoff.
5. `getSaveFunc()` routes current/shortest/short to v2 KMA controllers when `DB_DATA_VERSION === '2.0'`; with `DB_DATA_VERSION === '1.0'`, legacy `saveCurrent`, `saveShortest`, `saveShort` merge/update per-grid documents. Other values have no save branch or callback in these three wrappers; there is no generic fallback. Medium-range products use their own save functions. There is no transaction covering all weather products.
6. Product-specific cleanup removes old KMA records. `_checkPubDate()` also supports skipping already-current products in callers that use it; the three whole-grid methods shown above directly invoke collection, so do not assume publication deduplication applies uniformly.

Sources: [manager collection and save selection](../../server/controllers/controllerManager.js), [requester](../../server/lib/collectTownForecast.js), [v2 current controller](../../server/controllers/kma/kma.town.current.controller.js), [legacy current](../../server/models/modelCurrent.js), [v2 current](../../server/models/kma/kma.town.current.model.js).

Legacy documents carry `pubDate=YYYYMMDDHHMM` and `date`/`time` values. Invalid measurements use field-specific sentinels such as `-50` temperature or `-1` missing values. Preserving invalid-value handling matters: treating a sentinel as a real observation changes merged forecasts and yesterday comparisons.

## KMA source reconciliation and period limits

[#2555 source reconciliation](gather-source-reconciliation.md) records the seven migrated paths, all appendix dispositions, inactive legacy-gather policy and operator deployment/rollback handoff. PCP/SNO/TMP map into the existing r06/s06/t3h schema with strict finite parsing and existing missing sentinels; RN1 zero stays zero. These field aliases **do not establish six-hour accumulation or three-hour cadence**. The existing 24h consumer still splits adjacent quantities; characterization tests expose this limitation rather than claiming period equivalence. Products larger than one 999-row page are fetched page by page (at most 5) and merged; a partial or inconsistent page fails the grid before organization (#2590). Sea wave values retain each day’s own input. Raw or once-percent-encoded keys normalize to one query encoding. Hold hourly short activation until legacy period consumers are repaired and verified; source schedules are not a feature gate. No schedule, retry default, DB version or provider authorization changes here.

## Grid RSS wind contract (issue #2554 local repair)

The [RSS parser](../../server/controllers/kma/kma.town.short.rss.controller.js) stores numeric `ws` (m/s), numeric `wd` (eight compass sectors), and separately encoded `wdKor`/`wdEn` labels. `wdEn` now comes from the upstream English wind label rather than repeating the `wfEn` weather assignment. Unknown or absent English direction remains `-1`. Both legacy per-grid documents and v2 per-slot documents retain their existing schemas; historical `wdEn=-1` is not backfilled by this repair.

The [KMA RSS format](https://www.kma.go.kr/w/resources/pdf/dongnaeforecast_rss.pdf), pp. 1–2, defines the numeric and text codes separately:

| Direction | RSS `wd` | Service `vec` (degrees) | Stored `wdEn` / `wdKor` |
| --- | --- | --- | --- |
| N | 0 | 0 | 2 |
| NE | 1 | 45 | 3 |
| E | 2 | 90 | 1 |
| SE | 3 | 135 | 6 |
| S | 4 | 180 | 5 |
| SW | 5 | 225 | 7 |
| W | 6 | 270 | 8 |
| NW | 7 | 315 | 4 |

The service maps `ws → wsd` and `wd × 45 → vec`; code `8`, fractional directions and missing/non-numeric/nonfinite values are rejected, not wrapped. North is `0`, so zero is a valid value. `wdEn` is not used to infer `vec`, including for historical rows with its sentinel. See [response merge policy](mobile-api.md#rss-fallback-contract-issue-2554-local-repair).

The legacy collector `calculateTime()` is host-timezone-sensitive: it parses a timezone-less timestamp as local time and then adds the host timezone offset. The XML-to-response smoke therefore explicitly uses `TZ=UTC`. A non-UTC host can shift forecast slots; that pre-existing defect is outside this wind repair. Deployment preparation must verify the gather process timezone or resolve that separate defect before claiming the whole pipeline is correct. V2 publication Date/KST conversion and service matching are tested separately.

This section and the RSS card in the collection diagram describe the local repair, not an observed production deployment. The original diagram revision continues to identify its pre-existing topology evidence. Regression fixtures are synthetic; the issue's Seoul/Busan/Jeju observations remain timestamped investigation evidence, not a nationwide audit.


## Scraping and auxiliary products

`startScrape()` runs in `scrape` or `local`, pushes initial minute, hourly and special-weather jobs into the same task array, installs a 60-second timer and calls `task()` itself. Thereafter minute observations enqueue on even minutes, special-weather situations on minutes divisible by 3, and hourly station observations at minutes 4, 6, 9 and 15. Scraper callbacks recognize `'skip'` for already-updated observations. In `local`, both startup methods call `task()`, so two drain loops share one array.

In `gather` mode, two opt-in collectors (#2573) run outside that task array. `KMA_STN_MINUTE_ENABLED=true` starts `startMinuteScrape()`, which polls AWS minute observations every `KMA_STN_MINUTE_INTERVAL` minutes (default 2). `KMA_STN_HOURLY_ENABLED=true` starts `startHourlyScrape()`, which runs the AWS hourly table plus city observation page at UTC minutes `KMA_STN_HOURLY_MINUTES` (default `4,9,15,30`). Each keeps one run in flight and logs failures without stopping. Both flags default off; `scrape`/`local` scheduling is unchanged. The city page is decoded by its declared charset (UTF-8 since 2021) and parsed in either layout. If it fails, the AWS hourly rows are still saved. New stations get a `KmaStnInfo` row through Kakao geocoding or, without a Kakao key, the product geocode API at `API_SERVER/geocode/addr`. New AWS-only stations then feed the nearby-station rain check and `nearStnName`; current `t1h/reh/vec/wsd` still come from city stations. Stations that neither can geocode are saved as observations only and retried at the next hourly run. Storage keeps the legacy KST-as-UTC timestamps and existing retention. See the [operator runbook](../operations/kma-station-observations.md).

| Product | Main path | Use at read time |
| --- | --- | --- |
| Station minute/hourly and warnings | `kmaScraper` → station/special-weather models | Correct/augment gridded current weather, precipitation and alerts |
| Short RSS | `kma.town.short.rss.controller` | Supplement short API forecasts |
| Legacy mid RSS (retired, #2560) | `midRssKmaRequester` | Collection/storage disabled; cached medium data is not applied |
| AirKorea observations and forecast | `kecoController`, `kecoRequester` | Station/regional pollutants, forecast and air indices |
| KAQ / AirKorea hourly image forecasts | `kaq.hourly.forecast.controller`, `airkorea.hourly.forecast.controller`, image parsers | Hourly pollutant projections; selected by `airForecastSource` |
| Life and health indices | `lifeIndexKmaRequester` (UV from `LivingWthrIdxServiceV5/getUVIdxV5`, #2587), `controllerHealthDay` | Weather/life advisories |
| Sunrise/sunset | `kasi.riseset.controller`; days without a stored row are computed by `lib/sunRiseSet.js` at request time | Day/night and astronomical context |

Sources: [scraper](../../server/lib/kmaScraper.js), [AirKorea controller](../../server/controllers/kecoController.js), [KAQ hourly](../../server/controllers/kaq.hourly.forecast.controller.js), [AirKorea hourly](../../server/controllers/airkorea.hourly.forecast.controller.js), [sunrise/sunset](../../server/controllers/kasi.riseset.controller.js). UV collection runs year-round. It requests all areas for the latest issued three-hour KST slot (up to four earlier slots), and after saving the current slot's issuance it waits for the next slot. It pages through `totalCount` and stores one value per area and day (the day's maximum, only for days whose 12:00 value is present). On an authorization failure the KASI job moves from `DATA_GO_KR_NORMAL_KEY` to `DATA_GO_KR_TEST_NORMAL_KEY` and then to the `DONGNAE_SECRET_KEYS` entries, and it continues after a failing area. UV tries the cert, test cert, normal and test normal keys, then the forecast keys. On 2026-09-26 the deployed normal/test key was expired for KASI and unregistered for UV; one forecast key was approved for both. The food-poisoning index still uses the retired legacy host. Some auxiliary products have their own internal due-time/cache checks; the schedule above is only the manager's dispatch contract. Per-endpoint provider hosts, timeouts, retries, credential variable names and failure detection: [external provider catalog](../rewrite/external-providers.md).

## Overseas (Visual Crossing) request-time collection

`/v000903/dsf/coord/:loc` reuses the v000902 handler. `queryTwoDaysWeatherNewForm()` runs world-weather and AQI work in parallel. Since #2585 the overseas provider is the Visual Crossing Timeline API; Dark Sky was retired in March 2023. Route paths, `DsfController`, the `DsfForecast` model and `req.DSF` keep their DSF names. The active path is `DsfController.getDsfData()`:

1. Parse requested coordinates into Mongo order `[longitude, latitude]` and query the stored records of the last three days (`dateObj` at or after request time − 3 days), sorted by `dateObj`.
2. Select yesterday, today and current records by local calendar date. A record's own day uses the offset it was stored with; "today" and "yesterday" use the offset in effect now, computed once per read from the newest record. That record's stored offset (Visual Crossing's, at fetch time) is authoritative. The runtime's zone data (`Intl` with the IANA zone in `address.country`) only moves it across a later daylight-saving change, and only when `Intl` reproduces the stored offset at that record's time. The service's Node 10.15.3 ships 2018 zone data, which is wrong in 2026 for some zones (for example `Asia/Almaty`) and lacks newer names (for example `Europe/Kyiv`); those use the stored offset. Yesterday and today must be local-midnight records. After a daylight-saving fall-back two midnight records can share a local day; the most recently fetched (`pubDate`) wins for today and yesterday. The current freshness window is 15 minutes, on today's local date, and the newest such record wins; the newest other record up to 3 hours old is kept as a stale fallback. A stale fallback from before local midnight still carries the previous day's labels and daily rows. A yesterday record counts only when it was fetched after that local day ended (`pubDate` at or after the start of local today); the previous day's last `today` refresh still holds forecasts for its later hours, so the first request of a day makes one `combined` call. Such a record holds mostly observations, but its latest hours can still be forecast values when stations report late. Hours missing from an accepted record (for example on a daylight-saving change) no longer trigger a refetch, and malformed records are skipped.
3. If all three exist, no provider call is made. Otherwise `_checkProvider()` skips the call while the provider is marked down or an optional daily budget would be exceeded (see below). `_requestDatas()` then takes a per-location lock in `vc.fetch.locks` (`_id` `"<lon>,<lat>"`, `expireAt` 10 seconds ahead with a TTL index; an expired lock is taken over and its `failed` flag reset; if the lock disappeared between the create and the takeover, the create is retried once; the holder deletes only its own lock, matched by `expireAt`; if the lock store errors, the worker fetches anyway, rate-limited as below), re-reads the records, and makes one Timeline call: `combined` (`yesterday/next7days`) when yesterday is missing, otherwise `forecast` (`today/next7days`). The request is answered within 2.5 seconds of the request time (`responseMs`, measured from `cDate`, so the reads before the lock count), inside the gateway Lambda's 3-second attempt. This budget covers the weather branch only; the AQI branch runs in parallel with its own timing. The holder's call may run for up to 8 seconds (`fetchTimeoutMs`, under the lock TTL) and still stores its records for the gateway's next attempt. A worker that does not get the lock re-reads every 250 ms until 2.5 seconds after its request time (`waitMs`; at most 10 polls) and returns once current and today exist. Waiters and the re-read after locking classify records with the later of the request time and now. After a failed call the holder sets `failed: true` and moves `expireAt` 2 seconds ahead (`failureBackoffMs`): waiters stop at once, and a failing location makes at most one provider attempt per 2 seconds. A failure after an HTTP 200 (a billed body that is invalid or cannot be converted) would repeat, so it backs the location off for 15 minutes (`badResponseBackoffMs`). If a billed `combined` call returns no local yesterday, the marker `~noyesterday:<lon>,<lat>` in `vc.fetch.locks` (until the next local midnight) serves the location without yesterday and refreshes it with `forecast`; it is logged at `error`. When the lock store fails, a worker fetches without the lock at most once per location per 15 minutes (`unlockedFetchMs`), so an unavailable Mongo cannot turn every request into a 25-record call. The gateway retries an error immediately, a fast 5xx included, and a timed-out attempt after its 3-second limit ([Lambda excerpts](deployed-lambda-excerpts.md)); a retry within those 2 seconds gets the stored-record fallback or the error without a new provider call.
4. `vcConverter` turns the Timeline body into Dark Sky-format yesterday/today/current documents in `us` units, so `_parseData()` and the world merge/unit code are unchanged. The zone comes from Visual Crossing `timezone`. The UTC offset is the one in effect at request time, taken from the latest hour row (local `datetime` against `datetimeEpoch`), because the top-level `tzoffset` is the offset at the start of the requested range and differs after a daylight-saving change. The current hour starts at the local hour boundary, so half-hour and 45-minute zones are handled; a `forecast` answered for the next local day within 5 minutes before local midnight is converted as that day; without `currentConditions`, the current local hour's row stands in. A day without sunrise or sunset (polar day or night) stores `null` for it. Google time-zone lookups are no longer made on this path. The `address.country` field stores that IANA zone string, not an ISO country code. `_saveData()` upserts by `geo` plus `dateObj`, current last; a fetch at exactly local midnight stores current one second later, so it does not replace today's record. Reads use the `{geo: 1, dateObj: 1}` index; save errors are logged while the response continues with fetched data.
5. When no fresh data can be fetched (provider or conversion error, missing key, the 2.5-second response budget exceeded, a waiter that sees `failed` or times out, the provider marked down, or the daily budget reached), `_fallback()` serves the stored records if a current record exists: the fresh one, else the stale one up to 3 hours old (`staleMs`), together with any stored yesterday and today. Otherwise the error reaches the existing `next(err)`/500 path.
6. The world-weather controller converts local times and merges daily/current/hourly records, sets `source: "VC"` and `pubDate.VC`; route middleware converts requested units and computes descriptions and summaries. A stored offset of 0 (UTC+0, for example London in winter) counts as an offset rather than a missing value, which fixed a 500 on the autumn daylight-saving day in such zones. The merges ignore the −100 missing-value sentinel for temperatures, wind direction, pressure and daily humidity (hourly and current humidity turn it into 0), and omit a `null` sunrise or sunset. A humidity or visibility Visual Crossing omits shows as 0 after `convertUnits` (pre-existing default).

`vcRequester` uses a shared keep-alive HTTPS agent, sends `Accept-Encoding: gzip` and gunzips the body, and rejects bodies over 4 MB. A body needs `days` and `timezone`, and either a numeric `tzoffset` or hour rows (the offset comes from the hour rows). The key is scrubbed from error bodies before they are truncated. Its `timeoutMs` is a budget for the whole call, including one retry (default 2.5 seconds; `DsfController` passes 8 seconds). It retries once only for a concurrency 429 (body matching `/concurren/i`, received within 1.5 seconds; the Free plan's live body is `Maximum concurrency exceeded`; after 300 ms plus a random 0–300 ms, so colliding requests spread out) or a reset keep-alive socket (`ECONNRESET`/`EPIPE`) while budget remains. A 401/403, or a 429 whose body names a daily, monthly, usage, quota, cost or records limit, sets `err.providerDown`; any other 429 is treated as transient for that location (the 2-second backoff, no retry, no marker); `DsfController` then upserts the marker document `_id: "~provider"` in `vc.fetch.locks` with `expireAt` 10 minutes ahead (`providerDownMs`). While the marker is active, no provider call is made and the fallback above applies. The optional budget `VC_DAILY_RECORD_LIMIT` (`config.vc.dailyRecordLimit`; 0 or unset means none) is checked against the current UTC day's `vc.usage` counter before each call, with a cost of 25 for `combined` and 1 for `forecast`. Each call that reaches the network updates that counter: one document per UTC day (`_id` `"YYYY-MM-DD"`) with `$inc` counts of `calls`, `records` (sum of `queryCost`), `failures`, `http429` (every 429 received, including one recovered by the retry) and `slow` (longer than the 2.5-second response budget). A duplicate-key error when two workers create the day's document at once is retried once. The budget check reads the counter before the call, so concurrent workers can overshoot it slightly: it is approximate. Failures are logged at `error`, which the production console still shows (`NODE_ENV=production` raises the console level to `error`); successes are logged at `info` as `VC> range=... loc=<lat>,<lon> status=... cost=<queryCost> ms=...`. Logged coordinates are rounded to two decimals, the key is scrubbed in raw and URL-encoded form, and URL coordinates are plain decimals without exponent notation. A missing or placeholder `VC_SECRET_KEY` fails without a network call, and loading `dsf.controller` logs an error when it is missing. Measured on 2026-09-26, a `combined` call cost 25 records and a `forecast` call 1 record. The legacy `dsfRequester` no longer contains a Dark Sky URL and returns a "Dark Sky API retired" error immediately.

Retention: `maintainDB()` runs every day when `startManager` starts it (gather or local mode) and removes `dsfforecasts` records older than two days. It is not started in `service` mode, so the records are purged only when a gather or local process uses the same database. `vc.fetch.locks` documents expire through their TTL index. `vc.usage` is not purged; it holds one small document per day.

Deployment and rollback: the inspected service host runs Node 10.15.3 with Mongoose 5.1.2 on a hand-edited `5bca407` checkout ([EC2 internals](ec2-internals.md#deployment-identity-and-repository-differences), 2026-09-20 observation). `server/test/offline/vc-node10-check.js` runs the Visual Crossing path on Node 10.15.3 (CI job `vc-node10`) with in-memory models. The real-database smoke `vc-lock-mongo-smoke.js` uses Mongoose 5.13, because the 5.1.2 driver cannot talk to mongod 5.1 or later (the versions on hosted CI runners), so the lock, marker and counter writes have not run under 5.1.2. Unsetting `VC_SECRET_KEY` is the kill switch: no provider call is made, and requests then serve stored data up to 3 hours old or fail.

Sources: [DSF route](../../server/routes/v000902/route.dsf.coord.v000902.js), [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js), [DSF cache controller](../../server/controllers/worldWeather/dsf.controller.js#L777-L1121) with [record selection](../../server/controllers/worldWeather/dsf.controller.js#L340-L463) and [budgets](../../server/controllers/worldWeather/dsf.controller.js#L45-L60), [Visual Crossing requester](../../server/lib/VC/vcRequester.js), [converter](../../server/lib/VC/vcConverter.js), [lock model](../../server/models/worldWeather/vc.fetch.lock.model.js), [usage model](../../server/models/worldWeather/vc.usage.model.js), [record model](../../server/models/worldWeather/dsf.model.js), [world cache sequence](../rewrite/diagrams/server-world-cache-sequence.html).

## WAQI and the older world collector

`_getWaqiFromAll()` prunes old AQI records, reads stored data and checks a 60-minute freshness window. It first attempts a known station/feed when available, then falls back to a geographic query. AQI failure handling differs from the overseas weather path and includes tolerated missing data; not every missing AQI reading fails the weather request. [World controller](../../server/controllers/worldWeather/controllerWorldWeather.js), [AQI collector](../../server/controllers/worldWeather/controllerAqi.js).

The older `controllerCollector` supports WU and DSF collection (its DSF requests now fail immediately); its `runTask()` schedules WU current and DSF at minute 30 and WU forecast at minute 1. `doCollect()` would install its timer, but no invocation is present in inspected non-test startup code. Requester command handlers and legacy API methods still reference this class. Provider modules under `MET`, `OWM`, `FC` and `AW` also exist; their presence alone does not establish their use by the current mobile path. [Legacy collector](../../server/controllers/worldWeather/controllerCollector.js), [requester commands](../../server/controllers/worldWeather/controllerRequester.js).

## Failure and operational implications

- A successful `/gather/current` response does not prove successful ingestion: the handler logs collection errors and still sends an empty response. Use product timestamps and logs to assess freshness.
- Queue state is lost on restart; direct jobs may overlap and separate replicas have no visible shared collection lock. A publication cache is not a distributed scheduler lock.
- The HTTP listener and `/gather` mounts remain present across modes, but some handlers need members initialized only by the gather startup. Mode separation is not HTTP access control.
- Current, short, station and air products can have different publication times. Read-time merges may produce partial or differently-aged responses.
- The historical provider URLs, external geocoder and release environment need separate integration verification before operating this code.

## AWS KAQ producer versus repository consumer

The scheduled `copyKaqfsImagesToS3` Lambda is an upstream producer separate from the Express collector. Its deployed code OCRs KAQ publication dates and writes animation GIFs to `tw-kaqfs-images`. The repository consumer lists configured S3 prefixes and decodes the GIFs into station hourly pollutant forecasts, then upserts forecast and map-case records. EventBridge runs at UTC minute 5 with final hour 23; repository manager runs the consumer at minute 7 with final hour 13. Live consumer mode/bucket/revision remain unverified. The observed producer had 24 errors from 24 invocations in the recorded 24-hour window; sampled logs point to missing OCR `description` in `_getDate`, without establishing why OCR data was absent. See [AWS/code correlation](aws-code-correlation.md) and [KAQ pipeline](diagrams/kaq-image-pipeline.html) for provenance and the unverified deployment link.

## Observed service host versus collection hosts

[Read-only service EC2 inspection](ec2-internals.md) identifies ten PM2 API workers configured as `service`, so this host does not automatically start the Manager gather/scrape loops or push loops. Its KAQ bucket setting resolves to `tw-kaqfs-images`, but a matching setting is not evidence that this host runs the scheduled image consumer. The separate gather instance was not accessed. The service checkout is `5bca407` with host config/logger edits; its Manager retry budgets and KMA requester differ from the local baseline. The schedules above remain repository facts, not a claim about the gather instance's deployed code. Request-time DSF/AQI fills remain possible on the API host.

## Daily forecast validity (issue #2560)

The mid-land/temperature collectors preserve available day-3–10 fields without
requiring day 3 or day 10. Both storage versions retain publication/region and
optional precipitation probabilities. Mid composition joins by each source's
KST target date, with independent 36-hour publication limits and no future or
mismatched identity. Short daily overlays have a 24-hour publication limit.
The seven-day observation history remains; unavailable days are omitted and
listed in additive `midData.dailyStatus.unavailableDates`. The captured day-4
forecast remains September 28, with September 27 unavailable unless an actual
valid source supplies it. Existing v000903 `tmn`/`tmx` output conversion remains.

Legacy **mid RSS is retired**: scheduled collection/storage entry points are
disabled and `getMidRss` passes through without cached overlay. Short RSS remains
independent. No replacement feed or production recovery is claimed.

See the [daily validity diagram](diagrams/daily-forecast-validity.html),
[editable source](diagrams/daily-forecast-validity.json), and
[contract, source policy and operator checklist](../../reports/sdlc/issue-2560/daily-forecast-contract.md).

Review5303256769 correction removes the retired `midrss` task from `checkTimeAndRequestTask` startup/hourly queues; short RSS remains scheduled. Legacy DB1 short saves additionally replace an optional current-batch `dailySource` snapshot for independently validated daily targets beyond the hourly template. Older documents are not backfilled; service can use this only after a successful normal collection. DB2 reuses each stored short document's publication. See the daily forecast contract for snapshot/rollback semantics.

## Historical ASOS recovery (#2564)

[Recovery diagram](diagrams/historical-observations.html) · [JSON](diagrams/historical-observations.json) · [Operator contract](../../reports/sdlc/issue-2564/operator-contract.md).

The additive history path uses official ASOS hourly/daily observations and a separate `asos_history` Mongo collection shared by DB_DATA_VERSION 1.0 and 2.0. `_id` is `product:station:KST-slot`; Mongo's existing unique `_id` index and field-level conditional writes prevent duplicate records and replacement of accepted fields. Explicit KST keys and UTC BSON dates avoid importing the legacy scraper's host-local Date assumptions. Source, product, station, fetch time and time basis are retained. There is no history TTL/migration or write to grid collections.

`ASOS_HISTORY_ENABLED=true`, `ASOS_HISTORY_SERVICE_KEY` and an explicit `ASOS_HISTORY_STATIONS` list activate a queued recovery job at startup and UTC minute 2 in gather/local mode. Default activation is off. Two workers recover missing ranges for D-7 through D-1; each HTTP attempt has a 10-second total deadline, at most three transport attempts and eight validated pages. Each station run has a ten-minute work deadline and a fifteen-minute owner-token lease; a request in progress can finish past the work deadline. Scheduling stops admitting stations after five minutes, resumes its in-process station cursor on the next run, and reports skipped stations. No provider request is made by weather API cache reads.

`server/bin/backfill-history.js --station ID --start YYYYMMDD --end YYYYMMDD` is a separately invoked operator command requiring explicit credentials/allowlist and at most seven completed KST dates. It does not load app.js or start collectors. Completion is based on stored readback, rejected input and remaining gaps; nonzero exit signals incomplete recovery. Empty/malformed/mismatched provider rows and incomplete pages are not treated as successful recovery. Normalized invalid fields are omitted. Blank rain stays unknown. Optional-field absence does not cause repeated retrieval once core hourly temperature/humidity or daily extrema are complete; core gaps remain eligible on later scheduled runs.

This describes local implementation, not production activation or verified live ASOS availability. The pre-existing `/past` endpoint and legacy scraper remain independent.

Follow-up live validation on 2026-09-25 KST confirmed September 17–23 coverage for Seoul, Busan and Jeju (168 hourly and seven daily rows each). The official [ASOS portal](https://data.kma.go.kr/data/grnd/selectAsosRltmList.do?pgmNo=36&tabNo=2) describes winter rain at three-hour intervals and previous-day data availability after 10:00 KST. The normalizer therefore omits November–March `rn` from the one-hour `rn1` field until its accumulation period is verified; daily rain remains usable. Scheduled retries preserve gaps during publication delay. This enforces the existing field-validity boundary without changing the recovery/data-flow diagram.
