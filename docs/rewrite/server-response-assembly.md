# Server response assembly

This is the observed implementation at `ff7acf3996ccb66c912d2ed4710cf300197d6966` (2026-09-23), not a proposed new API. The analysis is static: no Express startup, database query or provider call was executed. Read [client contracts](client-data-contracts.md) alongside this document; the server returns two different weather shapes that the client normalizes.

[Domestic assembly diagram](diagrams/server-domestic-assembly.html) · [World request/cache sequence](diagrams/server-world-cache-sequence.html) · [Data lifecycle](server-data-lifecycle.md)

## 1. Request boundary and route selection

The checked-in Express application mounts `/v000903`, not `/weather/v000903`. The mobile client constructs the latter public prefix. The gateway implementation is outside this checkout. The 2026-09-20 deployed-source inspection recorded CloudFront → API Gateway → Lambda and coordinate dispatch to EC2 KMA address or DSF coordinates; that is historical deployment evidence, not proof of a present deployment or an implementation contained here. Native clients and older API versions remain compatibility inputs. See [gateway evidence](../architecture/aws-code-correlation.md) and [mobile routing](../architecture/mobile-api.md).

| Direct Express route | Current handler | Additional work before composition |
| --- | --- | --- |
| `/v000903/kma/addr/:region[/:city[/:town]]` | `ControllerTown24h` through v000903 KMA router | Query defaults; parameter checks; town/grid lookup |
| `/v000903/kma/coord/:loc` | Same KMA middleware list with `coord2addr` prepended | External configured `/geocode/coord/:loc` request, then copy `kmaAddress.name1/2/3` into address parameters |
| `/v000903/dsf/coord/:loc` | Reused v000902 DSF router | Defaults; `category=current`, `days=2`, `gcode=:loc`, `aqi=airUnit`, `validVersion=true` |
| `/v000903/kma/special` | Special-weather controller | Separate warnings response; explicit `Cache-Control: max-age=300` |
| `/v000903/nation/:nation` | Reused v000803 nation router | Regional air read, then parallel HTTP requests for 15 fixed Korean cities |

Sources: [app mounts](../../server/app.js), [v000903 index](../../server/routes/v000903/index.js), [KMA router](../../server/routes/v000903/route.kma.v000903.js), [DSF router](../../server/routes/v000902/route.dsf.coord.v000902.js), [coordinate adapter](../../server/controllers/controllerTown24h.js) (`coord2addr`, `_retryRequest`). Coordinate geocoding uses three attempts and a 3-second per-request timeout. It is not part of domestic weather-provider collection.

`checkQueryValidation` mainly supplies missing or literal `'(null)'` defaults; its name does not imply exhaustive validation of supplied enum values. Defaults are Celsius, m/s, hPa, km, mm and `airkorea`; domestic `airForecastSource` defaults to `airkorea`. The domestic version is derived from `req.baseUrl`. Parameter compatibility includes swapped `KR` address fields and rejection of selected unsupported country names. `getAllDataFromDb` redirects an out-of-Korea resolved coordinate to the configured world URL. Sources: [base controller](../../server/controllers/controllerTown.js) (`checkParamValidation`, `getAllDataFromDb`) and [unit defaults](../../server/lib/unitConverter.js) (`getDefaultValueList`).

## 2. Domestic product load and request-local state

The controller mutates a request-local assembly context (`req.short`, `req.currentList`, `req.midData`, etc.). It does not query one prebuilt whole-weather JSON document. `ControllerTown24h` invokes `ControllerTown.call(this)` and replaces selected behavior: track both files when moving functions.

`getAllDataFromDb` resolves address → grid `coord={mx,my}` and geographic `gCoord={lat,lon}`, then launches **two parallel groups**:

1. Town group, serial `async.mapSeries`: `modelShort` → `modelCurrent` → `modelShortest` → `modelShortRss`.
2. Medium group: resolve region/forecast code, then serial `modelMidForecast` → `modelMidLand` → `modelMidTemp`. Temperature-zone lookup can replace the original city code and stores `req.regId` for reuse.

Each successful read is attached under `req.model...`. Later individual getters reuse this value or read again if it is missing. Town preload failures are explicitly logged and tolerated; a medium group failure stops that group, but the outer completion still logs and calls `next()`. This is best-effort assembly, not an all-or-nothing transaction. The unused `checkDBValidation` returns immediately and is absent from the v000903 list; it is not evidence that normal weather reads trigger `/gather` recovery.

`DB_DATA_VERSION` selects storage adapters. At `config.db.version === '2.0'`, current/short/shortest/short-RSS use the `kma.town.*` controllers; otherwise the reader takes the legacy path. Medium reads have a separate v2 switch in `_getMidDataFromDB`. These adapters return the older assembly representation `{pubDate, ret}` even when the underlying schema uses individual `fcsDate`/`pubDate` Date records. The writer has stricter `1.0`/`2.0` cases; do not mistake reader fallback for support of arbitrary versions.

Sources: [base controller](../../server/controllers/controllerTown.js) (`getAllDataFromDb`, `_getTownDataFromDB`, `_getMidDataFromDB`), [current v2 adapter](../../server/controllers/kma/kma.town.current.controller.js), [short v2 adapter](../../server/controllers/kma/kma.town.short.controller.js), [medium v2 adapter](../../server/controllers/kma/kma.town.mid.controller.js). Full model mapping: [data lifecycle](server-data-lifecycle.md#product-and-storage-map).

## 3. Domestic merge rules in execution order

| Stage | Inputs and precedence | Result and rewrite constraint |
| --- | --- | --- |
| Short baseline | `_makeBasicShortList` creates 41 three-hour slots beginning two days before the current local day; stored short matches by `date+time` | Preserves the time grid when DB slots are missing; sentinels initially fill unknowns. This is an intermediate list, not a guaranteed response count. |
| Short RSS | Skip RSS older than `shortPubDate`. Only future RSS slots participate. Newer RSS overwrites corresponding properties; equally dated RSS fills invalid/missing fields | Preserve field-specific invalid values and publication comparison. Do not replace the whole short object indiscriminately. |
| Shortest | Read hourly nowcast/very-short forecast; retain full `shortestList` and expose only slots at/after `_getShortestTimeValue(+9)` | The full list supports past corrections; the visible list later filters again by latest publication. |
| Current baseline | Exact current grid observation wins; otherwise accept the latest record within the preceding three-hour window. If too old, `_makeCurrent(short, shortestList, now)` constructs an estimated current and marks `overwrite` | Missing DB retrieval does not take this same stale-record branch. Conversion of `-50`, `-100`, `-1` is field-specific. |
| Observation history | Fill missing hourly slots across eight days with sentinel objects; sort and cap to `manager.MAX_CURRENT_COUNT` (192) | Placeholder rows are meaningful unknowns, not zero observations. |
| Sky fallback | `mergeCurrentSkyByShortest` repairs only missing/negative sky in current and history | This is not blanket replacement of observed weather with a forecast. |
| Station hourly | For history where `t1h === -50`, copy matching station temperature, rain, cloud-derived sky, humidity, precipitation type, lightning, wind. Repair current if its temperature is absent/invalid | Source selection changes per field and timestamp. |
| Station minute/hourly rain | Reject the all-zero temperature/direction/speed combination. Keep a `dongnae` snapshot. Fill absent/invalid core values, overwrite other station fields, derive rain/cloud/type/lightning and descriptions | `stnDateTime` versus `currentPubDate` controls `overwrite`, date/time/liveTime and rain priority. Valid grid temperature is not always replaced by a newer station temperature. |
| Time alignment | `convert0Hto24H` changes midnight to the previous day's `2400` in current, short, shortest and history | Run before three-hour joins and yesterday comparisons; `2400` is an API convention, not an ordinary ISO clock string. |
| Observed short slots | Aggregate hourly history to three hours, copy corresponding observed properties into short, map `t1h→t3h`, and extend extrema with observations | Measured history supersedes forecast for matching past slots. |
| Near-term correction | `_mergeShortByShortest` selects future shortest slots, prepends recent observations to complete a three-hour bucket, then updates valid fields and `shortestRn1` | Preserve valid-value guards; rain accumulation is not a point measurement. |
| Short adjustment | `ControllerTown24h.adjustShort` recomputes daily extrema and places markers near corresponding temperatures (tie preference 06:00 minimum / 15:00 maximum); divides six-hour rain/snow into three-hour slots according to precipitation type; overlays shortest rain/snow | It also defaults missing precipitation probability to zero and trims invalid-temperature tail slots. Record this default separately from a proposed unknown-value policy. |
| Daily weather | `getMid` joins medium land+temperature and forecast text; `getMidRss` adds RSS; normalize Korean sky descriptions; add past daily aggregates from history; overlay short daily summaries; extend today's extrema with current temperature | Publication mismatch is logged, not rejected. `_mergeList` copies source properties by date and sorts: near-range/past composition can overwrite medium fields. |

Sources: [base assembly](../../server/controllers/controllerTown.js), functions named in the table; [24-hour overrides](../../server/controllers/controllerTown24h.js) (`adjustShort`); [time helpers](../../server/lib/kmaTimeLib.js). The [ordered appendix](#ordered-middleware-appendix) is the authoritative operation sequence; the diagram groups operations for readability.

### Enrichment after weather composition

| Product | Lookup and join | Destination |
| --- | --- | --- |
| KMA life indices | Exact address → `modelAreaNo` → `LifeIndexKmaController.appendData2`; if unavailable, near-area candidates using geographic position | Matching daily entries; area/geocode context reused by later stages |
| Health-day indices | Existing `areaNo`, address lookup, then nearest geographic area fallback; stored `modelHealthDay` values | Matching daily health fields |
| AirKorea observations | `KecoController.getArpLtnInfo(townInfo, now)` resolves station data | `current.arpltn`, `arpltnList`, `arpltnStnList` |
| Regional air forecast | `getKecoDustForecast` runs only for `airForecastSource==='airkorea'`, joining dates | `midData.dailyData[].dustForecast` |
| Sunrise/sunset | Geographic lookup through `kasiRiseSetController.getRiseSetList` for the composed daily dates | Sunrise/sunset and other returned astronomical fields copied into daily entries |
| Computed indices | `insertIndex` calculates derived weather indices after measurements and daily inputs exist | Current/short/daily advisory values |
| Multi-station air | `makeAirInfoList`: one item per station series with `source:'airkorea'`, latest reading and hourly/daily pollutant series | `airInfoList[]`; regional daily forecasts are reused across stations and may not fit a distant station exactly |
| Hourly air forecast | `AirForecastList` uses `async.map`, therefore stations can load in parallel. `_getAirForecast` selects KAQ or AirKorea controller by query | Adds forecast pollutant series to each station item; errors log and continue |
| Special warnings | Town + nearest station → special-weather controller | `current.specialInfo` when a nonempty list exists |

Sources: [base enrichments](../../server/controllers/controllerTown.js) (`getLifeIndexKma`, `getHealthDay`, `getKeco`, `getKecoDustForecast`, `getRiseSetInfo`, `insertIndex`); [air and warning composition](../../server/controllers/controllerTown24h.js) (`makeAirInfoList`, `AirForecastList`, `getSpecialInfo`). These read stored products; normal domestic assembly does not start KMA weather collection on demand. The KASI reader contains an API fallback after an always-true array-length check, so normal array results (including empty arrays) return before that fallback.

### Yesterday, icons, units and text

1. `insertSkyIconLowCase` runs with physical weather values before requested unit conversion.
2. `setYesterday` calculates yesterday using Korea time, applies the midnight convention, and selects the first history entry on that day whose time is at least current time (excluding the final array element). This permits a later hour when the exact comparison is absent. It logs missing comparison data; it does not fabricate a temperature.
3. `getSpecialInfo` adds current warnings before summary generation.
4. `convertUnits` converts weather, day extrema, air grades/values and relative day metadata. Snow quantities `s06`, `sn1`, `s1d` first multiply from cm to mm. Temperature sentinels are guarded; not every numeric field shares the same sentinel policy.
5. `insertStrForData` produces localized descriptions **after** units. `getSummaryAfterUnitConverter` calculates current weather/air/combined summaries and day summaries. Warning, pollutant, precipitation, perceived-temperature and life-index significance influences summary selection; text is derived output, not a provider passthrough.

**Observed source anomaly, not a runtime verification:** `_convertWeatherData` passes `toWindUnit` as the destination in its non-default precipitation branch, despite reading `toPrecipUnit`. A rewrite should add an independent mm→in characterization test and make an explicit compatibility/correction decision; this documentation did not execute or fix that branch.

Sources: [24-hour controller](../../server/controllers/controllerTown24h.js) (`setYesterday`, `convertUnits`, `getSummaryAfterUnitConverter`, `_convertWeatherData`), [base summary rules](../../server/controllers/controllerTown.js) (`makeSummary`, `insertStrForData`), [unit converter](../../server/lib/unitConverter.js), [AQI converter](../../server/lib/aqi.converter.js).

## 4. Domestic response envelope and failures

`makeResult` conditionally copies available values. `sendResult` calls `res.json(req.result)`. There is no uniform `{data, error, meta}` wrapper or enforced all-fields schema here.

| Field group | Meaning |
| --- | --- |
| `source:'KMA'`, `regionName`, `cityName`, `townName` | Provider discriminator and resolved address |
| `short`, `shortest`, `current` | Three-hour display series, near-term series, current object (including nested `yesterday` and enrichments) |
| `shortPubDate`, `shortRssPubDate`, `shortestPubDate`, `currentPubDate` | Separate product publications; not one snapshot timestamp |
| `midData` | Forecast description and `dailyData`; separate land/temperature publication context |
| `dailySummary` | Derived day presentation summaries, when produced |
| `airInfoList` / `airInfo` | Multi-station air array preferred; singular fallback only if array absent |
| `units` | Six unit settings returned from query/defaults |
| `location` | `{lat, long}` rounded to 3 decimal places when geographic context exists and version is at least v000901 |

`shortest` is filtered to rows whose `pubDate` equals latest `shortestPubDate`. Invalid/short arrays, missing current temperature/yesterday and duplicate daily dates are logged by `makeResult` but do not automatically prevent JSON delivery. Many middleware catches call `next()` without an error. Others call `next(err)`. Do not translate every failure into a guaranteed partial-200 or a guaranteed-500 rule without scenario tests; an incomplete upstream state can also make a later stage throw. The direct whole-weather sender sets no cache TTL; the dedicated warnings route has its own header. Source: [makeResult/sendResult](../../server/controllers/controllerTown24h.js), [Express error paths](../../server/app.js).

## 5. World weather: request-time cache fill, then merge

[World sequence](diagrams/server-world-cache-sequence.html) is a bounded view of the following logic. Its DSF and AQI branches run concurrently; the drawn vertical order does not create a cross-branch dependency.

1. `queryTwoDaysWeatherNewForm` sets request clock `cDate`, parses geocode and starts `DsfController.getDsfData` and `_getWaqiFromAll` with `async.parallel`. A propagated branch error goes to `next(err)`.
2. DSF reads records for exact Mongo coordinate `[lon,lat]`, sorted by `dateObj`. It selects current (15-minute test), today and yesterday using local-day rules. Yesterday must include the comparison hour and complete hourly coverage; stored neighboring records can fill holes. An incomplete yesterday is discarded for refetch.
3. DSF's waterfall fetches missing current, resolves time-zone offset, saves fetched current, fills yesterday (up to three historical-fill attempts), then fills today if absent. Time-zone lookup tries zone identifier, geographic fallback, then numeric zone parsing. Current/time-zone failure can fail the request; historical or save failures can log and continue. `getDsfData` uses the fetched current observation time as `cWeatherDate` for later alignment.
4. AQI prunes old records, reads cache, tests 60-minute freshness, tries a stored station/feed ID on stale data, then geographic WAQI fallback. Absence is tolerated in several inner paths, but a propagated AQI error still fails the outer parallel join. This is not a blanket best-effort guarantee for every AQI error.
5. Convert DSF current/hourly/daily and sunrise/sunset timestamps into the response's local-time representation using `timezone.min/ms`. Then combine daily records by date, current observation, and hourly records. `hourly` is a **three-hour display series** (00/03/06/09/12/15/18/21/24) derived using the selected hour and two preceding hourly inputs. `shortest` takes up to three subsequent hourly items. Yesterday at matching hour joins `thisTime`; if absent, a date-only placeholder is appended.
6. Merge AQI readings matching `thisTime` through `_compareDate(..., 6)`: same UTC day-of-month and `(weather−air)` hours ≤ 6, with no lower bound. This is not a symmetric ±6-hour window; see the lifecycle anomaly table. Convert pollutant indices back into values, grades and localized strings for requested air standard. AirKorea combined-index calculation can add 50/75 points when multiple pollutants exceed the threshold.
7. Sort time arrays, normalize icons, convert units, form `arpltn` and singular `airInfo`, compute summaries with shared domestic summary helpers, then `sendResult`.

Sources: [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js) (`queryTwoDaysWeatherNewForm`, `_getWaqiFromAll`, `mergeDsfHourlyData`, `mergeAqi`), [DSF cache](../../server/controllers/worldWeather/dsf.controller.js), [AQI collector](../../server/controllers/worldWeather/controllerAqi.js), [world units and summary](../../server/controllers/worldWeather/controller.ww.units.js).

The world envelope contains `daily`, `hourly`, `thisTime` (expected yesterday then current after sort), `shortest`, `pubDate.DSF`, `location:{lat,lon}`, `timezone`, `units`, and conditional `airInfo`. Do not infer `source:'DSF'` is always populated: the client takes its non-KMA branch whenever `source !== 'KMA'`. `sendResult` logs when `thisTime.length !== 2`, chooses `req.error` if present, and otherwise can send `{result:'Unknown result'}`. These paths are historical behavior rather than a recommended error contract. Provider and output property names are mapped in [client contracts](client-data-contracts.md).

## 6. Nationwide screens: regional air plus HTTP fan-out

`/v000903/nation/:nation` reuses [route.nation.js](../../server/routes/v000803/route.nation.js). Its chain is `checkQueryValidation` → `getSidoArpltn` → `getWeather` → sender:

1. Supply the same query-unit defaults and derive API version from `baseUrl`.
2. Load regional air through `KecoController.getSidoArpltn`, recalculate each region using the requested air standard, and attach `req.air`. A read or conversion error reaches `next(err)`.
3. `async.map` requests weather for **15 fixed Korean city/address entries** over HTTP to `config.apiServer.url/<version>/kma/addr/...` (older versions use `/town`; absent version defaults to v000901). Query fields and `Accept-Language` are forwarded. Each child has a 9-second timeout. This is a configurable API-server fan-out, not 15 in-process calls or one Mongo aggregate.
4. Remove only top-level `airInfo` and `airInfoList` from each child weather object, then attach the weather array. Other child fields, including nested enrichments, are retained. Any child network error or HTTP status ≥400 causes the aggregate callback to call `next(err)`; the code does not return a documented partial-city success contract.
5. Return `{nation:'KR', weather, air}` with whichever of the two attached fields exist; the final no-result branch sends 501. The path `:nation` value does not choose another country: city list and returned nation are hard-coded to Korea.

A rewrite must decide whether to preserve failure coupling, request multiplication, per-child unit/locale shaping and city order. Nationwide weather and regional air must not be conflated with `airInfoList` from a single city's nearby stations. These are separate screens/contracts in [client contracts](client-data-contracts.md).

## Ordered middleware appendix

These are direct route registration lists, not inferred scheduling. Grouped diagram edges have no extra text where the endpoints and numbering already express the next middleware stage.

### KMA v000903

`coord2addr` is prepended **only** for `/coord/:loc`; address routes start at item 1.

1. `checkQueryValidation`
2. `checkParamValidation`
3. `getAllDataFromDb`
4. `getShort`
5. `getShortRss`
6. `getShortest`
7. `getCurrent`
8. `updateCurrentListForValidation`
9. `mergeCurrentSkyByShortest`
10. `mergeCurrentByStnHourly`
11. `getKmaStnMinuteWeather`
12. `convert0Hto24H`
13. `mergeShortWithCurrentList`
14. `mergeByShortest`
15. `adjustShort`
16. `getMid`
17. `getMidRss`
18. `convertMidKorStrToSkyInfo`
19. `getPastMid`
20. `mergeMidWithShort`
21. `updateMidTempMaxMin`
22. `getLifeIndexKma`
23. `getHealthDay`
24. `getKeco`
25. `getKecoDustForecast`
26. `getRiseSetInfo`
27. `insertIndex`
28. `makeAirInfoList`
29. `AirForecastList`
30. `insertSkyIconLowCase`
31. `setYesterday`
32. `getSpecialInfo`
33. `convertUnits`
34. `insertStrForData`
35. `getSummaryAfterUnitConverter`
36. `makeResult`
37. `sendResult`

### DSF (v000902 handler mounted by v000903)

1. `ctrlUnits.checkQueryValidation`
2. `convertParamAndQuery`
3. `worldWeather.queryTwoDaysWeatherNewForm`
4. `worldWeather.convertDsfLocalTime`
5. `worldWeather.mergeDsfDailyData`
6. `worldWeather.mergeDsfCurrentDataNewForm`
7. `worldWeather.mergeDsfHourlyData`
8. `worldWeather.mergeAqi`
9. `worldWeather.dataSort`
10. `skyIconLowCase`
11. `ctrlUnits.convertUnits`
12. `worldWeather.makeAirInfo`
13. `ctrlUnits.makeSummary`
14. `worldWeather.sendResult`

## Rewrite boundaries to preserve deliberately

- Separate raw observation, forecast, corrected display value and localized text. Preserve source/publication/time provenance even when they currently share one object.
- Treat units, AQI standard, locale, geography and API version as response-shaping inputs when defining caches.
- Keep the 24:00/yesterday/three-hour accumulation rules covered by frozen-clock examples before simplifying them.
- Define product completeness and stale-data policy explicitly; a successful legacy status code is not sufficient equivalence evidence.
- Preserve older mounted contracts behind adapters until actual mobile/widget callers are inventoried.
- Replace historical providers only after documenting equivalent time, rain, snow, index and history semantics. Provider name substitution alone is insufficient.

For proposed acceptance work, see [verification matrix](verification-matrix.md) and [rewrite playbook](rewrite-playbook.md).
