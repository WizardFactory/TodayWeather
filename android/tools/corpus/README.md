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
| `WeatherInfo.setCityIndex`/`updateCity` (`service.weatherinfo.js`) | the factory with recording storage | the record of anomaly A01 (see `differences.md`) |

`sprintf.js` is installed at build time and not tracked; the code formats only one `%s`, which the generator substitutes.

## Inputs

`corpus/inputs/` holds v000903 responses captured from the production API on 2026-11-08 (read-only requests; the API host is a private build input and is not stored). Units were Celsius, m/s, hPa, km, mm and the airkorea standard unless the name says Fahrenheit; `Accept-Language` was Korean unless the name ends in `-en`.

| File | Request |
| --- | --- |
| `kma-seoul`, `kma-seoul-en`, `kma-seoul-f` | `/weather/v000903/coord/37.56,126.98` (Korean, English, Fahrenheit) |
| `kma-jeju` | `/weather/v000903/coord/33.5,126.53` |
| `vc-london`, `vc-london-f` | `/weather/v000903/coord/51.51,-0.13` (Celsius, Fahrenheit) |
| `vc-newyork`, `vc-sydney` | New York and Sydney, for UTC offsets on both sides and daylight-saving zones |

## Coverage of the verification matrix

Client rows of `docs/rewrite/verification-matrix.md` and the corpus cases that cover them (`conversion/<name>.json`, `functions.json`, `weather-info.json`):

| Row | Cases |
| --- | --- |
| V04 time boundaries | `vc-newyork`, `vc-sydney` (offsets and daylight saving as served), `kma-no-current-index`, `kma-current-index-first`, `kma-midnight-today-first-day`, `vc-no-current-index`, `todayPosition` |
| V05 units, zero, missing, sentinel and string values | `kma-seoul-fahrenheit`, `vc-london-fahrenheit`, `kma-zero-precipitation`, `kma-rain-everywhere`, `kma-sentinels`, `kma-string-values`, `diffTodayYesterday` (C and F), `rainSnowFall` |
| V06 coordinates and address-only places | `kma-address-only`, `geolocationNormalize`, `shortenAddress`, `townFromAddress` |
| V07 unknown source, missing parts, error bodies | `unknown-source`, `vc-no-pubdate`, `vc-no-units`, `kma-missing-short`, `kma-missing-mid`, `kma-missing-current`, `world-missing-daily`, `world-missing-thistime`, `html-error-body`, `empty-object`, the captured responses |
| V09 response after a place switch | `weather-info.json` (`late-response-after-switch`) |
| V10 missing air data | `kma-no-air`, `kma-empty-air-list` |
| V24 language | `kma-seoul-en`, `diffTodayYesterday` (ko, en) |
| V31 precipitation and icon codes | the captured responses' `pty`/`skyIcon` values, `weatherEmoji`, `rainSnowFallSymbol` |
| V32 air standards | `airInfoList`/`airInfo` pass-through in every case; grade mapping is screen code and belongs to AN-09 |

Behavior that differs from `packages/weather-core` or a documented anomaly is listed in [differences.md](differences.md).
