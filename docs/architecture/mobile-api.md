# Mobile application and API calls

## Entry and refresh lifecycle

The main application uses Ionic/Angular controllers and services. `controller.start.js` handles initial location/weather loading; `controller.tabctrl.js` handles existing city refreshes, resume and presentation. Both call `WeatherUtil.getWeatherByGeoInfo()`.

1. Restore app settings/cities through `TwStorage` and initialize `WeatherInfo`.
2. Select a saved city or obtain current position through Cordova/browser geolocation. The geolocation options include a 60-second timeout, 60-second maximum age, and high accuracy.
3. Resolve geographic/address information when needed through `getGeoInfoByLocation()` or `getGeoInfoByAddr()`.
4. `WeatherInfo.canLoadCity()` rejects disabled cities and skips network refresh while `loadTime` is no more than 10 minutes old. Restoring a city resets its in-memory load time to null; manual reload also clears it.
5. `getWeatherByGeoInfo()` builds one weather URL, calls `_getHttp()`, and returns `$q.all()` around that request. The result is consequently an array containing `{data: responseBody}`.
6. `convertWeatherData()` selects a source parser. `WeatherInfo.updateCity()` updates current/time/day/air display data, records load time, and persists cities; the controller broadcasts `applyEvent` to update screens.

A current-position refresh can begin using the saved location while a location update runs. If coordinates change, another weather request can follow. This and the HTTP retry timer mean one user refresh does not imply exactly one network call.

Sources: [startup controller](../../client/www/js/controller.start.js), [tab controller: `loadWeatherData`, `updateWeatherData`](../../client/www/js/controller.tabctrl.js), [WeatherUtil](../../client/www/js/service.weatherutil.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js), [TwStorage](../../client/www/js/service.storage.js).

## Exact client URL contract

All paths below are appended to `clientConfig.serverUrl`. The checked-in value is `https://localhost`; Gulp copies variant release configuration from files outside `client/`. The real deployed base URL is not established here.

| Call | Method and appended path | Selection / response |
| --- | --- | --- |
| Geocode coordinates | `GET /geocode/v000903/coord/:lat,:long` | `getGeoInfoByLocation`; resolves raw response body |
| Geocode address | `GET /geocode/v000903/addr/:address` | `getGeoInfoByAddr`; resolves raw response body |
| Weather by coordinates | `GET /weather/v000903/coord/:lat,:long` | Preferred when `geoInfo.location.lat` is truthy |
| Weather by free-form address | `GET /weather/v000903/addr/:address` | Used when address cannot produce Korean town components |
| Korean legacy address | `GET /v000903/kma/addr/:region[/:city[/:town]]` | Used for stored address-only cities when town parsing succeeds |
| Nation view | `GET /v000903/nation/:nationCode` | Separate country overview call |
| KMA warnings | `GET /v000903/kma/special` | Separate warning screen |
| Push registrations | `/v000902/push`, `/v000902/push-list` | Separate service with registration/update/delete operations |
| Purchase validation (retired client flow) | No call from the maintained Cordova app | Server endpoint retirement tracked separately in #2642 |

The exact coordinate condition uses truthiness, so latitude `0` does not take the normal coordinate branch. Address fallback prefixes `대한민국` when missing before extracting region/city/town. This is legacy behavior, not general worldwide address parsing. URL builders concatenate strings; they do not explicitly encode each path segment.

Sources: [builders and selection](../../client/www/js/service.weatherutil.js), [warnings](../../client/www/js/controller.kma.special.js), [push](../../client/www/js/service.push.js), [build configuration selection](../../client/gulpfile.js).

### Query parameters and headers

Weather builders append all settings from `Units.getAllUnits()` and then `airForecastSource=kaq`. The settings include `temperatureUnit`, `windSpeedUnit`, `pressureUnit`, `distanceUnit`, `precipitationUnit`, and `airUnit`. Defaults vary by locale/settings; do not assume every device requests Celsius or the same AQI standard. Server KMA query handling fills missing or literal `(null)` unit values, and defaults an absent `airForecastSource` to `airkorea`.

The weather `_retryGetHttp` wrapper specifies only `{method:'GET', url, timeout}`; it does not explicitly attach `Device-Id` or language headers. Push requests set their own headers. Server logging of `device-id` is not proof that every weather request sends it.

Sources: [Units](../../client/www/js/controller.units.js), [HTTP wrapper](../../client/www/js/service.weatherutil.js), [server defaults](../../server/controllers/controllerTown24h.js).

## Public API and implemented backend

Read-only AWS inspection and deployed Lambda code close the earlier missing-gateway gap. See [AWS/code correlation](aws-code-correlation.md) and [request diagram](diagrams/mobile-weather-request.html).

| Boundary | Verified mapping | Remaining limit |
| --- | --- | --- |
| `/weather/{version}/coord/{loc}` | CloudFront -> API Gateway -> weatherbycoord -> geocoder -> EC2 KMA address (KR) or DSF coordinates | Actual provider/EC2 response not probed |
| `/weather/{version}/addr/{address}` | API Gateway -> weatherbyaddr | Deployed handler returns application 501; free-form app fallback is unsupported |
| `/geocode/{version}/coord/{loc}`, `/geocode/{version}/addr/{address}` | API Gateway -> geoinfo Lambda, DynamoDB cache and provider adapters | Provider availability unverified |
| Direct `/v000903/kma/addr/...` | CloudFront default behavior -> service EC2; source mounts KMA pipeline | Host tree 5bca407; selected route files match local |
| Backend `/v000903/kma/coord/:loc` | Source resolves via `API_SERVER/geocode/coord/:loc`, then KMA | Host config resolves public todayweather hostname |
| Backend `/v000903/dsf/coord/:loc` | Weather Lambda selects this for non-KR v000903; source reuses v000902 pipeline | End-to-end result untested |
| Backend `/v000903/geo/:loc` | Source implements KR/world redirects | Not used by inspected weather Lambda dispatch |

Error responses on the weather and geocode paths carry `Access-Control-Allow-Origin: *` for browser (`Origin`) requests through CloudFront since 2026-09-25 (#2584); status codes and `text/plain` error bodies are unchanged. See [CORS on error responses](aws-code-correlation.md#cors-on-error-responses-2584).

Unversioned public variants are also deployed. Weather Lambda defaults them to `v000901`; versioned app requests select `v000903`. It forwards query parameters, derives language from the request header, retries the backend up to three times (3 seconds each), and enriches weather output with geographic fields. A standard Express start alone cannot provide the public Lambda paths. `route.geo.v000903` remains a separate legacy redirect that does not explicitly forward the original query string.

Sources: [server mounts](../../server/app.js), [v000903 router](../../server/routes/v000903/index.js), [geo redirect](../../server/routes/v000903/route.geo.v000903.js), [deployed Lambda excerpts](deployed-lambda-excerpts.md), [AWS evidence](aws-readonly-evidence-2026-09-20.json).

The [service-host inspection](ec2-internals.md) confirms nginx port 80 forwarding to loopback 3000 and ten PM2 API workers. The host configuration selects service mode and DB v2.0. Its deployed tree is older than the local analysis baseline; selected latest-route/Town24h files match, while DSF requester and several other files differ. No end-to-end request was issued.

## Domestic API middleware in order

The [v000903 KMA router](../../server/routes/v000903/route.kma.v000903.js) defines an order-dependent list shared by its address routes; the coordinate route prepends `coord2addr`.

| Phase | Key middleware | Result |
| --- | --- | --- |
| Validate and locate | `checkQueryValidation`, `checkParamValidation`, `getAllDataFromDb` | Unit defaults, address/grid resolution, load town and medium products |
| Short/current preparation | `getShort`, `getShortRss`, `getShortest`, `getCurrent` | Product-specific parsing into request fields |
| Observation correction | `updateCurrentListForValidation`, `mergeCurrentSkyByShortest`, `mergeCurrentByStnHourly`, `getKmaStnMinuteWeather` | Integrate grid, hourly station and minute observations |
| Time alignment / forecast merge | `convert0Hto24H`, `mergeShortWithCurrentList`, `mergeByShortest`, `adjustShort` | Align short/current series and extrema |
| Medium-range composition | `getMid`, `getMidRss`, `convertMidKorStrToSkyInfo`, `getPastMid`, `mergeMidWithShort`, `updateMidTempMaxMin` | Combine past, short and medium daily weather |
| Enrichment | `getLifeIndexKma`, `getKeco`, `getAirFallback`, `getKecoDustForecast`, `getRiseSetInfo`, `insertIndex`, `makeAirInfoList`, `AirForecastList` | UV/pollen/air/sunrise data; provider-chain air when AirKorea has no current observation (#2622, #2628) |
| Presentation | `insertSkyIconLowCase`, `setYesterday`, `getSpecialInfo`, `convertUnits`, `insertStrForData`, `getSummaryAfterUnitConverter` | Icons, yesterday comparison, warnings, requested units and text |
| Response | `makeResult`, `sendResult` | JSON containing available product fields |

`getRiseSetInfo` copies stored KASI values into `midData.dailyData`. Days without a stored row, or all days when the store lookup fails, get `sunrise`/`sunset` (`YYYY.MM.DD HH:MM`, KST) computed from the request coordinate with the NOAA solar equations; the other KASI fields (`moon*`, twilight, `suntransit`, `locationName`, `locationGeo`) appear only for stored rows. `getLifeIndexKma` adds optional `ultrv`/`ultrvGrade`/`ultrvStr` and `flowerWoody`/`flowerPine`/`flowerWeeds` with matching `Grade` and `Str` fields to `midData.dailyData`; available daily values, including grade zero, are copied to `current`. Invalid or absent grades are omitted, so older clients see their existing fields unchanged. `packages/weather-core` maps them to optional `uvIndex`, `pollenOak`, `pollenPine`, `pollenWeeds`; the Web details display available species. The removed `getHealthDay` enrichment does not run, and stored food-poisoning data stays out of responses until [#2600](https://github.com/WizardFactory/TodayWeather/issues/2600) has an approved source. Activity suitability is not offered.

`ControllerTown24h` calls the base `ControllerTown` constructor and overrides selected methods. `getAllDataFromDb` performs parallel product-family loading, with serial reads inside individual groups. It tolerates some missing product reads so later middleware can decide how to proceed. There is no single all-products freshness transaction.

The important ordering constraints are documented in the router itself: current depends on short/shortest; icons precede unit conversion; descriptions and final summary follow conversion. Reordering these functions can change meaning even when the endpoint still returns 200.

KMA output includes `source: 'KMA'`, region/city/town names, publication fields, `short`, `shortest`, `current`, `midData`, `dailySummary`, `airInfoList` or `airInfo`, requested `units`, and a rounded `location` for applicable versions. Fields are conditional, not guaranteed by a formal schema. `ControllerTown24h.sendResult()` simply calls `res.json(req.result)`; it does not set a whole-weather cache TTL. `/kma/special` separately sets `Cache-Control: max-age=300`.

### Current weather text and summary (#2576)

`getKmaStnMinuteWeather` merges KMA station and city observations into `current`. `makeWeatherType` maps the station weather text to `weatherType` after `normalizeKmaWeatherStr` rewrites the 2021+ `currentweather.jsp` wording to the legacy vocabulary. The rewrites are: suffix `연속적`→`계속` and `단속적`→`단속`; `비끝`/`눈끝`→`비끝남`/`눈끝남`; `안개`→`안개변화무`. Rain or snow with only an intensity or only a suffix gets `보통`/`계속` (bare `비`/`눈` stay KMA AWS types 65/66). Drizzle and showers get `보통` when no intensity is given and drop a `계속`/`단속` suffix. Sleet maps to `약진눈깨비`/`강진눈깨비`/`진눈깨비`. `구름적음` maps to type 1. Text that still cannot be mapped yields `-1` and logs `Fail weatherStr=`.

`updateWeather` treats `-1` like a missing type:

- With precipitation (pty ≥ 1), types 0–12 are replaced from `pty`: 1 `비`/65, 2 `진눈깨비`/64, 3 `눈`/66, short-term 4 소나기 → `소나기`/25, and nowcast 5 빗방울 → `약한비`/19, 6 빗방울눈날림 → `약진눈깨비`/29, 7 눈날림 → `약한눈`/33.
- Without precipitation (pty 0), `sky` 0–4 gives `맑음`/`구름조금`/`구름많음`/`흐림`.
- A missing or negative pty, or pty 0 with a sky outside 0–4, leaves `-1`. A pty ≥ 1 outside the KMA codes 1–7 keeps type 0 (`맑음`).
- The same fallback applies when there is no station text at all: the city page cell is blank, or hourly station rows are missing and `hourlyMissing` is set ([#2573](#fresh-station-observations-in-current-weather-2573)). In that case `weatherType` stays undefined.

`getWeatherStr` then replaces `current.weather` with the localized label.

`getWeatherStr` returns `""`, never `undefined`, for a missing, negative or out-of-range type. As a result, `current.weather` and world `desc` can be an empty string. `makeSummary` and `makeSummaryWeather` add the weather item only when `weatherType >= 0` and the text is non-empty, so the summary cannot end in `, undefined`. The regression is `node server/test/offline/weather-desc.test.js` (also part of `npm run test:offline`). `weather-desc-response-smoke.js` drives the actual v000903 route through the observed wording and through the `-1` fallbacks via sky, pty 1 and nowcast pty 5. It also covers the case with no station text plus pty 5, and an invalid sky that gives `weather ""`. PTY 4, 6 and 7 are covered by the unit test only.

### RSS fallback contract (issue #2554 local repair)

`getShortRss` first requires an independently valid RSS publication aged 0–24 hours, then compares normalized RSS and usable base short publication timestamps before matching strictly future KST forecast slots. Older RSS is skipped; equal timestamps fill unusable base values; newer RSS replaces selected fields only when the corresponding RSS source is usable. The first RSS slot is included when it is future, including a single-slot result. Date/time matching happens before `convert0Hto24H`, so next-day midnight uses `YYYYMMDD0000` at this boundary.

Both DB versions project `ws` and `wd`. [Wind normalization](weather-collection.md#grid-rss-wind-contract-issue-2554-local-repair) takes place at the service merge boundary, before downstream unit conversion. Missing `wav`, `uuu` and `vvv` leave existing base values intact; the merge does not derive vector components. Every selected source rejects absent/null/non-numeric/nonfinite data and field-specific sentinels. Nonnegative fields accept zero, temperatures accept real negative values above `-50` (including `-1` °C) and reject `-999`, and optional vector components accept values above `-100`. At 06:00 minimum temperature checks `tmn`; at 15:00 maximum checks `tmx` itself.

Later observation and shortest-forecast merges can still supersede RSS values. `shortRssPubDate` records the accepted RSS publication, including equal publication or a result with no matching future slot; it does not prove every response field came from RSS. `currentPubDate` and `shortestPubDate` retain separate freshness meanings. This repair changes neither route ordering nor requested-unit conversion.

Local checks run with `node server/test/offline/rss-wind.test.js` (Node 18+; no DB/provider access). See the [verification record](../evidence/tasks/issue-2554/self-verification.md) for actual response-path smoke coverage and limitations. No production restart/deployment is part of this change; origin/CDN comparisons must follow a separately approved deployment. Unrelated Jeju HTTP 500 and legacy historical placeholders are not explained by this patch.

### Current air summary (issue #2578)

`getSummaryAfterUnitConverter` fills `current.summaryWeather`, `current.summaryAir` and the combined `current.summary`; the app shows the first two as the lines under the temperature. `summaryAir` is built only from pollutant and integrated-index grades in `current.arpltn`. `getKeco` leaves `arpltn` absent when no nearby AirKorea station has an observation within eight hours of the request, and every station is compared with that same threshold. The [air fallback](#domestic-air-fallback-and-the-air-provider-chain-issues-2622-2628) may then fill it; when it does not, `makeSummaryAir` returns an empty string, and `getSummaryAfterUnitConverter` (and the world-weather `ControllerWWUnits.makeSummary`) omit `summaryAir` from the response. Installed app share text checks `hasOwnProperty('summaryAir')`, so an empty string would add a blank line; the app view hides the line either way (`ng-if="summaryAir"`). Weather or life-index grades on `current` (for example `wsdGrade`) are never treated as air grades, and the combined `summary` does not write air fields onto `current`. AirKorea `dataTime` is parsed as KST (`+09:00`), including `24:00` as the following midnight; the strict elapsed window is less than eight hours on every host timezone, independent of DST. Invalid timestamps are rejected. Hourly detail charts also use the shared KST parser and fixed one-hour steps: 25 consecutive slots ending at the latest observation, with `24:00` normalized to the following midnight. Host DST gaps or repeated hours cannot drop or duplicate a KST slot. `makeAirInfo` and `makeAirInfoList` apply the same predicate to every AirKorea observation row; empty or entirely stale stations are omitted and older hourly slots carry no observed values. Regional daily forecasts remain forecasts. Explicit non-AirKorea rows keep the provider chain's own timestamp validation and source attribution. Sources: [summary builders](../../server/controllers/controllerTown24h.js), [combined summary](../../server/controllers/controllerTown.js), [AirKorea merge](../../server/controllers/kecoController.js); checks: `air-summary.test.js`, `air-summary-smoke.js`, `air-freshness.test.js`, `air-freshness-route.test.js` and `air-freshness-smoke.js` under `server/test/offline`.

### Domestic air fallback and the air provider chain (issues #2622, #2628)

`getAirFallback` runs right after `getKeco` on the v000903 KMA address and coordinate routes. It does nothing when `current.arpltn` holds any AirKorea value. Otherwise it asks the [air fallback](../../server/lib/AQI/airFallback.js) for the town coordinate (`req.gCoord`, else the `townInfo.gCoord` that `getKeco` records; `getKeco` also calls `next()` when the AirKorea lookup fails). This domestic fallback does not change older KMA paths. Overseas DSF and widget requests use the same provider service as described below.

The fallback takes its observation from the [provider chain](../../server/lib/air/providerChain.js) over four [adapters](../../server/lib/air/providers/) with one interface (`fetchCurrent(gCoord, deps, callback)`): Google Air Quality API (`google`), OpenWeather Air Pollution API (`openweather`), Visual Crossing air quality elements (`visualcrossing`) and the WAQI geo feed (`aqicn`). Policy, keys, budgets and operator prerequisites: [air provider policy](../operations/air-provider-policy.md).

- **Order:** while free budgets last, Google → OpenWeather → WAQI (Visual Crossing's free records belong to overseas weather). When every free budget is exhausted: WAQI (no cost), then — only with `AIR_PAID_PROVIDERS_ENABLED=true` — OpenWeather → Visual Crossing → Google, cheapest first. A provider without a key, marked down, or over its budget is skipped without a request. Each provider is attempted at most once per request: one that failed in the free phase is not retried in the paid phase, one that was only skipped by its free budget still is. At most four attempts (about 12 s at the default timeout, plus Mongo time). The first usable observation wins.
- **Request:** one call per provider, 3-second timeout (`AIR_PROVIDER_TIMEOUT_MS`), no retry; the key is never logged, cached or put in a reason, and provider text is not reflected either (WAQI `status` must be a string; unknown values become `status-other`; any exception while reading a body becomes one `invalid-body` failure). `401`/`403` (`auth`) and `429` (`quota`) mark the provider down for 10 minutes for all workers.
- **Acceptance:** an observation at most 8 hours old (and at most 1 hour in the future), from a station at most 30 km away for station data (WAQI; Google, OpenWeather and Visual Crossing are modeled for the requested point), with PM10 or PM2.5. An observation that fails these checks is kept for 30 minutes and re-evaluated per request, while the chain moves on to the next provider.
- **Units:** the [normalized observation](../../server/lib/air/observation.js) holds concentrations — PM in µg/m³, gases in ppm — the units of AirKorea data. Google reports gases in ppb (`ppb2ppm`), OpenWeather and Visual Crossing in µg/m³ (`um2ppm`), WAQI as US EPA sub-indices (`extractValue`). Provider indexes (UAQI, OpenWeather 1–5, `aqius`) are recorded, not used for grades. Grades, strings, `summaryAir` and the integrated index follow the requested `airUnit` as for AirKorea data.
- **Response:** `current.arpltn` in the AirKorea shape with `source` = adapter id (`google`, `openweather`, `visualcrossing`, `aqicn`), `stationName` (WAQI only), `dataTime` (KST `YYYY-MM-DD HH:mm`) and `pm10Value`, `pm25Value`, `o3Value`, `no2Value`, `coValue`, `so2Value`. The observation also replaces the (stale) AirKorea station lists, so `airInfoList` has one entry with the same `source`; its hourly chart has the current hour only, the AirKorea regional daily dust forecast is still attached, and the station-name hourly forecast lookup (`AirForecastList`) is skipped. AirKorea-derived objects are unchanged (`airInfo.source: "airkorea"`, no `arpltn.source`).
- **Budgets:** counters live in the Mongo collection `air.provider.usage` ([model](../../server/models/air.provider.usage.model.js)), shared by all API workers: Google and OpenWeather per UTC month (stop at 95 % of the free cap), OpenWeather also per rolling minute (this minute's calls plus the previous minute's weighted by the part still inside the last 60 s), paid calls per provider per month, and the down markers. A missing counter counts as zero, so a cap of 0 blocks from the first call. Visual Crossing counts its `queryCost` in `vc.usage` and respects `VC_DAILY_RECORD_LIMIT` and the `~provider` marker of #2585. Free counting is read-then-increment and the minute window remains approximate. Paid monthly admission instead reserves a slot atomically before HTTP, after all applicable policy reads succeed. Read/reservation failures deny that paid candidate; concurrent reservations cannot exceed the paid monthly cap. Reservations are not refunded or counted twice; completion accounting retains the reservation month across UTC rollover (D20).
- **Shared cache:** results live in `air.observation.caches` ([model](../../server/models/air.observation.cache.model.js)), one document per 0.01° cell of the town coordinate with the provider recorded, so a second request for the town is served without any provider by any worker. Successful fetches are kept 30 minutes, failures (every eligible provider failed) 2 minutes; a TTL index on `expireAt` removes old documents and readers ignore expired ones. A request that fetched finishes only after the cache write is acknowledged; concurrent requests for one cell in a worker share that fetch, while simultaneous first requests on different workers can each fetch. Cache errors can cause refetches; free-budget reads remain fail-open, while paid policy-read/reservation errors suppress paid HTTP; like the other Mongo reads of the route, a hung Mongo operation is not bounded by the provider timeout.
- **Failures** (no provider configured, timeout, HTTP error, malformed body, stale or distant station, no PM value) leave the response as before, without air. Provider fields of an unexpected type are ignored.

WAQI republishes AirKorea observations for Korean stations; Google, OpenWeather and Visual Crossing model their own values, so they also cover an AirKorea outage. [Sequence diagram](diagrams/domestic-air-fallback.html) · [JSON](diagrams/domestic-air-fallback.json). Checks under `server/test/offline`: `air-chain.test.js`, `air-fallback.test.js`, `air-chain-smoke.js` (v000903 routes with one loopback server playing all four providers), `air-budget-mongo-smoke.js` (worker processes on a real mongod) and `air-chain-node10-check.js`.

### WAQI station names (issue #2622)

WAQI station names can be full addresses, e.g. `Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)`. A name longer than 20 characters is delivered as its smallest unit: the first comma-separated part without the parenthesized native name (`Sasazuka`, `Ido-dong`). Shorter names such as `Seoul (서울)` are unchanged. This applies to the domestic fallback (WAQI stations) and to the overseas `current.arpltn.stationName` ([helper](../../server/lib/AQI/waqiStationName.js)).

### Forecast precipitation amounts (issue #2583)

Since `VilageFcstInfoService_2.0`, `PCP`, `SNO` and forecast `RN1` are hourly values, often given as categories. The [shared parser](../../server/lib/kmaPrecipitation.js) turns each value into an amount plus bounds:

| Provider value | Stored amount | Bounds | Approximate |
| --- | --- | --- | --- |
| `강수없음` / `적설없음` | 0 | 0 | no |
| `2.0mm`, `1.2cm`, `7` | the number | the number | no |
| `1mm 미만` | 0.5 (half the threshold) | 0 to 1 | yes |
| `30.0~50.0mm` | 40 (midpoint) | 30 to 50 | yes |
| `50.0mm 이상`, `5.0cm 이상` | 50 / 5 (lower bound) | 50 / 5 and up | yes |

The collector stores the amount in `r06`/`s06`/`rn1` (legacy names) and, for a category only, the provider text in `r06Text`/`s06Text`/`rn1Text` (both DB versions). Unparseable text stays `-1`. Rows without text (for example from the older `parseFloat` gather code) are read as exact amounts. DB 1.0 keeps 192 short rows (eight days of hours) instead of 64.

Composition in the v000901–v000903 KMA chains (`ControllerTown24h`). v000705 and v000803 also use `ControllerTown24h.adjustShort`. v000001 shares steps 1, 2, 3 (without the `r06` replacement) and 5, but uses the base `adjustShort`, so it keeps `-1` amounts without `Hours`/`Approx` and has no `convert0Hto24H` (its day window follows its own slot times), and chains without `convertUnits` keep `s06` in cm:

1. `getShort` sums every stored hourly row into its 3-hour slot. Slot T holds hours T-2, T-1 and T, so the next-day 00:00 slot (`2400` after `convert0Hto24H`) holds 22h, 23h and 00h. This is the grouping already used for observations and shortest forecasts. A slot with an amount whose last hour is dry (`pty 0`) takes the precipitation type of its hours (rain + snow → 2, as for observations; otherwise the latest code, e.g. shower 4), so the stored hourly rows never produce `pty 0` with a positive amount. Later merges (RSS, shortest window) set `pty` from their own slot hour, so the combination remains possible there and clients should treat it as valid. `sky`, `pop` and temperatures stay slot-hour values.
2. `getShortRss` labels copied RSS `r06`/`s06` as six-hour amounts (`Hours 6`); the overwrite/fill policy is unchanged.
3. `mergeByShortest` keeps, for a slot with three valid hourly `rn1` values (observed for past hours, shortest forecast otherwise), their total. `ControllerTown24h.adjustShort` uses it as `r06`; it never goes to `s06`. Slots without it keep the `PCP` total. The old sampling and splitting across slot pairs is gone. Since #2620 the same merge also replaces a covered slot's `pop` with the shortest `POP` of the slot hour T, matching the slot-hour `pop` of short rows; when hour T has no valid `pop` (`-1`, or absent on rows stored before #2620) the short value stays. Today's `강수확률` summary and the daily `pop` maximum read the merged slots.
4. Every `short[]` slot leaves `adjustShort` with `r06 ≥ 0` and `s06 ≥ 0`; a slot without forecast hours is a 0 placeholder with `Hours 0`.
5. `mergeMidWithShort` sets daily `r06`/`s06` to the total of that day's slots (hours 01–24). When a six-hour RSS amount is in the day, the daily amount and its fields are omitted.
6. `convertUnits` multiplies `s06` by 10 (cm → mm) as before; it now holds snow only.
7. `insertStrForData` builds `r06Str`/`s06Str`/`rn1Str` from the bounds in the source unit (`10mm`, `~1mm`, `30~51mm`, `50~?mm`, `1cm`). The retired 1/5/10/20/40/70/100 table is removed. A zero amount gets a string only for the matching precipitation type of `pty`.

Response fields (additive; existing names and meanings of the amounts are kept):

| Location | Field | Meaning |
| --- | --- | --- |
| `short[]` | `r06`, `s06` | Forecast rain (mm) / new snow (cm before, mm after `convertUnits`) over the slot |
| `short[]` | `r06Hours`, `s06Hours` | Hourly forecasts summed: 3 for a full slot, 1–2 for a partial slot, 6 for an RSS six-hour amount, 0 for a placeholder |
| `short[]` | `r06Approx`, `s06Approx` | `true` when a category value was used |
| `short[]` | `rn1` | Unchanged: observed rain summed over the slot, on past rows |
| `shortest[]` | `rn1Hours` (1), `rn1Approx` | Hourly forecast rain |
| `shortest[]` | `pop` | Hourly probability of precipitation, % (#2620); `-1` when the row had no valid `POP`, absent on rows stored before #2620. Not copied to `current` |
| `midData.dailyData[]` | `r06`, `s06`, `r06Hours`, `s06Hours`, `r06Approx`, `s06Approx` | Day totals; `Hours` is 24 for a fully covered day |

Installed apps print `rn1`, then `s06`, then `r06` when truthy (`client/www/js/app.js`, `controller.forecastctrl.js`); they now show slot totals instead of halves or samples. The days beyond the 3-hour template come from daily snapshots and carry no amounts, as before. The precipitation branch of `_convertWeatherData` still passes `toWindUnit` (unchanged, see [client data contracts](../rewrite/client-data-contracts.md#missing-values-time-and-units-are-compatibility-rules)). Checks: `precipitation.test.js` and `precipitation-smoke.js` under `server/test/offline`.

## World-weather API middleware in order

The [v000902 DSF router reused by v000903](../../server/routes/v000902/route.dsf.coord.v000902.js) performs the following; v000903 mounts it through [route.dsf.coord.v000903.js](../../server/routes/v000903/route.dsf.coord.v000903.js), which only sets `req.dsfFromDayBeforeYesterday` (rows from the day before yesterday, #2585):

1. `checkQueryValidation`, then adapts parameters to `category=current`, `days=2`, `gcode=:loc`, `aqi=airUnit`, `validVersion=true`.
2. `queryTwoDaysWeatherNewForm`: overseas weather retrieval (Visual Crossing since #2585, stored in the DSF-named cache) and shared air-provider retrieval in parallel, including cache fills as described in [collection](weather-collection.md#overseas-visual-crossing-request-time-collection).
3. `convertDsfLocalTime`, `mergeDsfDailyData`, `mergeDsfCurrentDataNewForm`, `mergeDsfHourlyData`.
4. `mergeAqi`, `dataSort`, lower-case icon normalization, `convertUnits`, `makeAirInfo`, `makeSummary`, `sendResult`.

The response shape differs from KMA: world weather uses `daily`, `hourly`, `thisTime`, `pubDate`, location/time-zone context and units, with air enrichment when available. `dataSort` sets `source: "VC"` and the merges write `pubDate.VC` (formerly `DSF`/`pubDate.DSF`). Current apps show a "Weather Data Provided by Visual Crossing" text link when `source == 'VC'`. Released app versions do not recognise `VC`, so a city keeps its stored `source`: released TodayWeather iOS builds set `DSF` for every non-KR current position, and overseas cities stored before the switch keep `DSF`. Those cities show "Powered by Dark Sky" over Visual Crossing data until the app is updated; other overseas cities in released apps show no attribution. Native widgets and push messages show no attribution. Weather retrieval errors propagate to Express unless a stored current record (fresh, or up to 6 hours old) can be served; air misses/failures are tolerated without suppressing weather errors. The frontend chooses the world parser whenever `source !== 'KMA'`, so malformed non-KMA bodies are not automatically rejected at the source discriminator.

Sources: [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js), [world unit conversion](../../server/controllers/worldWeather/controller.ww.units.js), [client parser selection](../../client/www/js/service.weatherutil.js).

### Overseas UV (#2634)

Visual Crossing `uvindex` is requested and carried through the converter, DSF parser
and optional `DsfForecast` current/hourly/daily `uvIndex` fields. The final overseas
`thisTime[]` and `daily[]` rows expose numeric `uvIndex` and mobile-compatible
`ultrv`, `ultrvGrade`, `ultrvStr`. Current UV is the current observation (or the
current-hour fallback); daily UV is the provider's daily maximum. A daily weather
fallback never supplies UV for a missing current/hourly observation.

Only finite nonnegative numbers are accepted, including zero. Missing, null,
non-numeric, nonfinite and negative values stay absent; old cache documents have
no UV default and remain usable until normal refresh. UV does not depend on the
requested temperature/wind units. Request-local translations and the existing
KMA UV grade boundaries/labels are reused; translated strings are not cached.

Existing mobile templates read the daily `ultrv`/grade/text fields (including the
today summary), while the web normalizer accepts both these fields and `uvIndex`.
No native widget UV display is added. The former Dark Sky path did not expose UV,
so this is an additive capability, not a restored pre-migration field. Request
range, `include`, cache policy and number of provider calls are unchanged; actual
billed cost and deployed responses still require separate live verification.

Regression: `server/test/offline/overseas-uv.test.js`; real isolated Mongo/HTTP
smoke: `server/test/offline/overseas-uv-smoke.js`. The Tokyo UV fixture was recorded on 2026-09-29; additional edge cases use
explicitly synthetic UV. A paired live Tokyo request returned queryCost 49 both
before and after adding UV (same last1days/next7days range). Local evidence does
not establish production rollout. [Updated request diagram](diagrams/mobile-weather-request.html).

### Overseas request-time air provider chain (#2628 PR 2)

The active `queryTwoDaysWeatherNewForm` starts the shared [air service](../../server/lib/AQI/airFallback.js) in parallel with weather retrieval. This covers the v000901/v000902 DSF coordinate routes, v000903 (which reuses v000902), and the widget route using that query. A weather cache hit still runs the air branch. These requests no longer read/prune the old `aqi` collection or issue a second legacy WAQI request. Older collector/query methods remain for their existing callers.

Domestic fallback and overseas requests share the same `air.observation.caches` and provider budgets/order, including D20 paid reservation. Cached observations remain in normalized concentrations with their UTC observation instant, independent of response units and timezones. An optional normalized observation in the shared service callback preserves the existing domestic callback result while letting the overseas path format observation time using the response timezone.

Only current air is attached to the current weather row. It is not copied to yesterday, hourly weather, or daily forecasts. Concentrations are used directly; they are not converted to rounded WAQI indices and back. Grades, integrated index, action guides and summary follow the requested `airUnit`. DSF responses carry the actual adapter id in `current.arpltn.source` and `airInfo.source`, with optional plain-text `attribution` on both (also `airInfo.last.attribution`). The `/ww` widget route preserves raw `airSource` and `airAttribution` fields instead of DSF response shaping. Clients own display labels/links and safely render the supplied attribution, including WAQI original agencies; the server does not render branding. Modeled providers have no invented station name. Missing pollutant values remain absent.

No configured provider, unusable air or provider failure leaves the weather response usable without air summary. Weather errors still follow the existing weather error path. The complete optional-air branch, including cache/store waits, has a 4-second default deadline (`AIR_RESPONSE_DEADLINE_MS`, 500–8000 ms). Expiry releases the weather join without air; late results only finish shared-cache work and never mutate the finished request or invoke its continuation again. Early completion clears the timer. The deadline bounds air-added waiting, not geocoding or weather retrieval; per-provider HTTP timeouts remain separate. This is repository behavior, not evidence of production deployment. [Sequence diagram](diagrams/world-air-request.html) · [source](diagrams/world-air-request.json).


## Retry, caching and failure behavior

| Layer | Actual behavior | Consequence |
| --- | --- | --- |
| Client city state | Refresh only when load time is null or older than 10 minutes | Fresh memory state suppresses calls; manual reload bypasses it |
| Client HTTP | Initial request plus recursive timers after 2 seconds; three attempts maximum, default 10-second timeout per attempt | Slow requests can overlap at approximately 0, 2 and 4 seconds |
| Client completion | Success/error clears only that attempt's timer; first callback settles the shared promise | An early error is terminal even if another in-flight request may later succeed; existing requests are not cancelled |
| Backend geocode | 3 attempts with 3-second per-request timeout | Coordinate requests can spend additional time outside the weather database |
| Overseas (DSF-named) cache | Current data window 15 minutes; cached per 0.02° grid cell (about 2 km); reads limited to the last 4 days; v000903 rows from the day before yesterday (hourly through the day after tomorrow 24:00, daily to +7), other versions and `/ww` from yesterday (hourly to now + 48 h); stored yesterday used without hourly completeness checks; per-location Mongo lock; on failure a stored current record up to 6 hours old is served | A cache miss makes one Visual Crossing call (`combined` without yesterday, else `forecast`). The response waits at most 2.5 seconds from the request time, while the lock holder's call may run for 8 seconds and still store its records; lock waiters poll until 2.5 seconds after their request time. A failed fetch blocks the location for 2 seconds; a daily-limit 429 or rejected key stops calls for 10 minutes. A stale fallback is not flagged in the response: clients see its age only through `pubDate.VC` and the current row's time |
| Active overseas air cache | Shared normalized observation per 0.01° cell: 30 min observation / 2 min failure; re-evaluated each request | Independent of weather cache, units and local display time; legacy WAQI cache remains for old query methods |
| Domestic air provider chain (#2622, #2628) | Mongo `air.observation.caches`, one document per 0.01° town cell (ok 30 minutes, failure 2 minutes); budgets and down markers in `air.provider.usage`; shared by all API workers; a fetching request answers after the write | Used only when AirKorea has no current observation; one chain run per cell per period, except simultaneous first requests on different workers |
| HTTP cache | Deployed weather Lambda success max-age=300; geocode success 30 days; CloudFront weather/geocode min/default/max=0/86400/31536000; API stage cache disabled | Origin success headers differ from CDN defaults and client memory TTL; direct legacy routes use a different behavior |

The comment in the client says 1.5-second retries and a nine-second total; the executable code uses 2-second timers and a default 10-second per-request timeout. Document the code. Immediate errors clear the retry timer, so this is not a conventional retry-after-failure algorithm. The wrapper's unused-style three-argument overload also assigns `callback` after setting `timeout=null`; the inspected `_getHttp` path uses the four-argument form and avoids that branch.

On rejected loading/conversion, the controller presents a retry confirmation and records analytics. Existing city state and persistence are separate from successful freshness updates; the source does not establish a comprehensive offline synchronization contract.

## Native widget differences

TodayWeather and TodayAir widgets use Objective-C request code and their own path constants, including unversioned `weather/coord` and v000901 KMA address paths. They read shared preference data created by the app. Apple Watch contains an older extension and bundled web assets; the root README explicitly records a historical watch integration problem. Do not assume that all shipped native clients use the current Angular v000903 contract.

Sources: [weather widget](../../tw.ios/widget/TodayViewController.m), [air widget](../../ta.ios/widget/TodayViewController.m), [storage bridge](../../client/www/js/service.storage.js), [original README](../../README.md).

## Daily forecast validity (issue #2560)

The mid-land/temperature collectors preserve available day-3–10 fields without
requiring day 3 or day 10. Both storage versions retain publication/region and
optional precipitation probabilities. Mid composition joins by each source's
KST target date, with independent 36-hour publication limits and no future or
mismatched identity. Short daily overlays have a 24-hour publication limit. When primary short data is stale or its publication is absent, a request-local snapshot of fields actually copied from matched short RSS slots supplies daily input. Its own KST publication determines freshness and the publication-date+4 target ceiling. Later mixed-hourly extrema cannot revive untouched stale values; incomplete RSS-only days remain unavailable. The accepted feed timestamp alone is never sufficient.
The seven-day observation history remains; unavailable days are omitted and
listed in additive `midData.dailyStatus.unavailableDates`. The captured day-4
forecast remains September 28, with September 27 unavailable unless an actual
valid source supplies it. Existing v000903 `tmn`/`tmx` output conversion remains.

Legacy **mid RSS is retired**: scheduled collection/storage entry points are
disabled and `getMidRss` passes through without cached overlay. Short RSS remains
independent. No replacement feed or production recovery is claimed.

See the [daily validity diagram](diagrams/daily-forecast-validity.html),
[editable source](diagrams/daily-forecast-validity.json), and
[contract, source policy and operator checklist](../operations/daily-forecast.md).

RSS-only daily fallback omits `r06`/`s06` aggregates: accepted RSS values are overlapping six-hour amounts, not 3-hour slot totals of hourly forecasts ([amount contract](#forecast-precipitation-amounts-issue-2583)). Summing them would overstate the daily amount. Hourly precipitation remains unchanged; missing daily aggregates mean unavailable, not zero.

The daily boundary also reads raw short targets beyond the unchanged hourly41-slot template. DB2 preserves each source document's publication; DB1 stores an optional current-batch `dailySource` snapshot, replaced completely on successful saves. Legacy DB1 documents without it cannot extend daily horizons until normal collection. Each raw slot is validated independently and must provide usable daily extrema/weather; raw rain totals are omitted. Shared weather acceptance/conversion includes both shower labels using existing rain icons. Humidity is optional for short daily summaries. `dailyStatus.healthy` now rejects gaps from today through the last available forecast, with unsupported trailing dates listed separately. A sanitized degraded-health warning is limited to one per minute per process. No new public provenance fields or hourly horizon expansion is introduced.

## Historical observation composition (#2564)

When `ASOS_HISTORY_READ_ENABLED=true`, the shared station middleware also reads the new ASOS cache, independently of the grid DB version. Town coordinates map to the nearest configured city station within 100 km, with station name/ID, distance and mapping method reported. Missing station metadata, coverage or cache reads remain explicit status reasons. The seven complete KST dates end yesterday. The normalized station/time key fills missing hourly fields without requiring temperature itself to be missing; valid grid fields are retained. No provider call or historical write occurs during this read.

The daily merge runs after existing short/observation composition and before units/enrichment. An official daily record uses its own KST date and valid extrema; it survives absent hourly humidity and absent AM/PM weather text. Incomplete hourly-derived daily measurements may be replaced by the valid daily record. Valid complete existing observations/current/future forecasts remain intact. The legacy hourly daily summarizer no longer mutates source timestamps or drops a sparse first noon observation; optional missing quantities remain absent.

`historyStatus` adds D-7..D-1 bounds, missing hourly slots, missing daily dates, optional hourly-field gaps and station/read status. Partial hourly-derived daily rows remain flagged as daily gaps until a complete aggregate or official daily record exists. Existing `midData.dailyStatus` continues to describe forecast coverage; historical observation rows do not require forecast AM/PM text. Stored provenance and contributed field names remain available on recovered observations. The public 41-slot three-hour series and the client's eight-slot comparison offset remain unchanged, as AK confirmed; the visible hourly view does not expand to seven days.

[Recovery diagram](diagrams/historical-observations.html) · [Operator/test contract](../operations/historical-observations.md). Isolated local tests cover real Mongo/loopback HTTP plus actual route and shared client parsers; native mobile runtime and production recovery are separate operator checks.

Actual-data browser validation found that legacy charts print negative rain sentinels as `-1mm`. Final hourly response projection now omits invalid rain fields on rows carrying historical recovery provenance, after internal aggregation/unit conversion; valid zero/measured rain and unrelated rows are preserved. No client update is required for this correction. Internal sentinels remain unchanged, and `historyStatus` still reports missing fields.


### Exact-hour fallback and response latency (#2648)

The shared middleware starts legacy station hourly reads and the opt-in ASOS cache read concurrently after town lookup. It waits at most 250 ms for this fallback stage, then proceeds once; late callbacks cannot mutate that response. This is a scheduling budget, not a bound on total API latency or a database cancellation guarantee. Process-local caches coalesce reads and retain snapshots for 30 seconds (station metadata: 60 seconds); failed reads remain cached for 2.5 seconds. A successful DB callback after the read deadline can warm the same cache entry without re-completing waiting callers; it cannot overwrite a newer entry. Each cache is bounded to 256 entries. Worker processes have separate caches. Database execution uses `maxTimeMS` (2 seconds per legacy/metadata query; existing history-store limits remain unchanged).

Legacy BSON dates encode KST wall-clock components in UTC fields; this compatibility convention requires UTC ingestion and is pinned by a timezone-specific regression, not portable host-local parsing; ASOS history uses real UTC plus its explicit KST key. Both fill only invalid fields at an exact normalized hourly key, preserving valid grid measurements, including zero and negative temperatures. Legacy station rows are labeled `KMA_STATION_HOURLY`, rather than assumed to be validated ASOS records. Recovery contributes per-field provenance; only temperature provenance governs comparison eligibility.

Yesterday is selected from the current observation's date/hour minus 24 hours, including `2400` normalization. Missing temperatures produce an additive `missing: true, comparisonAvailable: false` object with no temperature. Valid temperatures from incompatible sources or stations, and any pair with an invalid current temperature, also set `comparisonAvailable: false` and omit `yesterday.t1h` in the response projection. Older apps compare whenever both temperature fields exist and ignore the additive flag, so omitting the field is required for compatibility. Stored/list observations and other weather fields remain intact. At duplicate `2400`/next-day `0000` identities, selection prefers a valid temperature over an invalid first row; existing weather descriptions remain available. Newer live station temperature replacements carry `KMA_STATION_LIVE` provenance, and retain the established live-current versus same-town grid-yesterday comparison when the live measurement belongs to the current hour and the grid slot is exactly 24 hours earlier. Live/live comparisons require the same station and a 24-hour separation after validating and flooring minute keys. ASOS/grid, differing station/network, stale-hour and invalid-temperature pairs remain suppressed. Hourly/live station-source equivalence is not inferred. Eligibility is computed in Celsius before requested unit conversion. This does not assert spatial equivalence of station and grid weather, change provider collection quotas, or authorize historical backfill.


## Fresh station observations in current weather (#2573)

`getKmaStnMinuteWeather` no longer depends on recent hourly station rows. When `findHourlies2` finds none, `getStnHourlyAndMinRns` marks `hourlyMissing` and still reads minute observations. If the station observation is newer than `currentPubDate`, `t1h`, `reh`, `vec` and `wsd` are replaced by values that pass `_isValidObservation` range checks. Older observations only fill missing or sentinel values, as before. `rn1`, cloud and weather handling are unchanged. The API values before the merge remain in `current.dongnae`, and `liveTime` carries the observation time. This path has no feature flag. Cached responses add delay: the CloudFront default behavior (300–600 s) for direct `/v000903/kma/...` requests, and the weather Lambda's `max-age=300` for the app's `/weather/*` path. See the [operator runbook](../operations/kma-station-observations.md).

D23 response hint: when the overseas air deadline expires with work outstanding, both DSF and `/ww` add top-level `airStatus: {"state":"pending","retryAfterSeconds":3}`. It describes the cutoff state and suggests a delay; the client decides whether to request again. It guarantees neither success nor completion within three seconds. Early success and terminal no-air failures omit it. The hint is request-local, never cached, and late callbacks cannot alter it. No automatic retry or HTTP Retry-After is added.

## Temporary overseas weather unavailability (#2635)

The repository's `tw-svc` gateway (`server/routes/gateway.js`, introduced in #2606)
returns **503 Service Unavailable** when Visual Crossing has an active provider-down
marker or the configured daily record budget prevents a fetch **and no usable
stored current weather is available**. Stored-weather fallback still succeeds.
This describes repository behavior, not a new production deployment observation;
the AWS/Lambda table above retains its 2026-09-20 historical scope.

`Retry-After` is a positive integer number of seconds, capped at **3600**. Its
absolute deadline is the provider marker's `expireAt`, or the next UTC midnight
for the usage day checked. Remaining seconds are rounded down, with a minimum of
one second for the final fractional second or a deadline crossed in transit.
The shared DSF handler passes only `EWEATHERUNAVAILABLE` and `retryAt` in its
internal 503 JSON; the gateway recomputes the delay and sends a generic text body.
It does not immediately retry this typed outage. Public 503 responses retain
`Access-Control-Allow-Origin: *` and `Cache-Control: no-store`. Unclassified
weather failures still map to 501, invalid input to 400 and `(0,0)` to 404.
Existing gateway overload 503 remains `Retry-After: 5`.

Cordova's `WeatherUtil` handles 503 through the same `$http.error` callback as
other HTTP errors; its existing overlapping attempt timers are unchanged. The
checked-in iOS widget does not branch on HTTP status, so plain-text 501 and 503
follow the same response-body parsing path. Neither client is claimed to honor
`Retry-After`. This compatibility assessment is source-based, not a mobile build
or device test. See the [pre-change issue record](https://github.com/WizardFactory/TodayWeather/issues/2635#issuecomment-5884077414).

## Cordova payment removal (#2641)

Google measurement/config follow-up (#2654): the maintained `Util.ga` facade now
sends whitelisted Ionic route screens and authorization observations through
Firebase Analytics rather than retired UA/Fabric. `Monetization` drops raw
labels/identifiers and delegates delivery to native collection/consent. Native automatic
screen reporting is disabled to avoid duplicate Ionic `screen_view`; AdMob
automatic revenue remains the sole `ad_impression` source after account linkage.
The common weather request emits `weather_fetch` once after its existing retry
chain; the Tab parser records a separate `weather_load` result without address
or coordinate labels. Neither changes API URLs or retry semantics.

TwAds additionally applies validated Remote Config banner enable/delay parameters
over existing consent, enable and screen visibility. First display and opportunity
exposure wait for config completion/failure or the 12-second deadline; a cached
disabled policy hides immediately. Delay is measured from service creation.
Defaults preserve enable/delay policy; offline fetch retains activated cache and delayed callbacks cannot overwrite
policy after the application deadline. Orientation recreation is serialized and
stale callbacks after disabling cannot show. Native load failure releases the
one-shot adapter listeners. The adapter preserves five-second explicit-load
spacing in JS, disables the native interval that otherwise returns silently,
and cancels a scheduled load when removing a banner. See [monetization operations](../operations/monetization.md)
and the advertising diagram below. Console linkage and physical-device evidence
remain separate from these repository implementation facts.

The maintained `client/www` app no longer registers a purchase state, loads a billing controller, or offers purchase, restore, renewal or paid-app links. Both legacy app billing plugin installers were removed from the shared Gulp tasks; `cordova-plugin-inappbrowser` remains unrelated and supported. The config generator discards imported paid-app flags/URLs. AK confirmed there are no existing paid users, so there is no entitlement compatibility service.

`TwAds` enables ordinary ads when its adapter becomes ready and retains in-memory screen visibility requests. Start/guide screens directly request show/hide; native adapter consent and failure behavior are unchanged. `TwStorage` no longer migrates `purchaseInfo`, `storeReceipt` or `twAdsInfo`; existing stale keys are ignored rather than deleted. See the [advertising sequence](diagrams/cordova-advertising.html) and [source](diagrams/cordova-advertising.sequence.json).

The server's receipt-validation endpoints and dependency remain unchanged in this app-only PR; removal is tracked in [#2642](https://github.com/WizardFactory/TodayWeather/issues/2642). Historical native bundled web trees are not the modern Cordova build source and are outside this change. The legacy iOS project files still copied by Gulp have their unused StoreKit links and In-App Purchase capability removed. These are repository changes, not a deployment observation.

## Nation air recovery (#2636)

The shared `v000803/route.nation.js` router (also mounted by v000903) retains the
`air` and `weather` arrays. `lib/air/nationAir.js` first reads the latest Mongo
province aggregate for each of the 17 map labels. It uses an AirKorea row only
with valid PM, a KST observation younger than eight hours and no timestamp more
than one hour ahead. Missing/unusable rows or DB read errors invoke exactly the
same `airFallback.getArpltn()` service used by domestic weather, at each province's
fixed representative city point. **Client-requested recovery never calls the
AirKorea API.** It reuses provider order, budgets, down markers, distance/age
validation and shared observation cache without a new AirKorea write.

Up to four points run concurrently under one `AIR_RESPONSE_DEADLINE_MS` budget
(default four seconds), including Mongo reads. At expiry, no new calls start;
late in-flight work may populate the shared cache but cannot change the completed
response. Partial air remains usable and does not fail weather. Fast successful
providers can fill all missing provinces in one response; slow providers may
leave explicit gaps until later requests read the cache. No complete coverage
is inferred from HTTP 200.

Rows keep `sidoName`, `cityName`, `dataTime`, pollutant values and the requested
`airUnit` grades. Additive `source` and `coverage` distinguish `airkorea` /
`province-average` from a global-provider `representative-point`. Fallback rows
also carry `attribution`, `representativeCity` and `{lat, lon}` representative
coordinates. They are point estimates, not nationwide/provincial aggregates.
Additive `airStatus.provinces` lists all 17 names with availability, source and
reason; `airkorea: database-error` differs from `missing`, `stale`, `future`, or `invalid` stored data.
The existing native maps continue to use `air`; physical device confirmation
remains a post-rollout check.

Representative points, in map-label order: Seoul, Busan, Daegu, Incheon, Gwangju,
Daejeon, Ulsan, Suwon (Gyeonggi), Chuncheon (Gangwon), Cheongju (Chungbuk),
Hongseong (Chungnam), Jeonju (Jeonbuk), Mokpo (Jeonnam), Andong (Gyeongbuk),
Changwon (Gyeongnam), Jeju City and Sejong. Exact fixed city-centre coordinates
are in [nationAir.js](../../server/lib/air/nationAir.js). Existing map labels
are preserved. The [recovery diagram](diagrams/nation-air-recovery.html) separates
DB lookup and global-provider recovery from scheduled AirKorea collection.

### Optional measurement consent (2026-10-01 candidate)

`Monetization.init` restores a versioned explicit local grant only when the persisted native collection preference also allows it; missing, false or unreadable native state requires a fresh settings choice. Collection defaults off. Settings offer grant/refusal/withdrawal, with synchronous event-gate closure and serialized native writes that coalesce pending choices. Failed persistence invalidates the old WebView grant; bridge failures compensate with collection off and all consent modes denied before a newer choice runs. If both storage invalidation and native writes fail, the UI reports failure and cannot promise durable withdrawal. The legacy opt-out facade can withdraw but cannot grant. Advertising storage/user-data/personalization remain denied. Native install defaults and explicit iOS plist entries close fresh-install collection before JS startup; upgrade preference overrides still need device evidence. UMP ad choices remain separate from Analytics consent and provider/location/push flows. `ios-no-tracking.js` enforces nonpersonalized Ads requests/publisher first-party-ID off and removes unused generated GTM linking to avoid indirect IdentitySupport. Privacy manifests mark device-linked coordinates/IDs accurately; these source constraints do not certify whole-app runtime tracking. [Operating review](../operations/store-privacy-review.md) records remaining archive/network/retention/deletion gates.

## Domestic food-poisoning forecast (#2600)

After KMA life-index enrichment, the domestic controller independently reads MFDS
regional forecasts by request province/district. Exact district values take
priority over province rows per date. The merged Gwangju/Jeonnam province resolves
by district; ambiguous merged-province requests omit the optional fields.
Only current KST today..+2 dates within the source's own three-day interval are
eligible. Old, future or malformed records remain absent. No weather row is
created for a missing date.

`midData.dailyData` receives `fsn` in percent and page-threshold `fsnGrade` (0–3);
`_appendLifeIndexToCurrent` copies today's fields and `insertStrForData` generates
localized `fsnStr` for daily/current rows. Missing stores, read errors or the
independent two-second deadline preserve weather HTTP success; late store results
cannot mutate completed responses. The request never fetches MFDS. Both domestic
storage versions use this separate region/date reader. Existing app food-poisoning
rows remain compatible. See the [operating contract](../operations/food-poisoning.md)
and [design diagram](diagrams/food-poisoning.html).
