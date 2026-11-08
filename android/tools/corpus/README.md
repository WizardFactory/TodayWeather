# Golden corpus for the Kotlin weather core

`generate.mjs` runs the current Cordova client code under Node and writes the expected outputs that `core-domain`'s `GoldenCorpusTest` compares with the Kotlin port. It is the only part of the Android work that reads `client/`; the Gradle build reads the generated files in `core-domain/src/test/resources/corpus/`.

```sh
node android/tools/corpus/generate.mjs      # from the repository root, Node 22 or later
```

Running it again without changes in `client/` or the inputs changes nothing. `corpus/source.json` records the commit and SHA-256 of each client file it ran.

## What runs

| Cordova code | Loaded as | Kotlin |
| --- | --- | --- |
| `WeatherUtil.convertWeatherData`, `getShortenAddress`, `convertAddressArray`, `getTownFromFullAddress`, `getWeatherEmoji`, `geolocationNormalize` (`service.weatherutil.js`) | the AngularJS factory in a `vm` context with stub `Util`, `Units` and `Monetization` | `WeatherConverter`, `AddressFormat`, `ForecastText`, `GeoLocation` |
| `_diffTodayYesterday`, `_makeRainSnowFallValueStr`, `getRainSnowFall`, `getRainSnowFallSymbol`, `getTodayPosition` (`controller.forecastctrl.js`) | each function extracted from the source and run with a stub `$scope`, `$translate` and the locale catalogs | `ForecastText`, `ChartPosition` |
| `TabCtrl.updateWeatherData` with the real `WeatherInfo` (`controller.tabctrl.js`, `service.weatherinfo.js`) | the extracted function with a request that completes after the place switch | the record of anomaly A01 (see `differences.md`); AN-08 implements the decided fix |
| `aqiStandard` (`service.weatherutil.js`), TabCtrl `setAirUnit`, `grade2Color`, `airkoreaGrade2Color`, `getSentimentIcon`, AirCtrl `getLabelPosition`, `getAirCodeUnit`, `_getAQIList`, `_getDustForecast`, `_getHourlyForecast` | extracted functions with stub `$scope`, `Units` and element widths | `AirQuality` (`air.json`) |
| `NationCtrl`, `NationAirCtrl` (`controller.nation*.js`) | the controllers with a stub `WeatherUtil.getNationWeather` returning the captured response | `Nationwide` (`nation.json`) |
| `parseSpecialData` (`controller.kma.special.js`) | the extracted function with `Date` locale methods fixed to each language and Asia/Seoul (plus en-US in New York) | `Warnings` (`special.json`) |

`CoreOnDeviceTest` (app `androidTest`) runs the converter and the warning parser against the corpus on a device; it passed on API 24 and API 36 emulators.

`corpus/push.json` in `core-storage`'s test resources records the requests of the Cordova `Push` service (`service.push.js`, with recording `$http`) after a start for a first, an unchanged and a changed FCM token, and for New York alerts whose start equals their end at the daylight-saving transitions (case `zone` and `pushList`); `PushRegistrationTest` compares them with `PushRegistration`.

`core-model` holds typed views of these responses and of the converted place weather (`PlaceWeather`, `CurrentWeather`, `DailyForecast`, `AirStation`, `NationResponse`, `WeatherWarning`, `GeocodeResponse`); `ModelsTest` checks them against the captured responses.

`sprintf.js` is installed at build time and not tracked; the code formats only one `%s`, which the generator substitutes.

## Inputs

`corpus/inputs/` holds v000903 responses captured from the production API on 2026-11-08 (read-only requests; the API host is a private build input and is not stored). Units were Celsius, m/s, hPa, km, mm and the airkorea standard unless the name says Fahrenheit; `Accept-Language` was Korean unless the name ends in `-en`.

| File | Request |
| --- | --- |
| `kma-seoul`, `kma-seoul-en`, `kma-seoul-f` | `/weather/v000903/coord/37.56,126.98` (Korean, English, Fahrenheit) |
| `kma-jeju` | `/weather/v000903/coord/33.5,126.53` |
| `vc-london`, `vc-london-f` | `/weather/v000903/coord/51.51,-0.13` (Celsius, Fahrenheit) |
| `vc-newyork`, `vc-sydney` | New York and Sydney, for UTC offsets on both sides and daylight-saving zones |
| `kma-seoul-imperial` | Seoul with °F, mph, inHg, mi, in and the airnow standard |
| `kma-seoul-aqicn`, `kma-seoul-who` | Seoul with the aqicn and airkorea_who standards and other wind/pressure units (kt, mmHg, bft, mb) |
| `vc-tokyo` | Tokyo with km/h and the airnow standard |
| `nation` | `/v000903/nation/KR` (15 cities of weather, 17 provinces of air) |
| `special` | `/v000903/kma/special` (3 bulletins) |
| `geocode-seoul` | `/geocode/v000903/coord/37.56,126.98` |

## Coverage of the verification matrix

Client rows of `docs/rewrite/verification-matrix.md` and the corpus cases that cover them (`conversion/<name>.json`, `functions.json`, `weather-info.json`):

| Row | Cases |
| --- | --- |
| V04 time boundaries | `functions.json` `updateTime` (24:00, year end, leap day, numeric and missing dates), `air.json` synthetic `hourlyForecast` (midnight as 24:00 and 00:00, month and year ends, leap day), `special.json` synthetic announcements (both New York daylight-saving changes, year end, leap day, ISO range rules and the time value limit; each case runs with `TZ` set to its zone), `vc-newyork`, `vc-sydney` (offsets and daylight saving as served), `kma-no-current-index`, `kma-current-index-first`, `kma-midnight-today-first-day`, `vc-no-current-index`, `todayPosition` |
| V05 units, zero, missing, sentinel and string values | `units.json` (each of the 8 unit and standard variants with zero, missing, sentinel and string values for temperature, precipitation, wind, pressure (`hPa`, `press`) and distance (`vis`, `visibility`) fields; expected output as the SHA-256 of canonical JSON), `kma-seoul-fahrenheit`, `vc-london-fahrenheit`, `kma-seoul-imperial`, `kma-seoul-aqicn`, `kma-seoul-who`, `vc-tokyo`, `kma-zero-precipitation`, `kma-rain-everywhere`, `kma-sentinels`, `kma-string-values`, `diffTodayYesterday` (C and F), `rainSnowFall` |
| V06 coordinates and address-only places | `kma-address-only`, `geolocationNormalize`, `shortenAddress`, `townFromAddress` |
| V07 unknown source, missing parts, error bodies | `kma-null-short-row`, `kma-null-daily-row`, `vc-null-hourly-row`, `vc-null-daily-row`, `kma-number-row`, `unknown-source`, `vc-no-pubdate`, `vc-no-units`, `kma-missing-short`, `kma-missing-mid`, `kma-missing-current`, `world-missing-daily`, `world-missing-thistime`, `html-error-body`, `empty-object`, the captured responses |
| V09 response after a place switch | `weather-info.json` (`late-response-after-switch`, the real TabCtrl completion) |
| V10 missing air data | `kma-no-air`, `kma-empty-air-list`, `air.json` `aqiList` (`missing-air`, stations without values) |
| V24 language | `kma-seoul-en`, `diffTodayYesterday` (ko, en) |
| V31 precipitation and icon codes | the captured responses' `pty`/`skyIcon` values, `weatherEmoji`, `rainSnowFallSymbol` |
| V32 air standards | `air.json`: each standard (airkorea, airkorea_who, airnow, aqicn, missing, null, unknown) for every pollutant: grade bands and maxima, grade colors and icons for grades 0–7 and a string grade, and the gauge label at each band's lower bound, upper bound and upper bound + 0.001 at two widths; `nation.json` air colors for airkorea and airnow |
| S10–S12 nationwide weather, air, warnings | `nation.json` (three modes × 15 cities, six pollutants × 17 provinces × two standards), `special.json` (seven language/zone pairs) |

Behavior that differs from `packages/weather-core` or a documented anomaly is listed in [differences.md](differences.md).
