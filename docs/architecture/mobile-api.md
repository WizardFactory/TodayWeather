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
| Purchase validation | `/v000705/check-purchase` | Platform-selected purchase controller/plugin |

The exact coordinate condition uses truthiness, so latitude `0` does not take the normal coordinate branch. Address fallback prefixes `대한민국` when missing before extracting region/city/town. This is legacy behavior, not general worldwide address parsing. URL builders concatenate strings; they do not explicitly encode each path segment.

Sources: [builders and selection](../../client/www/js/service.weatherutil.js), [warnings](../../client/www/js/controller.kma.special.js), [push](../../client/www/js/service.push.js), [purchase](../../client/www/js/controller.purchase.js), [build configuration selection](../../client/gulpfile.js).

### Query parameters and headers

Weather builders append all settings from `Units.getAllUnits()` and then `airForecastSource=kaq`. The settings include `temperatureUnit`, `windSpeedUnit`, `pressureUnit`, `distanceUnit`, `precipitationUnit`, and `airUnit`. Defaults vary by locale/settings; do not assume every device requests Celsius or the same AQI standard. Server KMA query handling fills missing or literal `(null)` unit values, and defaults an absent `airForecastSource` to `airkorea`.

The weather `_retryGetHttp` wrapper specifies only `{method:'GET', url, timeout}`; it does not explicitly attach `Device-Id` or language headers. Push and some purchase requests set their own headers. Server logging of `device-id` is not proof that every weather request sends it.

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
| Enrichment | `getLifeIndexKma`, `getHealthDay`, `getKeco`, `getKecoDustForecast`, `getRiseSetInfo`, `insertIndex`, `makeAirInfoList`, `AirForecastList` | Life/health/air/sunrise data |
| Presentation | `insertSkyIconLowCase`, `setYesterday`, `getSpecialInfo`, `convertUnits`, `insertStrForData`, `getSummaryAfterUnitConverter` | Icons, yesterday comparison, warnings, requested units and text |
| Response | `makeResult`, `sendResult` | JSON containing available product fields |

`getRiseSetInfo` copies stored KASI values into `midData.dailyData`. Days without a stored row, or all days when the store lookup fails, get `sunrise`/`sunset` (`YYYY.MM.DD HH:MM`, KST) computed from the request coordinate with the NOAA solar equations; the other KASI fields (`moon*`, twilight, `suntransit`, `locationName`, `locationGeo`) appear only for stored rows. `getLifeIndexKma` adds `ultrv`/`ultrvGrade` for days with a stored UV value; a store or provider failure only omits them (#2587).

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

Local checks run with `node server/test/offline/rss-wind.test.js` (Node 18+; no DB/provider access). See the [verification record](../../reports/sdlc/issue-2554/self-verification.md) for actual response-path smoke coverage and limitations. No production restart/deployment is part of this change; origin/CDN comparisons must follow a separately approved deployment. Unrelated Jeju HTTP 500 and legacy historical placeholders are not explained by this patch.

### Current air summary (issue #2578)

`getSummaryAfterUnitConverter` fills `current.summaryWeather`, `current.summaryAir` and the combined `current.summary`; the app shows the first two as the lines under the temperature. `summaryAir` is built only from pollutant and integrated-index grades in `current.arpltn`. `getKeco` leaves `arpltn` absent when no nearby AirKorea station has an observation within eight hours of the request, and every station is compared with that same threshold. `makeSummaryAir` then returns an empty string, and `getSummaryAfterUnitConverter` (and the world-weather `ControllerWWUnits.makeSummary`) omit `summaryAir` from the response. Installed app share text checks `hasOwnProperty('summaryAir')`, so an empty string would add a blank line; the app view hides the line either way (`ng-if="summaryAir"`). Weather or life-index grades on `current` (for example `wsdGrade`) are never treated as air grades, and the combined `summary` does not write air fields onto `current`. AirKorea `dataTime` is still parsed in the host timezone, so the window is wider on a UTC host. Sources: [summary builders](../../server/controllers/controllerTown24h.js), [combined summary](../../server/controllers/controllerTown.js), [AirKorea merge](../../server/controllers/kecoController.js); checks: `air-summary.test.js` and `air-summary-smoke.js` under `server/test/offline`.

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
3. `mergeByShortest` keeps, for a slot with three valid hourly `rn1` values (observed for past hours, shortest forecast otherwise), their total. `ControllerTown24h.adjustShort` uses it as `r06`; it never goes to `s06`. Slots without it keep the `PCP` total. The old sampling and splitting across slot pairs is gone.
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
| `midData.dailyData[]` | `r06`, `s06`, `r06Hours`, `s06Hours`, `r06Approx`, `s06Approx` | Day totals; `Hours` is 24 for a fully covered day |

Installed apps print `rn1`, then `s06`, then `r06` when truthy (`client/www/js/app.js`, `controller.forecastctrl.js`); they now show slot totals instead of halves or samples. The days beyond the 3-hour template come from daily snapshots and carry no amounts, as before. The precipitation branch of `_convertWeatherData` still passes `toWindUnit` (unchanged, see [client data contracts](../rewrite/client-data-contracts.md#missing-values-time-and-units-are-compatibility-rules)). Checks: `precipitation.test.js` and `precipitation-smoke.js` under `server/test/offline`.

## World-weather API middleware in order

The [v000902 DSF router reused by v000903](../../server/routes/v000902/route.dsf.coord.v000902.js) performs:

1. `checkQueryValidation`, then adapts parameters to `category=current`, `days=2`, `gcode=:loc`, `aqi=airUnit`, `validVersion=true`.
2. `queryTwoDaysWeatherNewForm`: overseas weather retrieval (Visual Crossing since #2585, stored in the DSF-named cache) and WAQI retrieval in parallel, including cache fills as described in [collection](weather-collection.md#overseas-visual-crossing-request-time-collection).
3. `convertDsfLocalTime`, `mergeDsfDailyData`, `mergeDsfCurrentDataNewForm`, `mergeDsfHourlyData`.
4. `mergeAqi`, `dataSort`, lower-case icon normalization, `convertUnits`, `makeAirInfo`, `makeSummary`, `sendResult`.

The response shape differs from KMA: world weather uses `daily`, `hourly`, `thisTime`, `pubDate`, location/time-zone context and units, with air enrichment when available. `dataSort` sets `source: "VC"` and the merges write `pubDate.VC` (formerly `DSF`/`pubDate.DSF`). Current apps show a "Weather Data Provided by Visual Crossing" text link when `source == 'VC'`; released app versions do not recognise `VC` and show no attribution. Weather retrieval errors propagate to Express unless stored current and today records can be returned without yesterday; some AQI misses are tolerated. The frontend chooses the world parser whenever `source !== 'KMA'`, so malformed non-KMA bodies are not automatically rejected at the source discriminator.

Sources: [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js), [world unit conversion](../../server/controllers/worldWeather/controller.ww.units.js), [client parser selection](../../client/www/js/service.weatherutil.js).

## Retry, caching and failure behavior

| Layer | Actual behavior | Consequence |
| --- | --- | --- |
| Client city state | Refresh only when load time is null or older than 10 minutes | Fresh memory state suppresses calls; manual reload bypasses it |
| Client HTTP | Initial request plus recursive timers after 2 seconds; three attempts maximum, default 10-second timeout per attempt | Slow requests can overlap at approximately 0, 2 and 4 seconds |
| Client completion | Success/error clears only that attempt's timer; first callback settles the shared promise | An early error is terminal even if another in-flight request may later succeed; existing requests are not cancelled |
| Backend geocode | 3 attempts with 3-second per-request timeout | Coordinate requests can spend additional time outside the weather database |
| Overseas (DSF-named) cache | Current data window 15 minutes; stored yesterday used without hourly completeness checks; per-location Mongo lock | A cache miss makes one Visual Crossing call (`combined` without yesterday, else `forecast`); lock waiters poll up to 2.5 seconds |
| AQI cache | 60-minute freshness test with feed/geographic fallback | Air and weather publication times differ |
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
[contract, source policy and operator checklist](../../reports/sdlc/issue-2560/daily-forecast-contract.md).

RSS-only daily fallback omits `r06`/`s06` aggregates: accepted RSS values are overlapping six-hour amounts, not 3-hour slot totals of hourly forecasts ([amount contract](#forecast-precipitation-amounts-issue-2583)). Summing them would overstate the daily amount. Hourly precipitation remains unchanged; missing daily aggregates mean unavailable, not zero.

The daily boundary also reads raw short targets beyond the unchanged hourly41-slot template. DB2 preserves each source document's publication; DB1 stores an optional current-batch `dailySource` snapshot, replaced completely on successful saves. Legacy DB1 documents without it cannot extend daily horizons until normal collection. Each raw slot is validated independently and must provide usable daily extrema/weather; raw rain totals are omitted. Shared weather acceptance/conversion includes both shower labels using existing rain icons. Humidity is optional for short daily summaries. `dailyStatus.healthy` now rejects gaps from today through the last available forecast, with unsupported trailing dates listed separately. A sanitized degraded-health warning is limited to one per minute per process. No new public provenance fields or hourly horizon expansion is introduced.

## Historical observation composition (#2564)

When `ASOS_HISTORY_READ_ENABLED=true`, the shared station middleware also reads the new ASOS cache, independently of the grid DB version. Town coordinates map to the nearest configured city station within 100 km, with station name/ID, distance and mapping method reported. Missing station metadata, coverage or cache reads remain explicit status reasons. The seven complete KST dates end yesterday. The normalized station/time key fills missing hourly fields without requiring temperature itself to be missing; valid grid fields are retained. No provider call or historical write occurs during this read.

The daily merge runs after existing short/observation composition and before units/enrichment. An official daily record uses its own KST date and valid extrema; it survives absent hourly humidity and absent AM/PM weather text. Incomplete hourly-derived daily measurements may be replaced by the valid daily record. Valid complete existing observations/current/future forecasts remain intact. The legacy hourly daily summarizer no longer mutates source timestamps or drops a sparse first noon observation; optional missing quantities remain absent.

`historyStatus` adds D-7..D-1 bounds, missing hourly slots, missing daily dates, optional hourly-field gaps and station/read status. Partial hourly-derived daily rows remain flagged as daily gaps until a complete aggregate or official daily record exists. Existing `midData.dailyStatus` continues to describe forecast coverage; historical observation rows do not require forecast AM/PM text. Stored provenance and contributed field names remain available on recovered observations. The public 41-slot three-hour series and the client's eight-slot comparison offset remain unchanged, as AK confirmed; the visible hourly view does not expand to seven days.

[Recovery diagram](diagrams/historical-observations.html) · [Operator/test contract](../../reports/sdlc/issue-2564/operator-contract.md). Isolated local tests cover real Mongo/loopback HTTP plus actual route and shared client parsers; native mobile runtime and production recovery are separate operator checks.

Actual-data browser validation found that legacy charts print negative rain sentinels as `-1mm`. Final hourly response projection now omits invalid rain fields on rows carrying historical recovery provenance, after internal aggregation/unit conversion; valid zero/measured rain and unrelated rows are preserved. No client update is required for this correction. Internal sentinels remain unchanged, and `historyStatus` still reports missing fields.

## Fresh station observations in current weather (#2573)

`getKmaStnMinuteWeather` no longer depends on recent hourly station rows. When `findHourlies2` finds none, `getStnHourlyAndMinRns` marks `hourlyMissing` and still reads minute observations. If the station observation is newer than `currentPubDate`, `t1h`, `reh`, `vec` and `wsd` are replaced by values that pass `_isValidObservation` range checks. Older observations only fill missing or sentinel values, as before. `rn1`, cloud and weather handling are unchanged. The API values before the merge remain in `current.dongnae`, and `liveTime` carries the observation time. This path has no feature flag. Cached responses add delay: the CloudFront default behavior (300–600 s) for direct `/v000903/kma/...` requests, and the weather Lambda's `max-age=300` for the app's `/weather/*` path. See the [operator runbook](../operations/kma-station-observations.md).
