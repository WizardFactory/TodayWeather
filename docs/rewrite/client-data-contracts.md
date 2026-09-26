# Client data contracts

## Evidence and interpretation

This document describes the checked-in Angular/Ionic client at `bd6640f2` (re-baselined 2026-09-25). `client/` is identical to `ff7acf3996ccb66c912d2ed4710cf300197d6966`, where it was inspected on 2026-09-23. Server statements were rechecked against `bd6640f2`; upstream server changes that reach clients are in [domestic response additions](#domestic-response-additions-at-bd6640f2) and [inbound notification payload](#inbound-notification-payload). It records what code sends and consumes, not an enforced API schema or a verified live response. Fields are conditional unless a consumer explicitly assumes them. Provider fields can coexist with display aliases; extra fields are not rejected.

Sections on geography precedence, language negotiation, the photo feed, inbound notifications, app entry links and bundled/device-derived inputs were added on 2026-09-24 against `ff7acf39`. Synthetic executions and captures keep their original dates and that commit; the client code they exercised is unchanged at `bd6640f2`. They are **observed source** unless a statement names a synthetic execution (Node VM run, harness probe or simulator capture); deployed gateway behavior is **historical deployment** evidence from the 2026-09-20 excerpts.

Read alongside [client state and behavior](client-state-and-behavior.md), [server response assembly](server-response-assembly.md), and the [existing API/deployment boundary analysis](../architecture/mobile-api.md). A local Express server is not by itself the public weather/geocode gateway. Historical gateway observations are timestamped in the architecture documents; no production request was made for this reference.

## Request surface

All application paths except the weather photo feed append to `clientConfig.serverUrl`. The checked-in configuration uses `https://localhost`; [Gulp product tasks](../../client/gulpfile.js) replace that file from external release configuration. Do not infer the deployed base URL from a screenshot harness.

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
| Weather photos | `GET clientConfig.weatherPhotosUrl` (absolute URL from external release configuration; `''` in the checkout), 20 s per attempt through `_getHttp` | JSON array of `{tags: string[], twUrls: {regular: url}}`; see [Weather photo feed](#weather-photo-feed) |

The builders concatenate path strings rather than explicitly encoding each address segment. Latitude `0` fails the truthiness check and can fall into the address/error path. The address fallback is designed around Korean legacy locations, not arbitrary global addresses. Sources: [WeatherUtil builders and getWeatherByGeoInfo](../../client/www/js/service.weatherutil.js), [warnings](../../client/www/js/controller.kma.special.js), [push](../../client/www/js/service.push.js), [purchase variants](../../client/www/js/controller.purchase.alexdisler.js).

The static web PWA in `web/`, added upstream at `bd6640f2`, is a separate consumer. It calls only the coordinate weather, both geocode, national overview and warning paths above. It sends canonical units and a fixed `Accept-Language: ko`, and it normalizes bodies with its own adapter. Its requests and field reads are in [native consumers §5](native-consumers-and-plugins.md#5-non-native-consumer-web-pwa-web). Nothing in this document describes the PWA unless it says so.

### Units, query strings, and headers

Weather and national requests append all six values from `Units.getAllUnits()`, then `airForecastSource=kaq`. Geocode requests do not append these parameters. `_retryGetHttp` explicitly provides only method, URL, and timeout; it does not explicitly attach language or device headers. Any default `Accept-Language` the WebView attaches still reaches the gateway and decides the language of server text and geocode names; see [Language negotiation](#language-negotiation). Push POST explicitly sends `Content-Type: application/json`, `Accept-Language: Util.language`, and `Device-Id: Util.uuid`; push PUT/DELETE and the alexdisler purchase POST send content type and device ID, without that explicit language header.

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

### Language negotiation

The client uses three independent language sources: an implicit WebView `Accept-Language` on its GETs, `Util.language` for the push list POST, and `$translate` for UI strings.

| Surface | Value the client sends | Transformation in source | Affected data |
| --- | --- | --- | --- |
| Weather GET (`/weather/v000903/...`) | No explicit header; `_retryGetHttp` sets only method, URL and timeout ([L29](../../client/www/js/service.weatherutil.js#L29)), so only a WebView default `Accept-Language`, if any, is sent (header value not captured for this reference) | Historical deployment (2026-09-20 [weather Lambda excerpt](../architecture/deployed-lambda-excerpts.md)): `_getLanguage` keeps the text before the first `-` of the header (`ko` from `ko-KR,…`; a header without `-` passes through whole), uses `en` when the header is absent, and forwards that value as `Accept-Language` to the backend. Backend `i18n` is configured with locales `en, ko, ja, zh-CN, de, zh-TW` and is applied per request ([server/app.js](../../server/app.js#L63-L96)) | Server prose localized with the request translator. KMA: `weather` ([controllerTown.js](../../server/controllers/controllerTown.js#L1911)), strings from `insertStrForData` ([L3295-L3299](../../server/controllers/controllerTown.js#L3295-L3299)), `summaryAir` ([controllerTown24h.js](../../server/controllers/controllerTown24h.js#L1373-L1383)). World: `desc` copied to `weather` ([controllerWorldWeather.js](../../server/controllers/worldWeather/controllerWorldWeather.js#L2837-L2850), [ww units](../../server/controllers/worldWeather/controller.ww.units.js#L43)), `summaryWeather`/`summaryAir`/`summary` ([ww units](../../server/controllers/worldWeather/controller.ww.units.js#L94-L96)), air `*Str` and `<code>ActionGuide` ([controllerWorldWeather.js](../../server/controllers/worldWeather/controllerWorldWeather.js#L2027-L2122)). Also the gateway-added `name`/`address` |
| National overview and warning GETs | Same implicit header | These paths use the default CloudFront behavior to the service host, not the weather Lambda ([AWS/code correlation](../architecture/aws-code-correlation.md)). The 2026-09-20 configuration of that behavior forwards `Origin` and `Accept-Language` ([evidence JSON](../architecture/aws-readonly-evidence-2026-09-20.json)), so the header reaches Express `i18n.init` without the Lambda's truncation | Warning `name`, a localized label derived from `type` ([controller](../../server/controllers/kma.specialweather.controller.js#L49-L61)); other request-localized text in these bodies was not enumerated |
| Geocode GET (`/geocode/v000903/...`) | Same implicit header | Deployed geocoder `_getLanguage` uses the same first-`-` rule and `en` default. Coordinate cache/provider lookups are keyed by coordinate **and** language; address lookups are keyed by the address string only | `name`, `address`; persisted into `cities[]` and shown as titles, so a stored name keeps the language in effect when it was geocoded |
| Push list POST | Explicit `Accept-Language: Util.language` (`navigator.userLanguage || navigator.language`) | Server route keeps the first comma-separated tag; when that tag contains `ko`, `en`, `ja` or `de` it is cut to its first two characters, otherwise kept as is; absent or empty → `en` ([route](../../server/routes/v000902/route.push.update.list.js#L75-L100)). Stored as `pushInfo.lang` ([L22](../../server/routes/v000902/route.push.update.list.js#L22)) | Notification title/body language |
| UI strings | None (local) | `$translate` `determinePreferredLanguage()` with keys `en, de, ko, ja, zh-CN, zh-TW`, aliases `en_*`, `de_*`, `ko_*`, `ja_*`, `zh_HK`/`zh_TW` → `zh-TW`, `zh_*` → `zh-CN`, fallback `en` ([app.js](../../client/www/js/app.js#L422-L439)) | Bundled `LOC_*` strings |

Per the 2026-09-20 gateway source, a native client that omits `Accept-Language` on weather/geocode requests therefore receives `en` prose and `en` coordinate-geocode names, even for Korean users. **Unverified:** how the gateway value `zh` (from `zh-TW`/`zh-CN`) maps onto the backend `zh-CN`/`zh-TW` locales; the `i18n` module (`^0.8.3` in [server/package.json](../../server/package.json), locked to 0.8.3 by the `server/package-lock.json` added upstream in `c80ee014`) is not installed in the checkout. Backend `i18n` also accepts a `twcookie` cookie; the client does not set it, and no CloudFront behavior in the 2026-09-20 configuration forwards cookies.

Locale lists per surface, key counts and key-set parity are in the [localization inventory](localization-inventory.md).

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

Geocode wrappers resolve the response body directly, not an array. Google Places autocomplete is loaded separately through `Util.placesUrl`; it is not the application's `/geocode` endpoint. Search accepts bundled Korean town entries (`first`, `second`, `third`, `lat`, `long`; see [bundled inputs](#bundled-and-device-derived-inputs)), Google predictions (`terms`, `matched_substrings`, `description`), or an already resolved geoInfo. Selection obtains weather before persisting the city. Sources: [SearchCtrl](../../client/www/js/controller.searchctrl.js), [WeatherUtil](../../client/www/js/service.weatherutil.js).

### Geography sources and precedence

`name`, `address`, `country` and `location` reach a stored city by different routes. `convertWeatherData` copies them from a weather body only when they are own properties ([L677-L682](../../client/www/js/service.weatherutil.js#L677-L682)); `WeatherInfo.updateCity` then applies them only to the current-position city and only when truthy ([L237-L260](../../client/www/js/service.weatherinfo.js#L237-L260)).

| Flow | `/geocode` call | Source of `name` / `address` / `country` / `location` | Write path |
| --- | --- | --- | --- |
| Search: bundled `town.js` entry | None | Built client-side (rule below); `country:'KR'`; `location` from the entry | `saveCity` overwrites the weather-body geography, then `addCity` |
| Start: bundled world-city tile | None | Hard-coded `{name, country, address, location}` list ([`_makeFavoriteList`](../../client/www/js/controller.start.js#L145-L198)) | `saveCity` → `addCity` |
| Start or Search: Google prediction | `/geocode/v000903/addr/…`. Start sends `description`; Search sends `terms` sorted by `offset` and joined with `Array.toString` (commas, no spaces), falling back to `description` ([`_makeQueryString`](../../client/www/js/controller.searchctrl.js#L332-L353)) | Geocode body, then `name` is replaced by the prediction-derived name (rule below) | `saveCity` → `addCity` |
| Search: current-position search row | `/geocode/v000903/coord/…` | Geocode body; the row shows `address` as `description`, and the search input (initially the geocoded `name`) becomes `name` ([L241-L266](../../client/www/js/controller.searchctrl.js#L241-L266)) | Added as an ordinary favorite with `currentPosition:false` through the "from geoinfo server" branch ([L488-L507](../../client/www/js/controller.searchctrl.js#L488-L507)) |
| Start: use current location | `/geocode/v000903/coord/…` | Geocode body | `disableCity(false)` (which selects slot 0 only when the index is ≤ 0, [service.weatherinfo.js](../../client/www/js/service.weatherinfo.js#L181-L190)), then `saveCity(…, true)` → `updateCity(getCityIndex(), city)`; truthy fields only ([L582-L610](../../client/www/js/controller.start.js#L582-L610), [L632-L652](../../client/www/js/controller.start.js#L632-L652)) |
| Search: first enable of the current-position row (`t1h === '-'`) | `/geocode/v000903/coord/…` | `updateCity(0, geoInfo)` stores truthy geocode fields; weather is then requested with those stored values, and stored geography overwrites the weather body ([L526-L577](../../client/www/js/controller.searchctrl.js#L526-L577)) | `updateCity` twice |
| Search: list refresh of an enabled current-position city | `/geocode/v000903/coord/…`, result **discarded** (`updateCity` is commented out, [L169-L177](../../client/www/js/controller.searchctrl.js#L169-L177)) | Weather is requested with the **old stored location**; stored geography overwrites the weather body ([L887-L916](../../client/www/js/controller.searchctrl.js#L887-L916)) | `updateCity` |
| TabCtrl refresh: current position | None | First request uses the stored city. When the device fix (rounded to 3 decimals) differs from the stored location, `cities[0].location` is mutated in memory even if another city is selected by then; only while index 0 is still selected is a second request sent with `{location}` only (also when no location was stored); `name`/`address`/`country`/`location` then come from the **weather body** when truthy ([L953-L997](../../client/www/js/controller.tabctrl.js#L953-L997), [L1179-L1199](../../client/www/js/controller.tabctrl.js#L1179-L1199)) | `updateCity(getCityIndex(), city)` |
| TabCtrl refresh: favorite | None | Weather-body geography ignored, except that a missing `location.lat` is repaired | `updateCity` |

StartCtrl's `OnSelectResult` also contains the town-entry and "from geoinfo server" branches ([L260-L374](../../client/www/js/controller.start.js#L260-L374)), but its search only fills `searchResults2` with Google predictions ([L74-L122](../../client/www/js/controller.start.js#L74-L122)) and `start.html` lists only those plus the world-city tiles, so both branches are unreachable from S01.

**Contract consequence:** the public weather envelope must carry `name`, `address` and `location:{lat,long}` for current-position refresh. If a replacement API omits them, a moved user keeps the previous place name while the in-memory location already points at the new coordinates, and a current-position city whose `address` is still `null` is never rendered because ForecastCtrl returns early on `address === null` ([L341-L349](../../client/www/js/controller.forecastctrl.js#L341-L349)).

**Display name.** ForecastCtrl (S03/S04), AirCtrl (S05) and the push settings screen (S09) show `name || getShortenAddress(address)` ([ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L354), [AirCtrl](../../client/www/js/controller.air.js#L206), [PushCtrl](../../client/www/js/controller.push.js#L27)). The Search list shows `[name]` or the comma-separated parts of `getShortenAddress(address)` (one or two lines); a current-position entry with `address === null` shows `LOC_CURRENT` + `LOC_LOCATION` (no space when `Util.language` contains `ko`, `ja`, `zh-CN` or the source's literal `zh-TU`, so `zh-TW` gets a space, [L105-L127](../../client/www/js/controller.searchctrl.js#L105-L127)). Share text uses `name`, else the shortened address.

**Town-entry construction** ([Search](../../client/www/js/controller.searchctrl.js#L373-L401); identical unreachable copy in [Start](../../client/www/js/controller.start.js#L260-L288)): `address = '대한민국 ' + first`; a non-empty `second` is appended, except that when `first` ends with `도` and `second` ends with `구`, `second` is split after its first `시` (`고양시덕양구` → `고양시 덕양구`); a non-empty `third` is appended. `name = third || second || first` (the typed word assigned to `result.name` is not used). The branch for a `second` containing a space overwrites `address` with `' ' + aTemp[1]` ([Start L267-L272](../../client/www/js/controller.start.js#L267-L272), [Search L380-L385](../../client/www/js/controller.searchctrl.js#L380-L385)); it is **dead with bundled data**: all 566 entries whose `first` ends with `도` and `second` with `구` use the concatenated form, none contains a space, and all contain `시`, so the split never sees `indexOf('시') === -1` (bundled data evaluated in Node on 2026-09-24).

**Google name rule** ([Start](../../client/www/js/controller.start.js#L321-L336), [Search](../../client/www/js/controller.searchctrl.js#L436-L466)): `name` starts as the typed search word and is replaced by the first `terms[i].value` whose `offset` equals `matched_substrings[0].offset`. After `/geocode/addr` resolves, this name overwrites the geocoder's `name`.

**Korean address tokens.** `getShortenAddress` splits its string on single spaces; `getTownFromFullAddress` receives the array from `convertAddressArray`, the same split. Token 0 is the nation. `short()` below is `_getShortSiDoName`: when a token ends with `특별시`, `광역시` or `특별자치시` that suffix becomes `시`; `특별자치도` becomes `도` ([L712-L842](../../client/www/js/service.weatherutil.js#L712-L842)).

| Tokens | `getShortenAddress` (display, comma-separated) | `getTownFromFullAddress` (`{first, second, third}`) |
| --- | --- | --- |
| 2 | `short(t1)` | `{t1, '', ''}` |
| 3 | `short(t1) + ',' + t2` | `t2` ends with `읍`/`면`/`동`: `{t1, t1, t2}`; otherwise `{t1, t2, ''}` |
| 4 | `t1` ends with `도`: `short(t2) + ',' + t3`; otherwise `short(t1) + ',' + t3` | `t3` ends with `구`: `{t1, t2+t3, ''}`; otherwise `{t1, t2, t3}` |
| 5 | `short(t2) + ',' + t4` | `{t1, t2+t3, t4}` |
| Other counts (0, 1, 6+) | `''` | all empty |

The town result builds the legacy address-only weather route (`/v000903/kma/addr/...`, after prefixing `대한민국 ` when absent; all-empty components select `/weather/v000903/addr/...` instead, [getWeatherByGeoInfo](../../client/www/js/service.weatherutil.js#L205-L244)) and the push `town` field for KMA-source cities ([`_getSimpleCityInfo`](../../client/www/js/service.push.js#L475-L524)). Worked examples, computed on 2026-09-24 by running the checked-in helpers in the Node VM used for the normalization check below, with the Search town-entry lines ([L375-L401](../../client/www/js/controller.searchctrl.js#L375-L401)) evaluated verbatim:

| Input | Built address / name | `getShortenAddress` | `getTownFromFullAddress` |
| --- | --- | --- | --- |
| `town.js` `{경기도, 고양시덕양구, 고양동}` | `대한민국 경기도 고양시 덕양구 고양동` / `고양동` | `고양시,고양동` | `{경기도, 고양시덕양구, 고양동}` |
| `town.js` `{세종특별자치시, 세종특별자치시, 금남면}` | `대한민국 세종특별자치시 세종특별자치시 금남면` / `금남면` | `세종시,금남면` | `{세종특별자치시, 세종특별자치시, 금남면}` |
| Address `대한민국 경기도 광주시 오포읍` | n/a | `광주시,오포읍` | `{경기도, 광주시, 오포읍}` |
| Address `Tokyo, Japan`, no `name` | n/a | `Japan` | `{Japan, '', ''}`; an address-only weather request first prefixes `대한민국 `, giving `{'Tokyo,', 'Japan', ''}` and the Korean legacy route |
| Address `대한민국 제주특별자치도 제주시 애월읍 애월리 1` (6 tokens) | n/a | `''` (display falls back to `name`, else blank) | all empty, so an address-only weather request takes `/weather/v000903/addr/...` |

**Geocode response** (historical deployment, [geocoder excerpt](../architecture/deployed-lambda-excerpts.md)): `/coord` returns `{name (from provider label), country, address, location:{lat: loc[0], long: loc[1]}, kmaAddress?: {name1, name2, name3}}`; `/addr` returns the same without `kmaAddress`. Every field is conditional on the provider/cache record. The Angular client never reads `kmaAddress`; the weather Lambda uses it to build the KMA backend path. Synthetic example: [client-geocode-coord-response.json](examples/client-geocode-coord-response.json). Name/address language follows [language negotiation](#language-negotiation).

## Weather response envelopes

`getWeatherByGeoInfo()` resolves `$q.all([_getHttp(url)])`, hence the converter accepts an array like `[{"data": <response body>}]`. If multiple elements contain `data`, the last body wins; the client does not merge providers there. Exactly `source === "KMA"` selects KMA parsing; every other body takes world parsing. A successful HTTP status is not schema validation.

| Body field | KMA | World (DSF-named routes) | Consumer behavior |
| --- | --- | --- | --- |
| Source discriminator | `source: "KMA"` | Server sends `source: "VC"` with `pubDate.VC` since #2585 (formerly `DSF`/`pubDate.DSF`). Any non-KMA source takes world parser; current apps set normalized source `VC` when `pubDate.VC` exists; released apps look for `pubDate.DSF` and so leave it unset | Unsupported source is not explicitly rejected |
| Current observation | `current: object` | `thisTime: [yesterday, current]` | KMA current is used by reference; world index 1 gets `.yesterday = index 0` |
| Time series | `short: object[]` | `hourly: object[]` | Both use an eight-record historical alignment offset |
| Daily series | `midData.dailyData: object[]` | `daily: object[]` | Row `fromToday == 0` becomes currentWeather.today and gets `.index` |
| Air | optional `airInfoList` or `airInfo` | optional `airInfoList` or `airInfo` | Copied directly, not deeply validated |
| Geographic enrichment | optional `name`, `address`, `country`, `location` | same | Copied if own property exists; load-bearing for current-position refresh, see [Geography sources and precedence](#geography-sources-and-precedence) |
| Units | `units: object` | `units: object` when emitted | Logged, then omitted from normalized object |
| Other server output | `shortPubDate`, `shortRssPubDate`, `shortestPubDate`, `currentPubDate`, `shortest`, `dailySummary`, region/city/town names; at `bd6640f2` also `historyStatus` and `midData.dailyStatus` ([additions](#domestic-response-additions-at-bd6640f2)) | `pubDate`, timezone and provider fields, `shortest` | Most top-level fields are not explicitly copied by current Angular converter; do not assume widgets/other API consumers also ignore them |

KMA guards missing/invalid short and daily arrays by returning empty arrays; missing current becomes `{}`. World parsing calls `daily.forEach` and accesses `thisTime[1]`, so those structural failures are caught and return `null`. Empty chart arrays can still fail downstream screen assumptions. Sources: [WeatherUtil parsers](../../client/www/js/service.weatherutil.js), [KMA makeResult](../../server/controllers/controllerTown24h.js), [world response handling](../../server/controllers/worldWeather/controllerWorldWeather.js).

### Domestic response additions at bd6640f2

Upstream commits `95fe711e` and `49afbbea` (daily forecast validity, #2560) and `2116c6bf` (ASOS history, #2564) changed the KMA body. This includes `/v000903/kma/addr`, which the gateway serves for `/weather/v000903/coord`. Server behavior and rationale are in [daily forecast validity](../architecture/mobile-api.md#daily-forecast-validity-issue-2560) and [historical observation composition](../architecture/mobile-api.md#historical-observation-composition-2564). The client column is source reading of the unchanged `client/www`, plus the synthetic execution below.

| Change | When present | Shape | Cordova client (`client/www`) |
| --- | --- | --- | --- |
| Top-level `historyStatus` | Only with `ASOS_HISTORY_READ_ENABLED=true`, and only on chains that run `mergeCurrentByStnHourly` and `makeResult`: v000803 town, v000803 geo (KR) and v000901–v000903 KMA ([makeResult](../../server/controllers/controllerTown24h.js#L1614), [history load](../../server/controllers/controllerTown.js#L1296-L1303), [status](../../server/lib/history/service.js#L70-L76)) | `{startDate, endDate, timeZone: 'Asia/Seoul', missingHourlySlots: ['YYYYMMDDHHMM'], missingDailyDates: ['YYYYMMDD'], hourlyFieldGaps: [{key, fields}], mapping?, reason?}` for D-7..D-1. `mapping` is `{stationId, stationName, distanceKm, method}`, and `reason` names a read failure such as `stations-unconfigured` ([policy.js#L252-L287](../../server/lib/history/policy.js#L252-L287), [L288-L328](../../server/lib/history/policy.js#L288-L328)) | **Ignored.** No reference in `client/www`. `convertWeatherData` copies only the fields in the envelope table above |
| `short[]` passed through `hourlyResponse` | Every KMA body that sends `short`; only rows carrying `historyObservation` change ([policy.js#L163-L180](../../server/lib/history/policy.js#L163-L180)) | On those rows, `rn1`, `r06` and `s06` are deleted, with their `…Str` companions, unless they are finite non-negative numbers. The row keeps `historyObservation`; on `short` slots it is an **array** of `{source: 'KMA_ASOS', stationId, key, fields}` objects, one per contributing hourly row ([L181-L204](../../server/lib/history/policy.js#L181-L204), [controllerTown.js#L4828](../../server/controllers/controllerTown.js#L4828), [#L4903](../../server/controllers/controllerTown.js#L4903)) | **Tolerated.** Client rain checks use truthiness or `> 0`, so an absent value reads as no rain. `historyObservation` is never read, but it stays on the row objects that KMA normalization reuses by reference. Upstream states that the aim is to stop legacy charts printing `-1mm` |
| `midData.dailyStatus` | Every chain with `mergeMidWithShort` | `{healthy, reasons[], unavailableDates[], rss: 'retired'}`; `unavailableDates` covers today to today+10 ([midForecastPolicy.js#L128-L154](../../server/lib/midForecastPolicy.js#L128-L154)) | **Ignored** |
| `midData.dailyData[]` rows | Every chain with `mergeMidWithShort` | One row per date, sorted, and only for dates from today−7 to today+10 with valid `taMin` ≤ `taMax`; other rows are dropped ([controllerTown.js#L2905-L2912](../../server/controllers/controllerTown.js#L2905-L2912)). On v000705 and later chains, `convertMidKorStrToSkyInfo` also drops mid rows whose AM/PM phrase is unrecognized ([L1952-L1954](../../server/controllers/controllerTown.js#L1952-L1954); [merge rules](server-response-assembly.md#3-domestic-merge-rules-in-execution-order)). Past rows summarized from hourly observations add `observationType: 'hourly-summary'` and `observationHours`, and ten observation fields with no hourly input are deleted, per the source comment "Absence is not zero rainfall or zero lightning" ([L5636-L5642](../../server/controllers/controllerTown.js#L5636-L5642)). Rows recovered from ASOS daily records get `observationType: 'daily'` and `historyObservation` | The new fields are ignored. Date gaps matter in two places. The `today` lookup uses `fromToday == 0`, so a missing today row leaves `currentWeather.today` null. Every JavaScript reader checks for that first (ForecastCtrl, TabCtrl share text); template expressions are null-safe. The daily dust fallback renders rows at `$index` 7 and 8 ([tab-dailyforecast.html#L90](../../client/www/templates/tab-dailyforecast.html#L90)), which assumes seven contiguous past dates; a gap shifts which dates it shows (source reading) |

The iOS widgets have the same date-gap exposure ([native consumers §4.2](native-consumers-and-plugins.md#42-response-fields-read)). The web PWA reads none of these additions ([§5.2](native-consumers-and-plugins.md#52-response-fields-read)). The [synthetic examples](#synthetic-examples) predate these changes and carry none of the new fields.

Synthetic execution (2026-09-25, Node v24.21.0, the VM context from [the reproduction command](#reproduce-the-saved-normalization-examples)) tested the KMA example with these fields added. Adding top-level `historyStatus` and `midData.dailyStatus` left the normalized output deep-equal to the saved file. A `historyObservation` on `short[0]` appeared in the normalized output, as expected for reused rows. Date gaps and the dust fallback were not exercised.

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
| `weather`, `wdd` | description/direction strings? | Weather and wind text; world `wdd` exists only when `windDir` is an exact 22.5° multiple ([ww units](../../server/controllers/worldWeather/controller.ww.units.js#L136-L155)) |
| `vec` | KMA-only number, wind direction in degrees (model default `-1` = unknown, not filtered by the chart; [modelShort](../../server/models/modelShort.js#L36)) | Rotates the wind arrow in the expanded hourly detail chart `ngShortDetailChart` (`rotate(d.value.vec, …)`, [app.js](../../client/www/js/app.js#L1067)), which also reads `reh`, `wsd`, `time`. World rows carry `windDir` degrees instead and never `vec`, so the world arrow receives `rotate(undefined, …)` |
| `currentWeather.liveTime` | `'HHMM'` string from the station `stnDateTime`, present only when a valid station observation is newer than `currentPubDate` (or no `currentPubDate` exists) and overrides the current record (`stnFirst`, [controllerTown.js](../../server/controllers/controllerTown.js#L1833-L1876)); otherwise absent on KMA and world bodies | Current-point "sharp" rule `(liveTime === null \|\| time+'00' == liveTime) && time % 3 == 0` ([app.js](../../client/www/js/app.js#L546-L553)). Sharp: radius 10 at column `currentIndex`. Otherwise: radius 5 at `currentIndex + 0.5`; line vertex `currentIndex + 1` is drawn at that point and later vertices one column earlier ([L486-L515](../../client/www/js/app.js#L486-L515), [L776-L835](../../client/www/js/app.js#L776-L835)). `liveTime === null` does not occur in checked-in server code, so a body without `liveTime` (every world body, and KMA when the station observation is not newer) is never sharp. **Source anomaly:** `time` is a number after server conversion ([controllerTown24h.js](../../server/controllers/controllerTown24h.js#L1743)), so `9+'00'` is `'900'` and never equals `'0900'`; hours 00–09 are never sharp (expression evaluated in Node) |
| `pop` | number? percent | Probability of precipitation; many consumers hide zero |
| `reh` | number? percent | Humidity and icon selection |
| `wsd`, `hPa`, `visibility` | number? in selected wind/pressure/distance unit | Current and daily detail cards |
| `rn1`, `r06`, `s06` | number? in selected precipitation unit | Observation/forecast precipitation aliases; their durations differ and world conversion reuses these names. KMA `short[]` `r06`/`s06` are 3-hour slot totals of hourly forecasts and daily values are day totals (#2583) |
| `r06Hours`, `s06Hours`, `r06Approx`, `s06Approx` (KMA `short[]` and `midData.dailyData[]`); `rn1Hours`, `rn1Approx` (KMA `shortest[]`) | number / boolean | Accumulation period of the amount in forecast hours (3 per full slot, 6 for an RSS six-hour amount, 0 for a placeholder, 24 for a full day, 1 per shortest row) and whether a KMA category such as `1mm 미만` was approximated. Daily fields are omitted when an RSS six-hour amount makes the day total unknown; rows composed without slot totals (stale-RSS fallback, older chains) keep the legacy daily sum without `Hours`/`Approx`. Not read by `client/www`, widgets or the Web PWA ([mobile API](../architecture/mobile-api.md#forecast-precipitation-amounts-issue-2583)) |
| `sensorytem`, `dspls`, `dsplsStr` | feels-like number?, discomfort number?/text? | Conditional current detail |
| `summaryWeather`, `summaryAir`, `summary` | strings? | Forecast prefers summaryWeather, falls back to summary; summaryAir is a separate clickable line |
| `yesterday` | current-shaped object? | Temperature difference display |
| Daily `ultrv`, `ultrvGrade`, `ultrvStr`, `fsnGrade`, `fsnStr` | numbers/text? | UV and food-poisoning detail |
| Daily `sunrise`, `sunset` | datetime strings? containing a space | Template displays `split(' ')[1]` |
| Daily `dustForecast` | object with `pm25Grade/Str`, `pm10Grade/Str`, optional `o3Grade/Str` | Older daily air forecast fallback |
| `arpltn` | current air observation object? | Weather-screen air cards and AirCtrl fallback |

Sources: [weather date formatting](../../server/lib/kmaTimeLib.js), [forecast controller](../../client/www/js/controller.forecastctrl.js), [hourly template](../../client/www/templates/tab-forecast.html), [daily template](../../client/www/templates/tab-dailyforecast.html), [D3 chart directives](../../client/www/js/app.js), [KMA convertUnits](../../server/controllers/controllerTown24h.js), [world aliases](../../server/controllers/worldWeather/controller.ww.units.js).

Code values and sentinels ([glossary §1](domain-glossary.md#1-kma-products-categories-and-sentinels)), icon names ([§3](domain-glossary.md#3-icon-name-grammar-and-daynight-rules)), derived indices ([§6](domain-glossary.md#6-derived-indices)) and summary precedence ([§7](domain-glossary.md#7-summary-and-description-precedence)) are defined in the [domain glossary](domain-glossary.md).

### Missing values, time and units are compatibility rules

- Domestic internal records use `-50` for invalid temperature and `-1` for many other unavailable values. These are handled selectively by server aggregation/conversion; the client parser is not a universal sentinel sanitizer. KMA temperature conversion deliberately skips `-50`. Treat missing, null, sentinel and valid zero as distinct input cases.
- The current templates mix truthiness (`rn1`, `sensorytem`, several air summary cells), `> 0`, and `!= undefined`. A valid zero can disappear in one view but appear in another. Air detail uses numeric `.toFixed()`, so numeric strings are not interchangeable with numbers.
- KMA `convert0Hto24H` runs before response conversion. The final time field can be 24, preserving preceding-day midnight alignment; a rewrite must not silently normalize this away without graph parity tests.
- World (Visual Crossing, stored in Dark Sky format) data is converted to the location's local time on the server before aliases/relative days are produced. Client graphs consume the converted rows rather than doing a universal timezone conversion. Use explicit timezone/instant/local-date types in a future schema and retain this legacy adapter boundary.
- KMA snow aliases `s06`, `sn1`, `s1d` are multiplied by 10 (cm to mm) before requested-unit conversion. **Source anomaly, output-neutral:** the non-default precipitation branch passes `toWindUnit`, not `toPrecipUnit`, into `convertUnits` ([controllerTown24h.js](../../server/controllers/controllerTown24h.js#L2140-L2146)), but `_convertPrecipitation` ignores its `to` argument ([unitConverter.js](../../server/lib/unitConverter.js#L234-L241)). Only the argument is wrong: `rn1` 12.5 mm became 0.5 in with every wind unit (synthetic execution, [unit-conversion probe](../../reports/rewrite-verification/probes/server-unit-conversion.json), [script](../../reports/rewrite-verification/probes/server-unit-conversion.js)), so correcting the argument changes no value.
- Converted values lose precision and sentinels (synthetic execution, same probe). Every factor conversion is `parseFloat((val*k).toFixed(1))`, so 0.1–1.2 mm becomes 0 in and 1.3 mm becomes 0.1 in. In Fahrenheit the KMA path floors after conversion (0.5 °C → 32.9 → 32, [controllerTown24h.js](../../server/controllers/controllerTown24h.js#L2127-L2137)), while world `t1h` is the stored one-decimal `temp_f` ([ww units](../../server/controllers/worldWeather/controller.ww.units.js#L184-L187)) that `getTemp` rounds (32.9 → 33, [ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L645-L656)); the same temperature can therefore display one degree apart by source. The `-50` temperature sentinel is skipped, but `-1` sentinels are converted: -1 mm → `-0` in, which serializes as JSON `0` and is indistinguishable from no rain; `s06` -1 → -10 mm → -0.4 in; -1 m/s → -2.2 mph or Beaufort 0 (calm); -1 hPa → `-0` inHg; -1 km → -0.6 mi.
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

Each file contains an `_example` annotation plus `response` or `normalized`. Annotations are documentation metadata, not fields sent by the production API. Raw examples are **partial synthetic API bodies**, already in the legacy server's client-facing format. They are not provider captures or complete server test fixtures; shortened histories intentionally do not satisfy the server's logged cardinality expectations (KMA short >=33, daily >=17). Values and station identities are invented. The world example models the **public weather envelope after geographic enrichment** documented in the 2026-09-20 deployed Lambda excerpts; it is not the direct DSF backend body. Its location uses `long`, while the direct backend uses `lon`. It carries `source: "VC"`, which the backend `dataSort` step sets on every world result that reaches it, before `sendResult` ([controllerWorldWeather.js](../../server/controllers/worldWeather/controllerWorldWeather.js#L2134-L2179)) and the gateway's geography import leaves in place; the client's world parser ignores it and derives normalized `source` from `pubDate.VC`. Weather `dateObj` uses dotted dates; AQI timestamps use hyphens.

| Input | Output generated by checked-in converter | Demonstrates |
| --- | --- | --- |
| [KMA response](examples/client-kma-response.json) | [KMA normalized](examples/client-kma-normalized.json) | current/today/yesterday, eight-record overlay, daily flags, station air payload, `vec` on short rows, `current.liveTime` (`'0900'` with `time` 9, which the chart rule treats as not sharp; `currentPubDate` 08:00 is earlier than the 09:00 station time, the server condition for emitting `liveTime`) |
| [World public-envelope example](examples/client-world-response.json) | [World normalized](examples/client-world-normalized.json) | ordered thisTime pair, `source:"VC"` plus `pubDate.VC` publication discriminator, gateway-shaped geography |

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

After editing a raw example, regenerate its normalized file with the same context: replace the assertion with `fs.writeFileSync(prefix + '-normalized.json', JSON.stringify({_example: <existing _example>, normalized: JSON.parse(JSON.stringify(actual))}, null, 2) + '\n')`, then rerun the command above. The 2026-09-24 regeneration (adding `vec`, `liveTime`, KMA `currentPubDate` 08:00 and world `source`) followed this procedure; regenerating again produced files byte-identical to the saved ones, and the world normalized file did not change because the world parser does not copy the body `source`. A 2026-09-25 correction (KMA `stnDateTime` in the server's `YYYY.MM.DD.HH:MM` form; world air `*Str` values in English to match the English prose of that single-language response) was regenerated the same way and passes the command above. The command also passes at `bd6640f2` (re-run 2026-09-25); `service.weatherutil.js` is unchanged there.

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

AQI grades depend on the selected standard. PM concentrations display µg/m³; gases display ppm; overall AQI is an index. Client lookup tables supply colors/ranges ([AQI standard tables](#aqi-standard-tables)), and the server supplies the values/grade/text. A rewrite must keep these standards consistent across client, API, widgets and push. Sources: [AirCtrl](../../client/www/js/controller.air.js), [air template](../../client/www/templates/tab-air.html), [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [AQI chart and standards setup](../../client/www/js/controller.tabctrl.js).

## Secondary response contracts

### National overview and warnings

`NationCtrl` consumes `response.weather[]`: regional identity fields (`regionName`, `cityName`, `townName`) plus `current.skyIcon`, `current.t1h`, `current.rn1`, `current.wdd`, `current.wsd`. It finds a static Korean map city by substring in the concatenated region/city/town, not a stable city ID. `NationAirCtrl` consumes `response.air[]`: `sidoName` and pollutant Value/Grade fields. Both fetch the same nation endpoint with units. The maps' positions and names are hardcoded Korean lists even though the requested nation is `Util.region`; JP's display-name branch returns the China translation key. These are implementation constraints, not guaranteed international map support.

Warnings consume `[{name, announcement, imageUrl, type, comment, situationList?}]`, where `situationList[]` has `weatherStr`, `levelStr`, and `info[]` with `timeStr`, `location`. `type` is numeric: 1 special weather report, 2 preliminary special report, 3 weather information, 4 weather flash ([model](../../server/models/modelKmaSpecialWeatherSituation.js#L19)); the server localizes `name` from it. The template shows the bold `LOC_SPECIAL_WEATHER_NOTE` line only when `special.type === 1 || special.type === 2` (strict equality, so a string `"1"` would not show it; [template](../../client/www/templates/kma-special.html#L24-L27)), while the server's `name` mapping uses loose `==`. The controller localizes `announcement` through `Date`, replaces comment newlines with `<br>`, and the template uses `ng-bind-html`. A future renderer needs an explicit trusted-content/sanitization policy. Sources: [national weather](../../client/www/js/controller.nation.js), [national air](../../client/www/js/controller.nation.air.js), [warning controller](../../client/www/js/controller.kma.special.js), [warning template](../../client/www/templates/kma-special.html).

### Weather photo feed

| Aspect | Rule |
| --- | --- |
| Request | `WeatherUtil.loadWeatherPhotos()` calls `_getHttp(clientConfig.weatherPhotosUrl, 20000)`: up to three overlapping attempts at about 0/2/4 s (each started only while the previous attempt is unsettled), 20 s timeout each ([L925-L993](../../client/www/js/service.weatherutil.js#L925-L993)). The checked-in value is `''` ([client.config.js](../../client/www/client.config.js#L25)), so `_getHttp` rejects immediately with `Invalid url=`. The real URL is external release configuration; historically CloudFront routed `photos/*` to an S3 origin ([AWS/code correlation](../architecture/aws-code-correlation.md)) |
| Body | JSON array. Entries whose `tags` is not an array are skipped; `twUrls.regular` is used as an image URL |
| Bucketing | `tag = tags.join('_')`; first match wins: contains `lightning` → `lightning`; `rain` → `rain`; `snow` → `snow`; `sun` → `sun_smallcloud` if it also contains `smallcloud`, else `sun_bigcloud` if `bigcloud`, else `sun`; `moon` → the same three-way split; `cloud` → `cloud`; anything else is dropped |
| Selection | `findWeatherPhoto(currentWeather)` walks `lightning, rain, snow, sun_smallcloud, sun_bigcloud, sun, moon_smallcloud, moon_bigcloud, moon, cloud`; a key matches when `skyIcon.indexOf(key) != -1`, and an empty bucket falls through to the next matching key (for example `sun_smallcloud` → `sun`; any icon containing `cloud` can end at `cloud`). No match returns `null` ([L995-L1014](../../client/www/js/service.weatherutil.js#L995-L1014)) |
| **Source anomaly** | `photos[Math.floor(Math.random() * (length - 1))]` never selects the last photo when `length > 1`; with two photos it always returns index 0 |
| Triggers | `WeatherInfo.loadCities()`, the window `online` event ([app.js](../../client/www/js/app.js#L343-L345)), and `_getPhoto()` whenever `window.weatherPhotos` is undefined, i.e. every `addCity`/`updateCity` until one load succeeds. Loads are skipped while one is in flight or once `window.weatherPhotos` exists, so after one success the feed is not refreshed in that session ([service.weatherinfo.js](../../client/www/js/service.weatherinfo.js#L278-L297), [L367-L375](../../client/www/js/service.weatherinfo.js#L367-L375)) |
| Persistence | The chosen URL is stored as `city.photo` and persisted with `cities`. A completed load fills only cities whose `photo === null`, then broadcasts `loadWeatherPhotosEvent`; every later `addCity`/`updateCity` selects again |
| Display | ForecastCtrl uses `cityData.photo` only when `settingsInfo.theme == 'photo'` ([L362-L364](../../client/www/js/controller.forecastctrl.js#L362-L364), [L686-L700](../../client/www/js/controller.forecastctrl.js#L686-L700)). The `photo-url` directive ignores `null`/`undefined`, preloads the URL, then sets a gradient plus `url(...)` background, or `img/bg.png` on an image load error ([app.js](../../client/www/js/app.js#L1796-L1818)). Only TodayWeather offers the `photo` theme ([SettingCtrl](../../client/www/js/controller.settingctrl.js#L174-L181)); the TodayAir template binds `photo` through an inline `ng-style` without the directive ([ta-tab-weather.html](../../client/www/templates/ta-tab-weather.html#L37-L38)) |

Synthetic execution (2026-09-24, isolated WKWebView harness, iPhone 17 Pro / iOS 26.5, [probe record](../../reports/rewrite-verification/probes/weather-photo-selection.json)): with the loopback [synthetic feed](examples/weather-photos-feed.json), a `sun` bucket of two photos returned index 0 in 200 of 200 draws; the untagged entry was skipped; `skyIcon` `sun_smallcloud` with an empty bucket fell through to `sun`; `rain` with an empty bucket returned `null`. Rendering: [photo theme capture](screenshots/tw-theme-photo-hourly.png) (generated gradient images, not real photos).

### Push/settings request objects

`_makePostObj()` produces one object per alarm/alert:

- Common: `type` (`ios`/`android`), numeric `cityIndex` and `id`, `category` (`alarm`/`alert`), boolean `enable`, `name`, optional `location:{lat,long}` and Korean `town:{first,second,third}`, `source`, `units` including `airForecastSource:'kaq'`, `timezoneOffset` in minutes east of UTC, `package`, `uuid`, `appVersion`, optional registrationId/fcmToken.
- Alarm: `pushTime` is seconds since **UTC** midnight computed from the selected local Date; `dayOfWeek` is a seven-boolean array (Sunday first in UI).
- Alert: `startTime` and `endTime` are UTC seconds-of-day; equal endpoints are changed so end is one minute before start. `airAlertsBreakPoint` is 3 for airkorea/airkorea_who, otherwise 4.
- Token update: the current client sends only `{newToken,oldToken}` (PUT after `onTokenRefresh` reports a different token). `{newRegId,oldRegId}` is built by `_updateRegistrationId`, which is reachable only from `gcmRegister`; nothing in `client/www` calls `gcmRegister` ([service.push.js](../../client/www/js/service.push.js#L322-L386)). The server PUT handler still accepts both pairs ([route](../../server/routes/v000705/routePushNotification.js#L114-L135)), so old installs may still send the legacy pair. DELETE sends the identity object assembled by its caller.

The client does not POST a list when fcmToken is absent/empty, even if a legacy registrationId exists. The operation is one-way synchronization: success/error logging does not reconcile server state or roll back local settings. Timezone offset is device offset at submission, not a timezone identifier or necessarily the selected city's zone. See [Push service](../../client/www/js/service.push.js), [Push settings UI](../../client/www/js/controller.push.js), and [push architecture](../architecture/push-notifications.md).

Startup page, refresh interval, theme and units are otherwise local/native-preference settings; there is no general settings REST endpoint in these controllers. Unit changes repost push registrations.

### Inbound notification payload

`FirebasePlugin.onNotificationOpen` passes the plugin's object to `_notificationCallback` ([service.firebase.js](../../client/www/js/service.firebase.js#L94-L100), [service.push.js](../../client/www/js/service.push.js#L819-L853)). For records with an `fcmToken`, the server sends the FCM message `{notification:{title, body}, data:{cityIndex: "<index>"}}` ([controllerPush.js](../../server/controllers/controllerPush.js#L226-L236)); records without one took the legacy `sendIOSNotification`/`sendAndroidNotification` paths at `ff7acf39`. Direct APNs delivery was removed upstream in `45b2eb3f` (2026-09-24). At `bd6640f2` an iOS alarm or alert record without `fcmToken` fails with `FCM token is required for iOS notifications` and nothing is sent ([alarm](../../server/controllers/controllerPush.js#L1110-L1112), [alert](../../server/controllers/alert.push.controller.js#L676-L678)). An Android record without one still uses the `node-gcm` `registrationId` path, whose payload is not covered here. FCM sends still use a lazily initialized Firebase app per product ([pushProviders.js](../../server/lib/pushProviders.js#L6-L17); [provider submission](../architecture/push-notifications.md#provider-submission-and-app-handling)). How the unpinned `cordova-plugin-firebase` ([tw.package.json](../../client/tw.package.json)) flattens that message is outside the checkout; the client reads only these fields:

| Field | Type as read | Use |
| --- | --- | --- |
| `tap` | plugin boolean | `true`: opened by a tap (background); `false`: received in the foreground; any other value: `trackException(new Error('unknown tap info'))` |
| `cityIndex` | string (FCM data values are strings) | Full `cities[]` index at registration time; `parseInt` |
| `aps.alert.title`, `aps.alert.body` | strings | Foreground text when `aps` exists; `aps.alert` must be an object |
| `title`, `body` | strings | Foreground text when `aps` is absent: `message = body`, a top-level `title` is kept |

- `tap === true`: an absent (`undefined`/`null`) `cityIndex` is only written to the console. `NaN` raises `Util.ga.trackException(new Error('invalid fav:NaN'))` with no city change or reload. A number calls `WeatherInfo.setCityIndex(n)` and broadcasts `reloadEvent 'push'`; `setCityIndex` silently rejects an out-of-range index (analytics event only), so the reload then applies to the previously selected city.
- `tap === false`: the branch is chosen by the presence of `aps`, not by platform detection. The client sets `title`/`message` and broadcasts `notificationEvent`; TabCtrl shows an `$ionicPopup` titled `LOC_WEATHER` whose template is `title`, then `'<br>'` only when both parts are non-empty, then `message`, concatenated as HTML without sanitization. No reload or city change follows ([controller.tabctrl.js](../../client/www/js/controller.tabctrl.js#L1254-L1274)). Rendering with synthetic text: [foreground notification capture](screenshots/tw-overlay-foreground-notification.png) (a direct `$broadcast`, not a plugin payload).
- **Source anomaly:** the plugin error callback calls `notificationCallback(err)` without a result, and `_notificationCallback` dereferences `result.tap` without checking `err`, so a plugin error throws a `TypeError`. Without `window.FirebasePlugin`, no notification handler is installed.

Synthetic execution (first run 2026-09-24; checked in as [client-push-branch-entry.js](../../reports/rewrite-verification/probes/client-push-branch-entry.js) with its [record](../../reports/rewrite-verification/probes/client-push-branch-entry.json), 19/19 checks matching on 2026-09-25 under Node v24.21.0): the checked-in `service.weatherinfo.js` and `service.push.js` were evaluated in Node VMs with stubbed Angular injection, storage (four synthetic cities, slot 0 a disabled current position), analytics and a `Firebase.init` stub that captured `_notificationCallback`; the callback was called with each [example variant](examples/push-notification-open.json) plus extra cases. Results matched the rules above: tap `"2"` selected index 2 and broadcast `reloadEvent push`; both foreground shapes broadcast `notificationEvent` with the same `title`/`message` and no city change; `"not-a-number"` raised `trackException('invalid fav:NaN')`; `tap:'x'` raised `trackException('unknown tap info')`; an out-of-range `"7"` was rejected by the real `setCityIndex` but still broadcast the reload; a tap without `cityIndex` produced no event; the error-callback path threw `TypeError: Cannot read properties of undefined (reading 'tap')`. No device, plugin or FCM delivery was exercised.

Delivered text ([controllerPush.js](../../server/controllers/controllerPush.js#L618-L657), [L860-L887](../../server/controllers/controllerPush.js#L860-L887)): an alarm title is a location prefix (`pushInfo.name + ' '`; the KMA path falls back to town/city/region names) plus a summary title. The TodayWeather summary title is the `LOC_CURRENT: …` hourly summary; the TodayAir summary title is always `''` ([`_makePushAirMessage`](../../server/controllers/controllerPush.js#L345-L457)), so a TodayAir alarm title is only the place name with a trailing space. Alert pushes build their own title from the city name, time and forecast/air labels ([alert.push.controller.js](../../server/controllers/alert.push.controller.js#L532-L653)). The body is the summary `text`. Text language follows the stored `pushInfo.lang` ([language negotiation](#language-negotiation)). Because `cityIndex` is a list index, reorder/delete breaks the mapping; see [city model and index identity](client-state-and-behavior.md#city-model-selection-and-update-semantics). Synthetic variants: [push-notification-open.json](examples/push-notification-open.json).

### App entry links

`Branch.branchInit()` runs on `deviceready` and on every `resume`; the resume handler also broadcasts `reloadEvent 'resume'` ([app.js](../../client/www/js/app.js#L224-L231)). It reads Branch's `initSession()` result ([service.branch.js](../../client/www/js/service.branch.js#L119-L179)):

| Input | Producer | Parse | Outcome |
| --- | --- | --- | --- |
| `+clicked_branch_link` with `fav` | A Branch link carrying `fav`; no producer is in the checkout (TabCtrl share uses fixed per-product Branch URLs without `fav`, [L239-L258](../../client/www/js/controller.tabctrl.js#L239-L258)) | `fav = res.fav` | Common handling below |
| `+non_branch_link` `todayweather://N` | TodayWeather widget `moveMainApp`, `todayweather://%d` with `appIndex` ([widget](../../tw.ios/widget/TodayViewController.m#L837)) | Remove `todayweather://` → `'N'` | Common handling below |
| `todayair://N` | TodayAir widget `moveMainApp` ([widget](../../ta.ios/widget/TodayViewController.m#L880)) | Only `todayweather://` is removed, so `parseInt('todayair://N')` is `NaN` | `trackException('invalid fav:todayair://N')`, no selection. On a device this also requires the external build to register `todayair` and Branch to report the URL as `+non_branch_link` (not verified) |
| Bare `todayweather://` | TodayWeather widget edit button ([L756](../../tw.ios/widget/TodayViewController.m#L756)) | `fav = ''` (falsy) | Ignored silently |
| Bare `todayair://` | TodayAir widget edit button ([L799](../../ta.ios/widget/TodayViewController.m#L799)) | `fav = 'todayair://'` → `NaN` | `trackException`, no selection |
| Organic open | App icon or push | No `fav` | Nothing; push taps use the notification callback above |

Common handling of a truthy `fav`: `parseInt(fav)`; `NaN` raises `trackException(new Error('invalid fav:'+fav))`. A number calls `WeatherInfo.setCityIndex(n)` and broadcasts `reloadEvent 'deeplink'`. An out-of-range index is rejected silently, but the reload is still broadcast, so the previously selected city reloads; there is no disabled-city check. A numeric Branch `fav` of `0` is falsy and ignored (the string `'0'` from `todayweather://0` is truthy and selects index 0). `initSession` rejection is reported through `trackException(err.message)`. `branchInit` also calls `Branch.setDebug(true)` unconditionally before `initSession`. Synthetic execution (`service.branch.js` in a Node VM with a stubbed global `Branch` whose `initSession` resolved each case, and the same real WeatherInfo instance as the push check; same [probe](../../reports/rewrite-verification/probes/client-push-branch-entry.json)) reproduced every row of the table plus the out-of-range (`todayweather://9`: rejected, reload still broadcast), `todayweather://0` (selected slot 0 although it was a disabled current position), numeric-`0` and absent-plugin cases; real Branch/OS URL delivery was not exercised.

**Index source:** widget `appIndex` is `cityList[].index` from the native `cityList` preference ([TW](../../tw.ios/widget/TodayViewController.m#L392), [TA](../../ta.ios/widget/TodayViewController.m#L388)). `_saveCitiesPreference` omits disabled cities but writes each city's full `cities[]` index, so a disabled current-position slot 0 still counts ([service.weatherinfo.js](../../client/www/js/service.weatherinfo.js#L337-L356)).

**Build dependency:** the Branch plugin and URL-scheme registration are configured outside the checkout. [tw.config.xml](../../client/tw.config.xml) and [ta.config.xml](../../client/ta.config.xml) contain only a `<!-- Branch -->` placeholder, neither iOS app `Info.plist` declares `CFBundleURLTypes`, and `tw.ios/ios.json`/`ta.ios/ios.json` list no installed plugins. If `window.Branch` is undefined, `branchInit` returns immediately and every widget or deep link is ignored. The Android sdk16 package installs `ionic-plugin-deeplinks` with `URL_SCHEME` `todayweather` ([tw.package-androidsdk16.json](../../client/tw.package-androidsdk16.json)), but no client JavaScript consumes `IonicDeeplink`.

### Purchase variants

The checked-in `controller.purchase.js` uses the `store`/j3k0 interface; iOS Gulp tasks copy `controller.purchase.alexdisler.js` over it. Documenting only the checked-in selected file would misdescribe an iOS build.

The alexdisler implementation sends `{type:'ios', id:'tw1year'|'ta1year', receipt:<plugin receipt>}` or its Android variant `{type:'android', id, receipt:[<purchase records>]}` as JSON, timeout 10 seconds. It consumes `{ok:boolean, data:{expires_date?, message?, ...}}`: success updates premium entitlement and expiry; invalid response uses the message and may downgrade entitlement. The `store` implementation assigns `store.validator` to the same endpoint and lets the plugin form requests; its verify callback consumes `data.expires_date`. Do not invent a stable plugin wire envelope without inspecting the installed plugin version.

Stored entitlement (`purchaseInfo`) is `{accountLevel:'free'|'premium', expirationDate:<Date-parseable value>}`: every `savePurchaseInfo` caller first calls `setAccountLevel` with free or premium ([default/j3k0](../../client/www/js/controller.purchase.js#L140-L148); alexdisler [L199-L202](../../client/www/js/controller.purchase.alexdisler.js#L199-L202), [L343-L348](../../client/www/js/controller.purchase.alexdisler.js#L343-L348), [L387-L392](../../client/www/js/controller.purchase.alexdisler.js#L387-L392)). `'paid'` is only the in-memory level that `clientConfig.isPaidApp` sets at construction ([L19-L22](../../client/www/js/controller.purchase.js#L19-L22)), which also disables ads; it is never written ([client state: other keys](client-state-and-behavior.md#persisted-record-shapes)). Expired stored purchases become free at load. Store receipts, device IDs and tokens are sensitive operational data and are intentionally absent from these examples. Sources: [iOS variant](../../client/www/js/controller.purchase.alexdisler.js), [j3k0 variant](../../client/www/js/controller.purchase.j3k0.js), [build selection](../../client/gulpfile.js), [server receipt adapter](../../server/routes/v000705/receiptValidation.js).

## Bundled and device-derived inputs

### Device-derived values

These are set in the Angular `run` block, which starts after `deviceready` ([index.html](../../client/www/index.html), [app.js](../../client/www/js/app.js#L129-L176)).

| Value | Source | Derivation and fallback | Timing | Consumers |
| --- | --- | --- | --- | --- |
| `Util.region` | `navigator.globalization.getLocaleName` plugin | Last `-` segment of `locale.value` (`ko-Kore-KR` → `KR`). The error callback leaves it `undefined`: **no `KR` default** on this path. Without the plugin: last segment of the first `navigator.languages` entry containing `-`, else `KR` | Plugin callback is asynchronous, while `Units.loadUnits()` runs in `TwStorage.init().finally(...)` ([L328-L341](../../client/www/js/app.js#L328-L341)); ordering is not guaranteed. With `region` still `undefined`, default units take the "other region" branch (base units with `airnow`) and are persisted, but only for unit keys missing from stored `units`, i.e. first launch. Source-level race, not reproduced | Default units ([Units](../../client/www/js/controller.units.js#L14-L72)); `nationCode` for the national GET and map labels (JP returns `LOC_CHINA`); side-menu entries for warnings, nationwide air and nullschool shown only when `getRegion() === 'KR'`, nationwide weather additionally only in TodayWeather ([index.html](../../client/www/index.html), [SettingCtrl](../../client/www/js/controller.settingctrl.js#L93-L95)). Captured through the plugin-less `navigator.languages` path with `en-US` (2026-09-24 harness): [menu without KR-only items](screenshots/tw-menu-en-us.png), [US default units](screenshots/tw-units-en-us.png) |
| `Util.language` | `navigator.userLanguage || navigator.language` | None | Synchronous | Push POST `Accept-Language`; update popup entry (`split('-')[0]`); `indexOf('ko')` choices for share URL and the About menu; Search current-location label spacing (`ko`, `ja`, `zh-CN`, literal `zh-TU`) |
| UI language | `$translate.determinePreferredLanguage()` | Aliases and `en` fallback in [Language negotiation](#language-negotiation) | Config phase | `LOC_*` strings |
| `Util.uuid` | `window.device.uuid` when `window.device` exists | Otherwise `undefined` | Synchronous | Push `uuid` field and `Device-Id` headers; alexdisler purchase `Device-Id` |
| `Util.version` | `cordova.getAppVersion.getVersionNumber()` | Without the plugin: `window[clientConfig.package].appVersion` from `data/update.info.js` | Plugin path is asynchronous; the update popup waits on `$rootScope.$watch('version')` ([L382-L416](../../client/www/js/app.js#L382-L416)) | Push `appVersion`; stored `appVersion` comparison and update popup |

### AQI standard tables

`WeatherUtil.aqiStandard[airUnit]` ([service.weatherutil.js](../../client/www/js/service.weatherutil.js#L1016-L1118)) holds `color[]`, `str[]` (LOC_ keys), `value[code]` breakpoints (index 0 is `0`, index `g` is the upper bound of grade `g`) and `maxValue[code]`. PM values are µg/m³, gases ppm, `aqi` an index. The server tables that assign the grades, with their native units (`airnow` gases in ppb, `aqicn` gases in µg/m³ and CO in mg/m³), are in [domain glossary §5](domain-glossary.md#5-air-quality-standards-server).

| `airUnit` | Grades: colors and `str` keys | `value` breakpoints | `maxValue` |
| --- | --- | --- | --- |
| `airkorea` | 4: `#32a1ff`, `#00c73c`, `#fd9b5a`, `#ff5959`; `LOC_GOOD`, `LOC_MODERATE`, `LOC_UNHEALTHY`, `LOC_VERY_UNHEALTHY` | pm25 `[0,15,35,75,500]`, pm10 `[0,30,80,150,600]`, o3 `[0,0.03,0.09,0.15,0.6]`, no2 `[0,0.03,0.06,0.2,2]`, co `[0,2,9,15,50]`, so2 `[0,0.02,0.05,0.15,1]`, aqi `[0,50,100,250,500]` | pm25 100, pm10 150, o3 0.15, no2 0.2, co 9, so2 0.05, aqi 250 |
| `airkorea_who` | Same as `airkorea` | pm25 `[0,15,25,50,500]`, pm10 `[0,30,50,100,600]`; gases and aqi as `airkorea` | Same as `airkorea` |
| `airnow` | 6: `#00c73c`, `#d2d211`, `#ff6f00`, `#FF0000`, `#b4004b`, `#940021`; `LOC_GOOD`, `LOC_MODERATE`, `LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS`, `LOC_UNHEALTHY`, `LOC_VERY_UNHEALTHY`, `LOC_HAZARDOUS` | pm25 `[0,12.0,35.4,55.4,150.4,250.4,500.4]`, pm10 `[0,54,154,254,354,424,604]`, o3 `[0,0.054,0.124,0.164,0.204,0.404,0.604]`, no2 `[0,0.053,0.1,0.36,0.649,1.249,2.049]`, co `[0,4.4,9.4,12.4,15.4,30.4,50.4]`, so2 `[0,0.035,0.75,0.185,0.304,0.604,1.004]`, aqi `[0,50,100,150,200,300,500]` | pm25 100, pm10 150, o3 0.164, no2 0.36, co 12.4, so2 0.185, aqi 200 |
| `aqicn` | Same six as `airnow` | pm25 `[0,35,75,115,150,250,500]`, pm10 `[0,50,150,250,350,420,600]`, o3 `[0,0.075,0.093,0.14,0.187,0.374,0.56]`, no2 `[0,0.049,0.097,0.341,0.584,1.14,1.87]`, co `[0,4,8,28,48,72,120]`, so2 `[0,0.052,0.175,0.227,0.28,0.56,0.916]`, aqi `[0,50,100,150,200,300,500]` | pm25 100, pm10 150, o3 0.14, no2 0.341, co 28, so2 0.227, aqi 200 |

- Grade to color: `grade2Color` uses `aqiStandard[grade-1].color`; a grade above the table length is clamped to the last entry (analytics event), an undefined grade returns the default color, and grade `0` or below fails inside the `try` and also returns the default color after `trackException` ([controller.tabctrl.js](../../client/www/js/controller.tabctrl.js#L710-L730)).
- `setAirUnit` builds `$scope.aqiStandard[i] = {color, str, value: {code: value[code][i+1]}}` and `$scope.aqiMaxValue = maxValue` ([L1218-L1249](../../client/www/js/controller.tabctrl.js#L1218-L1249)); NationAirCtrl reads the same table. The AirCtrl legend prints `~ value[code]` under each grade ([tab-air.html](../../client/www/templates/tab-air.html#L75-L80)), and `maxValue[code]` is the lower bound for the hourly chart's y-axis top, `max(maxValue, largest value + 10%)` ([controller.air.js](../../client/www/js/controller.air.js#L283-L286), [app.js](../../client/www/js/app.js#L1600-L1606)).
- AirCtrl gauge label: `getLabelPosition(grade, val)` interpolates between the previous grade's upper bound (0 for grade 1) and this grade's upper bound ([controller.air.js](../../client/www/js/controller.air.js#L9-L50)).
- **Source anomaly:** `airnow` so2 index 2 is `0.75` ([L1073](../../client/www/js/service.weatherutil.js#L1073)); the commented ppb row `[0, 35, 75, 185, …]` ([L1077](../../client/www/js/service.weatherutil.js#L1077)) indicates `0.075`. It shows `0.75` as the grade-2 upper bound in the legend and makes gauge interpolation use `[0.035, 0.75]` for grade 2 and the inverted interval `[0.75, 0.185]` for grade 3. Grades themselves come from the server. Not reproduced at runtime.

### Bundled data files

- [`data/town.js`](../../client/www/data/town.js) sets `window.towns`: 4,206 entries `{first, second, third, lat, long, areaNo}` (evaluated 2026-09-24; 8 entries have `second === ''`, 272 have `third === ''`). `first`/`second`/`third`/`lat`/`long` are used; `areaNo` is present on every entry but read nowhere in `client/www/js`. Search matches `indexOf(word) >= 0` against `first`, `second` or `third` in file order and appends results in pages of 10 ([controller.searchctrl.js](../../client/www/js/controller.searchctrl.js#L288-L303)).
- [`data/update.info.js`](../../client/www/data/update.info.js) defines per-product globals `window.todayWeather` and `window.todayAir`: `{appVersion: string, enablePopup: boolean, updateInfo: [{lang, all: string[], android: string[], ios: string[]}]}`. `appVersion` is the `Util.version` fallback. When the stored `appVersion` differs, `enablePopup === true` clears a stored `disableUpdateInfo`. The popup shows unless `disableUpdateInfo === true`; TabCtrl picks the `updateInfo` entry whose `lang` equals `Util.language.split('-')[0]` (else the first entry) and joins platform lines, then `all` lines, with `<br>` ([controller.tabctrl.js](../../client/www/js/controller.tabctrl.js#L806-L850)).

## Contract test priorities for a rewrite

1. KMA and world inputs normalize into equivalent view models while preserving source, units, geography and time provenance.
2. Current/today/yesterday pairing, three-hour alignment, local midnight 24, empty/missing history, missing current marker, and DST-sensitive world dates.
3. Zero versus missing/sentinel values, numeric strings rejected or explicitly converted, invalid icon names, absent air station/forecast, AQI series with no anchor date.
4. Unit changes during an in-flight response; precipitation/snow conversion; client labels match stored value units.
5. Address-only legacy favorites, equator coordinates, unicode addresses and path encoding; separate public gateway and direct backend adapters.
6. Push UTC/local semantics, overnight alert range, missing token, local save versus server failure, and native receipt variants.
7. Geography precedence per flow, including a moved current position whose weather body lacks `name`/`address`; inbound push (`tap` true/false, `aps`/non-`aps`, NaN and out-of-range index) and entry links (`todayweather://`, `todayair://`, bare scheme); photo-feed bucket fall-through; weather/geocode requests with and without `Accept-Language`.
8. `bd6640f2` KMA bodies: daily date gaps (missing today, a gap among the seven past dates behind the `$index` 7/8 dust fallback), recovered rows without rain fields, and the additive `historyStatus`/`dailyStatus` fields. Proposal: feed the same bodies to the Cordova converter and the web PWA normalizer ([native consumers §5](native-consumers-and-plugins.md#5-non-native-consumer-web-pwa-web)).

These are characterization and design requirements, not claims that new automated tests or a live end-to-end suite already exist.
