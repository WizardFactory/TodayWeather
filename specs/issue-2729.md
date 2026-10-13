Task: issue-2729-s13a; owner: Claude builder (S13a worktree); revision/base: 45e9193b6a6d6168314eea0c48a6c1bf1c46d6cb; date: 2026-10-13.
Authority: AK authorized S13a on 2026-10-13 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC5 from [intent](../intent/issue-2729.md). Paths: [S13a declaration](../server2/config/tasks/S13a.json).

# Specification: provider formats, domestic air/rise-set/zone and the world air chain (S13a)

## Shared S08 transport (AC1)

`providers::ResponseFormat` declares the credential and format parameters a data.go.kr-style
request carries. The transport appends them after the family query; the executor offers the
format per call. `execute`/`execute_reported` keep `DataType` (S13 behavior unchanged).

| Format | Appended (in order) | Accepted result codes | Families |
| --- | --- | --- | --- |
| `DataType` (default) | `serviceKey`, `dataType=JSON` | `0`, `00` | S13 VilageFcst, MidFcst, life index |
| `ReturnType` | `serviceKey`, `returnType=json` | `0`, `00` | AirKorea B552584 |
| `UnderscoreType` | `_type=json`, `ServiceKey` | `0`, `00` | KASI RiseSetInfoService |
| `Type` | `type=json`, `ServiceKey` | `0`, `00`, `0000` | newsky2 ForecastZoneInfoService |

An endpoint that already carries the format's credential (any case) or format parameter is
rejected. `classify_format` is `classify` with the format's success codes; `classify` is
unchanged. `budget::Provider` gains `GoogleAirQuality`, `OpenWeather` and `Waqi` (paths
`google_air_quality`, `openweather`, `waqi`); the shared funded transport and executor reject
them (the world air transport is separate, as the S11 Visual Crossing transport is).

## Domestic families (AC1, AC2)

Legacy sources at `45e9193b`: `lib/airkoreaObservation.js` (supported client),
`lib/kecoRequester.js` (key choice), `controllers/kasi.riseset.controller.js`,
`models/modelKasiRiseSet.js`, `controllers/kma/kma.forecast.zone.controller.js`,
`lib/dataGoKrKeys.js`, `models/arpltnKeco.js`.

| Request | Operation | Family query (transport appends format + key) | Keys | Pages |
| --- | --- | --- | --- | --- |
| `AirKoreaRequest` station | `B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` | `sidoName, pageNo, numOfRows=100, ver=1.3` | one configured AirKorea key, no rotation (legacy last key) | <=20, total <=2000 |
| `AirKoreaRequest` sido | `B552584/ArpltnStatsSvc/getCtprvnMesureSidoLIst` | `sidoName, pageNo, numOfRows=100, searchCondition=HOUR` | as above | <=20, total <=2000 |
| `RiseSetRequest` | `B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo` | `location, locdate` | data.go.kr ring, rotation on quota/auth (#2604) | 1 |
| `ZoneRequest` | newsky2 `service/ForecastZoneInfoService/ForecastZoneCodeDataInfo` | `pageNo=1, numOfRows=999` | data.go.kr ring, rotation on quota/auth | 1 |

The sido is one of the 17 legacy `getCtprvnSidoList` names; the area is one of the 102 legacy
`getAreaList` names (static ported data). Each page call is one S08 funded call (two funded
attempts; retry only on a transient or invalid response, as S13).

Validation before any record:

- AirKorea (legacy `envelope`/`parseRows`): `resultCode` exactly `00`; `body.items` an array;
  `totalCount` digits <=2000 and unchanged across pages; `pageNo`/`numOfRows` echoes equal the
  request; `items.length = min(100, total - (page-1)*100)`; each row an object with a nonblank
  identity (`stationName` or `cityName`), a valid KST `dataTime` (`YYYY-MM-DD HH:MM`, 24:00
  only at minute 0), sido rows a nonblank `sidoName`, a present `sidoName` equal to the
  request, and no duplicate identity@time across the set; at least one row with a numeric
  concentration (`so2Value`..`khaiValue`). `totalCount` 0 is terminal no data.
- KASI: `resultCode` `00`; `body.items.item` one object echoing `location` and `locdate`;
  the 12 legacy time fields are number or string; `totalCount`, when present, is 1.
- Zone: `resultMsg` `OK` (the legacy check); `body.items.item` a nonempty array of objects
  with distinct nonblank `regId`; `totalCount`, when present, equals the row count and
  `pageNo`/`numOfRows` echoes, when present, equal 1/999 (legacy silently truncated).

Records: source `data-go-kr`; kinds `airkorea-station`, `airkorea-sido`, `kasi-area-rise-set`,
`forecast-zone`. Keys: `named` `sido-<romanized>`, `area-<hex of the UTF-8 name>` and
`forecast-zones`. Periods/partitions: AirKorea the newest row `dataTime` (`YYYYMMDD-HHMM`,
24:00 as next-day 00:00); KASI `locdate` (`YYYYMMDD`); zone the KST fetch day (`YYYYMMDD`).
Pages are `Pagination{complete: true}` members of one fetch group (O-9 publication stays with
the caller, as S13).

Not ported (open decision): AirKorea `getMinuDustFrcstDspth` and `getMsrstnList`, which
legacy still calls on the retired `openapi.airkorea.or.kr` host with `_returnType=json`; and
the KASI coordinate API `getLCRiseSetInfo`, which legacy never reaches.

## World air chain (AC3)

`world::LiveAir` implements the S11 `AirSource`. Legacy sources at `45e9193b`:
`lib/AQI/airFallback.js`, `lib/air/{providerChain,providerBudget,observation,httpClient}.js`,
`lib/air/providers/{google,openweather,waqi}.js`, `config/air.js`.

1. A non-finite coordinate answers no air. The air cell is legacy `_cellOf`
   (`toFixed(2)` per axis).
2. An unexpired memory row answers; otherwise one single-flight task per cell reads S3, then
   (when providers are enabled) runs the chain. Rows expire 30 min after `fetched_at` when an
   observation exists (also when it was unusable for the first requester), 2 min otherwise.
3. S3 read: catalogs of the three air sources for the UTC days of `now-30min` and `now`; the
   newest record with `fetched_at <= now < fetched_at + 30 min` is parsed by its provider
   parser. A read failure counts as a miss, as the legacy cache read failure did.
4. Chain: free order Google -> OpenWeather -> WAQI, then WAQI again if not yet tried; each
   provider is skipped when unconfigured (key shorter than 10 or the placeholder), down,
   unfunded or (OpenWeather) over the rolling minute cap. Funding: one S08 unit reserved and
   consumed before HTTP on the provider's monthly UTC window (operator-configured quota and
   limit; legacy free caps less the 5 % reserve are 9,500 and 950,000; WAQI had no cap).
   Each attempt is one HTTP request (legacy `providerTimeoutMs` 3 s, no retry). 401/403 and
   429 mark that provider down for 10 min; other failures move on. The first observation that
   `evaluate` accepts for the first requester wins; otherwise the last unusable observation is
   kept. The paid phase (legacy default off) is not ported.
5. The decisive body is published to S06 (one record, one group) before it becomes a memory
   row; a publication failure gives no new success (2 min failure row).
6. Each request evaluates the row's observation with its own precise coordinate and time
   (8 h freshness, 1 h future slack, 30 km station distance, PM required) and renders it with
   the S11 code. The engine's 4 s release and `airStatus` pending are unchanged.

Provider requests use the cell coordinate (`String(Number(toFixed(2)))`):
Google `POST v1/currentConditions:lookup?key=` with the legacy JSON body; OpenWeather
`GET data/2.5/air_pollution?lat=&lon=&appid=`; WAQI `GET feed/geo:LAT;LON/?token=`.
Parsers port `google.js`, `openweather.js` and the S11 WAQI parser.

## Storage and privacy (AC3, AC4)

Air records: sources `air-google`, `air-openweather`, `air-waqi`; kind `current`; key `named`
`air-<p|n><|lat|*100>-<p|n><|lon|*100>`; period `{UTC fetch day, "current"}`; partition
`YYYYMMDD`; status 200; the received content type; exact provider bytes. The precise request
coordinate is used only in memory for evaluation; keys, catalogs, metadata and provider
requests carry only the cell. Recorded bodies carry station or provider-grid coordinates only.

## Runtime and switches (AC5)

`SERVER2_WORLD_AIR` is read only with `SERVER2_WORLD_MODE=native-local`: unset keeps the S11
`Unconfigured` source; `live-local` configures providers whose loopback URL, key, quota id and
monthly units are all set; `restore-local` reads S3 only. Native world remains off by default.

## Differences from legacy (recorded)

Provider coordinate is the cell instead of the first requester's precise coordinate; free-phase
counting is a durable S08 reservation that fails closed (legacy allowed calls when its Mongo
counter read failed); down markers and the OpenWeather minute window are per process (legacy
shared them through Mongo); a publication failure is not a success (legacy answered after a
failed cache write); HTTPS for KASI and newsky2 (legacy HTTP; live reachability unverified);
one funded retry for an invalid AirKorea page (legacy failed it at once).

## Verification

Unit and loopback tests with labelled fixtures; S3-only restore over the S11 oracle air
scenarios with a loopback WAQI stub and the S06 test peer; privacy scan of keys, catalogs,
bodies and provider request lines; release-mode smoke over real loopback HTTP and the S3
peer. fmt, clippy, full test suite, placement gate and artifact policy.
