# Client data contracts

## Evidence and interpretation

This document describes the checked-in Angular/Ionic client at `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected on 2026-09-23. It records what code sends and consumes, not an enforced API schema or a verified live response. Fields are conditional unless a consumer explicitly assumes them. Provider fields can coexist with display aliases; extra fields are not rejected.

Read alongside [client state and behavior](client-state-and-behavior.md), [server response assembly](server-response-assembly.md), and the [existing API/deployment boundary analysis](../architecture/mobile-api.md). A local Express server is not by itself the public weather/geocode gateway. Historical gateway observations are timestamped in the architecture documents; no production request was made for this reference.

## Request surface

All application paths append to `clientConfig.serverUrl`. The checked-in configuration uses `https://localhost`; [Gulp product tasks](../../client/gulpfile.js) replace that file from external release configuration. Do not infer the deployed base URL from a screenshot harness.

| Feature | Method and appended path | Input and response consumed |
| --- | --- | --- |
| Coordinate geocode | `GET /geocode/v000903/coord/:lat,:long` | Coordinates in latitude, longitude order; response body is a geoInfo object |
| Address geocode | `GET /geocode/v000903/addr/:address` | Free-form address string; response body is a geoInfo object |
| Main weather | `GET /weather/v000903/coord/:lat,:long` | Preferred when `geoInfo.location.lat` is truthy; returns KMA or world body |
| Address fallback | `GET /weather/v000903/addr/:address` | Selected only when town parsing yields all-empty components; deployed handler was observed returning 501 in the earlier AWS inspection |
| Legacy Korean address | `GET /v000903/kma/addr/:first[/:second[/:third]]` | Address-only saved locations can take this route after prefixing `대한민국` and extracting town components |
| National overview | `GET /v000903/nation/:nationCode` | `Util.region`; response consumed as `{weather: [...], air: [...]}` |
| Weather warnings | `GET /v000903/kma/special` | Response is an array of warning objects; separate direct `$http` call, 3-second timeout |
| Push settings list | `POST /v000902/push-list` | Array of registration objects; success body is not used to reconcile local settings |
| Push deletion/token refresh | `DELETE /v000902/push`; `PUT /v000902/push` | Deletion identity object or old/new token pair |
| Receipt validation | `POST /v000705/check-purchase` or purchase-plugin validator at this URL | Receipt envelope for the iOS build variant; plugin-specific request for j3k0 variant |

The builders concatenate path strings rather than explicitly encoding each address segment. Latitude `0` fails the truthiness check and can fall into the address/error path. The address fallback is designed around Korean legacy locations, not arbitrary global addresses. Sources: [WeatherUtil builders and getWeatherByGeoInfo](../../client/www/js/service.weatherutil.js), [warnings](../../client/www/js/controller.kma.special.js), [push](../../client/www/js/service.push.js), [purchase variants](../../client/www/js/controller.purchase.alexdisler.js).

### Units, query strings, and headers

Weather and national requests append all six values from `Units.getAllUnits()`, then `airForecastSource=kaq`. Geocode requests do not append these parameters. `_retryGetHttp` explicitly provides only method, URL, and timeout; it does not explicitly attach language or device headers. Browser/framework defaults are a separate concern. Push POST explicitly sends `Content-Type: application/json`, `Accept-Language: Util.language`, and `Device-Id: Util.uuid`; push PUT/DELETE and the alexdisler purchase POST send content type and device ID, without that explicit language header.

| Query key | Choices presented by this client | Meaning |
| --- | --- | --- |
| `temperatureUnit` | `C`, `F` | Temperature aliases such as `t1h`, `t3h`, `tmn`, `tmx` |
| `windSpeedUnit` | `m/s`, `km/h`, `mph`, `bft`, `kt` | `wsd` and matching UI labels |
| `pressureUnit` | `hPa`, `mmHg`, `inHg`, `mb` | Value remains named `hPa` even in another requested pressure unit |
| `distanceUnit` | `km`, `mi` | Visibility |
| `precipitationUnit` | `mm`, `in` | Precipitation aliases; see conversion anomaly below |
| `airUnit` | `airkorea`, `airkorea_who`, `airnow`, `aqicn` | Grade/index standard; not a universal pollutant concentration unit |
| `airForecastSource` | client hardcodes `kaq` | Air forecast source selection |

KR defaults are C/m/s/hPa/km/mm/airkorea; US defaults are F/mph/inHg/mi/in/airnow. JP, DE, CN and TW have explicit variations; all other regions use the base weather units with airnow. Legacy saved `aircn` is replaced with the region's default. Server query middleware fills absent or literal `(null)` unit values; this is not proof of full validation of unsupported values. Sources: [Units](../../client/www/js/controller.units.js), [KMA units](../../server/controllers/controllerTown24h.js), [world units](../../server/controllers/worldWeather/controller.ww.units.js).

`convertWeatherData` logs `response.units`, but does not copy it into the normalized city. Screens label values using mutable `Units` state. A rewrite should bind values, request units and response units together, especially when settings change while a request is in flight.

## Geographic object

| Field | Observed consumed type | Use and caveat |
| --- | --- | --- |
| `location` | `{lat: number, long: number}` | Requests, favorites, push registration; not a Mongo `[longitude, latitude]` array |
| `address` | string | Address fallback, deduplication/display fallback; forecast rendering expects a non-null city address |
| `name` | string, optional | Preferred screen title; user search may replace the provider name |
| `country` | string, commonly `KR` etc. | Carried into city and widget preferences |
| `currentPosition` | boolean, client state | Identifies the special current-location city; not required from geocoding |
| `description` | string, search presentation | Temporary autocomplete/search display field |

**Coordinate boundary:** `{lat,long}` is the app/geocode shape. The direct DSF backend constructs `{lat,lon}` in `mergeDsfDailyData`. The weather Lambda source inspected on 2026-09-20 calls `importGeoInfo` after receiving backend weather, replacing location with `{lat:loc[0],long:loc[1]}`. This is a timestamped source observation, not a live payload capture. The Angular converter copies location verbatim, so bypassing that gateway requires an explicit `lon`→`long` adapter; otherwise current-position/favorite updates may retain a shape the URL builder cannot use. Sources: [direct DSF assembly](../../server/controllers/worldWeather/controllerWorldWeather.js), [deployed weather/geocode excerpts](../architecture/deployed-lambda-excerpts.md).

Geocode wrappers resolve the response body directly, not an array. Google Places autocomplete is loaded separately through `Util.placesUrl`; it is not the application's `/geocode` endpoint. Search accepts bundled Korean town entries (`first`, `second`, `third`, `lat`, `long`), Google predictions (`terms`, `matched_substrings`, `description`), or an already resolved geoInfo. Selection obtains weather before persisting the city. Sources: [SearchCtrl](../../client/www/js/controller.searchctrl.js), [WeatherUtil](../../client/www/js/service.weatherutil.js).

## Weather response envelopes

`getWeatherByGeoInfo()` resolves `$q.all([_getHttp(url)])`, hence the converter accepts an array like `[{"data": <response body>}]`. If multiple elements contain `data`, the last body wins; the client does not merge providers there. Exactly `source === "KMA"` selects KMA parsing; every other body takes world parsing. A successful HTTP status is not schema validation.

| Body field | KMA | World/DSF | Consumer behavior |
| --- | --- | --- | --- |
| Source discriminator | `source: "KMA"` | Any non-KMA source takes world parser; `pubDate.DSF` presence sets normalized source `DSF` | Unsupported source is not explicitly rejected |
| Current observation | `current: object` | `thisTime: [yesterday, current]` | KMA current is used by reference; world index 1 gets `.yesterday = index 0` |
| Time series | `short: object[]` | `hourly: object[]` | Both use an eight-record historical alignment offset |
| Daily series | `midData.dailyData: object[]` | `daily: object[]` | Row `fromToday == 0` becomes currentWeather.today and gets `.index` |
| Air | optional `airInfoList` or `airInfo` | optional `airInfoList` or `airInfo` | Copied directly, not deeply validated |
| Geographic enrichment | optional `name`, `address`, `country`, `location` | same | Copied if own property exists |
| Units | `units: object` | `units: object` when emitted | Logged, then omitted from normalized object |
| Other server output | `shortPubDate`, `shortRssPubDate`, `shortestPubDate`, `currentPubDate`, `shortest`, `dailySummary`, region/city/town names | `pubDate`, timezone and provider fields, `shortest` | Most top-level fields are not explicitly copied by current Angular converter; do not assume widgets/other API consumers also ignore them |

KMA guards missing/invalid short and daily arrays by returning empty arrays; missing current becomes `{}`. World parsing calls `daily.forEach` and accesses `thisTime[1]`, so those structural failures are caught and return `null`. Empty chart arrays can still fail downstream screen assumptions. Sources: [WeatherUtil parsers](../../client/www/js/service.weatherutil.js), [KMA makeResult](../../server/controllers/controllerTown24h.js), [world response handling](../../server/controllers/worldWeather/controllerWorldWeather.js).

### Weather row vocabulary consumed by screens

These are display-oriented aliases after server composition/conversion, not raw provider payloads. `number?` means optional numeric value, not a promise that omission is safely handled everywhere. Synthetic examples intentionally omit fields outside this useful subset.

| Fields | Type and semantics | Principal use |
| --- | --- | --- |
| `date` | string `YYYYMMDD` in converted weather rows | Daily headers and date substring formatting |
| `time` | number hour, including `24` at a converted midnight boundary | Current/hourly graph positions; do not parse as HHMM after conversion |
| `dateObj` | local-wall-time string, typically `YYYY.MM.DD HH:mm` | Date comparisons and daily detail labels; the name does not mean a JavaScript Date instance after JSON |
| `stnDateTime` | optional station/provider datetime string | Preferred visible update timestamp |
| `fromToday` | integer relative local day | Yesterday/current/future selection; computed relative to response current time, not necessarily device date |
| `dayOfWeek` | integer 0–6, Sunday first | Daily labels |
| `currentIndex` | truthy marker on a time row | Converter finds current graph position; not an array index itself |
| `t1h`, `t3h` | number? in requested temperature unit | Current and three-hour-aligned graph temperatures |
| `tmn`, `tmx` | number? in requested temperature unit | Daily chart extrema; KMA also retains provider `taMin`, `taMax` fields, which should not replace converted aliases |
| `skyIcon`, `skyAm`, `skyPm` | lower-case asset-name strings | Current/hourly and AM/PM daily icon filenames; KMA server replaces daily sky fields with icon strings |
| `sky`, `pty`, `lgt`, `weatherType` | numeric codes? | Legacy sky/precipitation/lightning/type information; `weatherType` presence gates current description row |
| `weather`, `wdd` | description/direction strings? | Weather and wind text |
| `pop` | number? percent | Probability of precipitation; many consumers hide zero |
| `reh` | number? percent | Humidity and icon selection |
| `wsd`, `hPa`, `visibility` | number? in selected wind/pressure/distance unit | Current and daily detail cards |
| `rn1`, `r06`, `s06` | number? in selected precipitation unit | Observation/forecast precipitation aliases; their durations differ and world conversion reuses these names |
| `sensorytem`, `dspls`, `dsplsStr` | feels-like number?, discomfort number?/text? | Conditional current detail |
| `summaryWeather`, `summaryAir`, `summary` | strings? | Forecast prefers summaryWeather, falls back to summary; summaryAir is a separate clickable line |
| `yesterday` | current-shaped object? | Temperature difference display |
| Daily `ultrv`, `ultrvGrade`, `ultrvStr`, `fsnGrade`, `fsnStr` | numbers/text? | UV and food-poisoning detail |
| Daily `sunrise`, `sunset` | datetime strings? containing a space | Template displays `split(' ')[1]` |
| Daily `dustForecast` | object with `pm25Grade/Str`, `pm10Grade/Str`, optional `o3Grade/Str` | Older daily air forecast fallback |
| `arpltn` | current air observation object? | Weather-screen air cards and AirCtrl fallback |

Sources: [weather date formatting](../../server/lib/kmaTimeLib.js), [forecast controller](../../client/www/js/controller.forecastctrl.js), [hourly template](../../client/www/templates/tab-forecast.html), [daily template](../../client/www/templates/tab-dailyforecast.html), [D3 chart directives](../../client/www/js/app.js), [KMA convertUnits](../../server/controllers/controllerTown24h.js), [world aliases](../../server/controllers/worldWeather/controller.ww.units.js).

### Missing values, time and units are compatibility rules

- Domestic internal records use `-50` for invalid temperature and `-1` for many other unavailable values. These are handled selectively by server aggregation/conversion; the client parser is not a universal sentinel sanitizer. KMA temperature conversion deliberately skips `-50`. Treat missing, null, sentinel and valid zero as distinct input cases.
- The current templates mix truthiness (`rn1`, `sensorytem`, several air summary cells), `> 0`, and `!= undefined`. A valid zero can disappear in one view but appear in another. Air detail uses numeric `.toFixed()`, so numeric strings are not interchangeable with numbers.
- KMA `convert0Hto24H` runs before response conversion. The final time field can be 24, preserving preceding-day midnight alignment; a rewrite must not silently normalize this away without graph parity tests.
- World DSF data is converted to the location's local time on the server before aliases/relative days are produced. Client graphs consume the converted rows rather than doing a universal timezone conversion. Use explicit timezone/instant/local-date types in a future schema and retain this legacy adapter boundary.
- KMA snow aliases `s06`, `sn1`, `s1d` are multiplied by 10 (cm to mm) before requested-unit conversion. **Source anomaly:** the non-default precipitation branch passes `toWindUnit`, not `toPrecipUnit`, into `convertUnits`. Runtime impact was not exercised here; add a targeted regression before changing it.
- World response aliases deliberately reuse `r06`/`s06` for future `precip` values. The name alone does not establish a six-hour aggregate. Preserve source/period metadata in a replacement model.

## Normalization into screen state

For a time array `rows` of length `N`:

```text
currentWeather = KMA.current OR World.thisTime[1]
currentWeather.yesterday = World.thisTime[0]  (KMA already provides it)
currentWeather.today = daily row where fromToday == 0, with index added

timeTable = rows.slice(8)
timeChart[0] = {name: "yesterday", values: rows.slice(0, N-8).map(row => ({name:"yesterday", value:row}))}
timeChart[1] = {name: "today", values: rows.slice(8).map(row => ({name:"today", value:row})),
                currentIndex: markedRowIndex - 8, displayItemCount: computed}
dayChart = [{values: dailyRows, temp: currentWeather.t1h, displayItemCount: computed}]
```

This is an index-aligned overlay with an eight-sample offset, not grouping rows strictly by `fromToday`. World missing-current-marker fallback is the last hourly row; KMA starts at index -1 and produces -9 after subtraction. World daily rows are deep-copied through JSON; KMA daily/current/time records are reused and mutated. Normalized `dayTable` is not emitted even though WeatherInfo still has a slot for it.

Hourly `displayItemCount` is a maximum count for sky/precipitation display. Its precipitation-amount branch depends on the accumulated count already being 2. Daily count uses flag values 4 (different AM/PM icons), 2 (positive current/future precipitation probability), 1 (positive precipitation amount), then keeps the greatest per-row integer; it is not a bitwise union across all days. These details affect graph height and belong in characterization tests, not a new domain model.

### Synthetic examples

Each file contains an `_example` annotation plus `response` or `normalized`. Annotations are documentation metadata, not fields sent by the production API. Raw examples are **partial synthetic API bodies**, already in the legacy server's client-facing format. They are not provider captures or complete server test fixtures; shortened histories intentionally do not satisfy the server's logged cardinality expectations (KMA short >=33, daily >=17). Values and station identities are invented. The world example models the **public weather envelope after geographic enrichment** documented in the 2026-09-20 deployed Lambda excerpts; it is not the direct DSF backend body. Its location uses `long`, while the direct backend uses `lon`. Weather `dateObj` uses dotted dates; AQI timestamps use hyphens.

| Input | Output generated by checked-in converter | Demonstrates |
| --- | --- | --- |
| [KMA response](examples/client-kma-response.json) | [KMA normalized](examples/client-kma-normalized.json) | current/today/yesterday, eight-record overlay, daily flags, station air payload |
| [World public-envelope example](examples/client-world-response.json) | [World normalized](examples/client-world-normalized.json) | ordered thisTime pair, DSF publication discriminator, gateway-shaped geography |

The normalized files were produced by evaluating only `service.weatherutil.js` in an isolated Node VM with Angular registration and analytics stubs. No application/server startup, network, Cordova, provider, or storage operation was involved. For a consumer test, call `convertWeatherData([{data: structuredClone(example.response)}])`; copying matters because the converter mutates input records.

### Reproduce the saved normalization examples

From the repository root, this command compares both saved normalized outputs with the checked-in converter. It stubs registration/analytics only and fails on any attempted network call.

```sh
node <<'JS'
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
let converter;
const context = {
  angular: {module: () => ({factory: (_name, factory) => {
    converter = factory({}, () => { throw Error('Network disabled'); },
      {ga: {trackEvent() {}, trackException(error) { throw error; }}}, {});
  }})},
  console: {log() {}, info() {}, warn() {}}, clientConfig: {debug: false}
};
vm.runInNewContext(fs.readFileSync('client/www/js/service.weatherutil.js', 'utf8'), context);
for (const source of ['kma', 'world']) {
  const prefix = 'docs/rewrite/examples/client-' + source;
  const input = JSON.parse(fs.readFileSync(prefix + '-response.json')).response;
  const expected = JSON.parse(fs.readFileSync(prefix + '-normalized.json')).normalized;
  const actual = converter.convertWeatherData([{data: input}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
  console.log(source + ': exact normalized JSON match');
}
JS
```

## Air contract and station selection

Weather responses may embed `airInfoList: StationAir[]`, a single `airInfo: StationAir`, and/or `current.arpltn` / `thisTime[1].arpltn`. These shapes are not interchangeable: the first two wrap history/forecast plus a `last` observation; `arpltn` is the observation itself.

| Field | Consumed shape | Notes |
| --- | --- | --- |
| `StationAir.last` | observation object | Preferred latest values; otherwise currentWeather.arpltn |
| Observation `dataTime`, `stationName` | strings? | Update time and station label |
| Observation `<code>Value`, `<code>Grade`, `<code>Str` | number?, 1-based number?, string? | Codes `aqi`, `pm25`, `pm10`, `o3`, `no2`, `co`, `so2`; legacy `khai*` also appears in weather detail |
| Observation `<code>ActionGuide` | string? | Air action guidance |
| Observation `<code>StationName` | string? | Per-pollutant source label in weather details |
| `pollutants` | map keyed by code | Can contain historical-only or forecast-enriched series |
| `pollutants[code].hourly` | `{date: "YYYY-MM-DD HH:mm", val?: number, grade?: number, str?: string, pubDate?: string}[]` | Chart uses date/val/grade. Missing val is allowed for padded points |
| `pollutants[code].daily` | `{date: "YYYY-MM-DD", fromToday: number, dayOfWeek: number, grade?: number, str?: string, ...}[]` | Forecast tiles; server may also emit val/minVal/maxVal/minGrade/maxGrade |
| `forecastPubDate`, `forecastSource` | strings? | Displayed attribution/time for forecast series |

AirCtrl chooses list station 0 initially, can switch station/pollutant, and resets station index on `applyEvent`. It creates 24 chart points using the first hourly index whose date is >= latest `dataTime`, then reads indexes `index-12` through `index+11`; absent points are filled with date-only objects. The nearby source comment describes a different 11/current/12 split; the loop is the observed behavior. If no row meets the comparison, later use of `hourly[-1].date` can fail inside the controller's catch. Daily tiles truncate to four when body width is below 360px.

ForecastCtrl selects the first station's AQI forecast, filters hourly dates >= latest `dataTime`, and shows at most four. Its `else if (cityData.airInfoList)` repeats the first condition, so the intended single-airInfo forecast path does not execute. AirCtrl itself supports airInfo. Older daily dust fallback assumes rows at indexes 7 and 8 in the template. Do not treat absence of forecast tiles as proof the API omitted all air data.

AQI grades depend on the selected standard. PM concentrations display µg/m³; gases display ppm; overall AQI is an index. Client lookup tables supply colors/ranges, and the server supplies the values/grade/text. A rewrite must keep these standards consistent across client, API, widgets and push. Sources: [AirCtrl](../../client/www/js/controller.air.js), [air template](../../client/www/templates/tab-air.html), [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [AQI chart and standards setup](../../client/www/js/controller.tabctrl.js).

## Secondary response contracts

### National overview and warnings

`NationCtrl` consumes `response.weather[]`: regional identity fields (`regionName`, `cityName`, `townName`) plus `current.skyIcon`, `current.t1h`, `current.rn1`, `current.wdd`, `current.wsd`. It finds a static Korean map city by substring in the concatenated region/city/town, not a stable city ID. `NationAirCtrl` consumes `response.air[]`: `sidoName` and pollutant Value/Grade fields. Both fetch the same nation endpoint with units. The maps' positions and names are hardcoded Korean lists even though the requested nation is `Util.region`; JP's display-name branch returns the China translation key. These are implementation constraints, not guaranteed international map support.

Warnings consume `[{name, announcement, imageUrl, type, comment, situationList?}]`, where `situationList[]` has `weatherStr`, `levelStr`, and `info[]` with `timeStr`, `location`. The controller localizes `announcement` through `Date`, replaces comment newlines with `<br>`, and the template uses `ng-bind-html`. A future renderer needs an explicit trusted-content/sanitization policy. Sources: [national weather](../../client/www/js/controller.nation.js), [national air](../../client/www/js/controller.nation.air.js), [warning controller](../../client/www/js/controller.kma.special.js), [warning template](../../client/www/templates/kma-special.html).

### Push/settings request objects

`_makePostObj()` produces one object per alarm/alert:

- Common: `type` (`ios`/`android`), numeric `cityIndex` and `id`, `category` (`alarm`/`alert`), boolean `enable`, `name`, optional `location:{lat,long}` and Korean `town:{first,second,third}`, `source`, `units` including `airForecastSource:'kaq'`, `timezoneOffset` in minutes east of UTC, `package`, `uuid`, `appVersion`, optional registrationId/fcmToken.
- Alarm: `pushTime` is seconds since **UTC** midnight computed from the selected local Date; `dayOfWeek` is a seven-boolean array (Sunday first in UI).
- Alert: `startTime` and `endTime` are UTC seconds-of-day; equal endpoints are changed so end is one minute before start. `airAlertsBreakPoint` is 3 for airkorea/airkorea_who, otherwise 4.
- Token update: `{newToken,oldToken}` for FCM, or `{newRegId,oldRegId}` legacy registration IDs. DELETE sends the identity object assembled by its caller.

The client does not POST a list when fcmToken is absent/empty, even if a legacy registrationId exists. The operation is one-way synchronization: success/error logging does not reconcile server state or roll back local settings. Timezone offset is device offset at submission, not a timezone identifier or necessarily the selected city's zone. See [Push service](../../client/www/js/service.push.js), [Push settings UI](../../client/www/js/controller.push.js), and [push architecture](../architecture/push-notifications.md).

Startup page, refresh interval, theme and units are otherwise local/native-preference settings; there is no general settings REST endpoint in these controllers. Unit changes repost push registrations.

### Purchase variants

The checked-in `controller.purchase.js` uses the `store`/j3k0 interface; iOS Gulp tasks copy `controller.purchase.alexdisler.js` over it. Documenting only the checked-in selected file would misdescribe an iOS build.

The alexdisler implementation sends `{type:'ios', id:'tw1year'|'ta1year', receipt:<plugin receipt>}` or its Android variant `{type:'android', id, receipt:[<purchase records>]}` as JSON, timeout 10 seconds. It consumes `{ok:boolean, data:{expires_date?, message?, ...}}`: success updates premium entitlement and expiry; invalid response uses the message and may downgrade entitlement. The `store` implementation assigns `store.validator` to the same endpoint and lets the plugin form requests; its verify callback consumes `data.expires_date`. Do not invent a stable plugin wire envelope without inspecting the installed plugin version.

Local entitlement is `{accountLevel:'free'|'premium'|'paid', expirationDate:<Date-parseable value>}`. Expired stored purchases become free; paid app configuration disables ads separately. Store receipts, device IDs and tokens are sensitive operational data and are intentionally absent from these examples. Sources: [iOS variant](../../client/www/js/controller.purchase.alexdisler.js), [j3k0 variant](../../client/www/js/controller.purchase.j3k0.js), [build selection](../../client/gulpfile.js), [server receipt adapter](../../server/routes/v000705/receiptValidation.js).

## Contract test priorities for a rewrite

1. KMA and world inputs normalize into equivalent view models while preserving source, units, geography and time provenance.
2. Current/today/yesterday pairing, three-hour alignment, local midnight 24, empty/missing history, missing current marker, and DST-sensitive world dates.
3. Zero versus missing/sentinel values, numeric strings rejected or explicitly converted, invalid icon names, absent air station/forecast, AQI series with no anchor date.
4. Unit changes during an in-flight response; precipitation/snow conversion; client labels match stored value units.
5. Address-only legacy favorites, equator coordinates, unicode addresses and path encoding; separate public gateway and direct backend adapters.
6. Push UTC/local semantics, overnight alert range, missing token, local save versus server failure, and native receipt variants.

These are characterization and design requirements, not claims that new automated tests or a live end-to-end suite already exist.
