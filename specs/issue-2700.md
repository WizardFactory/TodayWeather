Task: issue-2700-s15; owner: Claude builder (S15 worktree); revision/base: 87ab79cd; date: 2026-10-13.
Authority: AK authorized S15 on 2026-10-13 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC5 from [intent](../intent/issue-2700.md).

# Specification

Legacy references are at the S02 oracle baseline `f568508d` (the files hashed in
`server2/tests/golden/records.json` are unchanged at `87ab79cd`). Process clock zone is UTC, as in
the oracle; KST is computed explicitly.

## Assembly boundary (AC1)

`server2::domestic::kma::assemble(request, store, now_ms)` runs the
[v000903 router list](../server/routes/v000903/route.kma.v000903.js) in order:
`checkQueryValidation, checkParamValidation, getAllDataFromDb, getShort, getShortRss, getShortest,
getCurrent, updateCurrentListForValidation, mergeCurrentSkyByShortest, mergeCurrentByStnHourly,
getKmaStnMinuteWeather, convert0Hto24H, mergeShortWithCurrentList, mergeByShortest, adjustShort
(24h), getMid, getMidRss (retired no-op), convertMidKorStrToSkyInfo, getPastMid, mergeMidWithShort,
updateMidTempMaxMin, getLifeIndexKma, getKeco, getAirFallback, getKecoDustForecast, getRiseSetInfo,
insertIndex, makeAirInfoList, AirForecastList, insertSkyIconLowCase, setYesterday, getSpecialInfo,
convertUnits, insertStrForData, getSummaryAfterUnitConverter, makeResult, sendResult`.

- Values follow JavaScript semantics: shared object references, insertion-ordered properties
  (array-index keys first), `undefined` retained in memory and omitted by `JSON.stringify`, NaN
  serialized as `null`, `toFixed`/`Math.round`, V8 sort order, `==`/`===` and relational coercion
  where the legacy code relies on them, and the request-local precipitation bounds that never
  reach JSON (`kmaPrecipitation` WeakMap). Each middleware keeps its legacy try/catch boundary:
  an exception inside a guarded block abandons the rest of that block, as legacy does.
- `store` is the `KmaStore` trait: one synchronous method per legacy dependency call, receiving the
  legacy query arguments and returning the legacy result (JSON, Dates as `{"$date": ms}`) or an
  error. Calls are recorded in order; tests compare them with the oracle `dependency_trace`.

| Method | Legacy call |
| --- | --- |
| `towns()` | `dbTown.find({})` list used by `_findTown` (an absent town is `Legacy`) |
| `region_code(region, city)` | `manager.getRegIdByTown` |
| `town_model(model, mx, my)` | DB 2.0 `kma.town.{short,current,shortest,short.rss}` or DB 1.0 model rows |
| `mid_model(model, regId)` | mid forecast/land/temp rows |
| `forecast_zone(region, city)` | `KmaForecastZoneCode.findForecastZoneByName` results |
| `stn_hourly_and_min_rns(town, dateTime, current)` | `controllerKmaStnWeather.getStnHourlyAndMinRns` |
| `city_hourly(town)` | `controllerKmaStnWeather.getCityHourlyList` (station hourly rows) |
| `area_no(town)`, `area_no_near(lonLat)` | `modelAreaNo` exact and `$near` (0.3, limit 3) |
| `life_index(areaNo)` | `kma.lifeindex.model` rows |
| `food_poisoning(sd, sgg, start, end)` | `modelFoodPoisoning` rows |
| `arpltn(town, now)`, `dust_forecast(region, city, date)` | `KecoController.getArpLtnInfo`, `getDustFrcst` |
| `air_fallback(gCoord, now)` | `AirFallback.getArpltn` (provider chain outcome) |
| `air_forecast(source, stationName)` | KAQ/AirKorea hourly forecast controllers |
| `rise_set(geocode, dates)` | `kasiRiseSet.getRiseSetList` |
| `special_zones(areaCodes)` | `KmaSpecialWeatherZone.find({active, warnVar>0, areaCode in})` |

- Shared pure logic is reused: S12 `warnings::zones` (`zonesForTown`, `specialInfoFor`, sort),
  S11 `world::units` AQI breakpoints/grades/action guides/weather strings and `world::js` number
  and date helpers, `world::i18n` locale selection. KMA strings missing from the S11 locale subset
  live in `domestic/kma/locales.json` (provenance-recorded subset of `server/locales/*.json`).
- ASOS history reads (`config.history.readEnabled`) are off, matching the observed production
  checkout (S14 record); the hourly merge uses only the station legacy rows.
- `getAirFallback`, `AirForecastList` and `getKecoDustForecast` call only their store methods.
  `getMinuDustFrcstDspth`/`getMsrstnList` have no method (AC3).

Outcome: `Ok(json)` (the `res.json` body), `Status(code, text)` for the legacy 400 region guard,
or `Legacy(reason)` when legacy would redirect (non-Korean coordinate), geocode a new town or call
the KR name-to-address remap. Programming errors are never mapped to success.

## Native backend (AC2)

`KmaBackend` implements `gateway::BackendHandler` for `Family::Kma` and `Version::V000903`.
It parses `/v000903/kma/addr/{region}[/{city}[/{town}]][?query]` (the gateway path), decodes the
query as Express does for the used keys, selects the locale from the forwarded `accept-language`
(`world::i18n::guess`), asks a `KmaSource` for a store snapshot, then assembles in
`spawn_blocking` under the dispatcher's 3-second native attempt.

`BackendHandler` gains a defaulted `fetch_or_forward` returning `Native::Served(json)` or
`Native::Forward`; existing handlers keep `fetch`. On `Forward` the dispatcher runs the unchanged
legacy hop with the remaining deadline. `register` leaves legacy selected; `select` switches and
rolls back. The runtime source in this task is `LegacyOnly` (always `Forward`); S15b supplies the
S3/provider source. A loopback-only `SERVER2_KMA_MODE=recorded-local` runtime option serves a
recorded store snapshot file for the release-binary smoke; it rejects non-loopback legacy origins.

## Verification (AC1-AC5)

- Parity: the test store reproduces the oracle harness inputs (`rss-response-smoke.js`
  `makeFixture`/`modelData` and stubs, ported to Rust with provenance) and the per-case modifiers
  of `golden-record.js`. Assert bodies, Express weak ETags, and the dependency query order.
- Gateway: run the 5 gateway domestic v000903 cases through `Gateway` with the native switch and
  compare status, body and headers (except `date`/`connection`); legacy default and rollback.
- Forward: coverage-style `Legacy` and missing town forward to a loopback legacy origin.
- Checkpoint: release-mode measurement of the golden workloads (iterations, mean/p95 per
  assembly, `getrusage` peak RSS and user/system CPU) on macOS and in Linux CI.
- Placement gate, artifact policy, fmt/clippy/test, release smoke.
