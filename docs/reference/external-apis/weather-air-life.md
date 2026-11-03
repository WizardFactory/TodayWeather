# Other weather, air, risk and astronomy APIs

[Manual index](README.md) · [KMA](kma.md) · [Inventory](inventory.json)

Source review: 2026-10-24, `82f7a4838dda046be966ee9c25c9cb66561d099d`. The contracts below describe application use, not live account/provider validation. Conditional gather jobs and native server2 acquisition must be enabled/configured to run. Older unused providers are in [legacy integrations](retired.md).

## AirKorea / KECO

Official services: [pollution and forecast, 15073861](https://www.data.go.kr/data/15073861/openapi.do), [station metadata, 15073877](https://www.data.go.kr/data/15073877/openapi.do), [regional statistics, 15073855](https://www.data.go.kr/data/15073855/openapi.do). Public [20260630 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003666340&fileDetailSn=1) covers the operation families; documented operations not invoked by this application are outside the used inventory.

All **GET**, base `https://apis.data.go.kr/B552584/`; `AIRKOREA_SECRET_KEYS` JSON list → query `serviceKey`; common `returnType=json,pageNo,numOfRows`. The [shared requester](../../../server/lib/airkoreaObservation.js#L5) defines the five operations; four have current acquisition callers.

| ID / service-operation | Query beyond common | Consumed content | Wiring |
| --- | --- | --- | --- |
| AIR-STATION `ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` | `sidoName,ver=1.3` | `stationName,mangName,sidoName,dataTime`; PM10/PM2.5, 24h PM values, SO₂/CO/O₃/NO₂, KHAI and supported grade fields | [Legacy province collection](../../../server/lib/kecoRequester.js#L785); [server2 nationwide](../../../server2/src/domestic/airkorea.rs#L92) uses `sidoName=전국,numOfRows=1000`, also supports per-province requests |
| AIR-SIDO `ArpltnStatsSvc/getCtprvnMesureSidoLIst` | `sidoName,searchCondition=HOUR` | `sidoName,cityName,cityNameEng,dataTime`; pollutant/KHAI values. Regional model has no grade field set. | [Legacy](../../../server/lib/kecoRequester.js#L959) is invoked. [server2 adapter](../../../server2/src/domestic/airkorea.rs#L185) exists, but no native acquisition caller was found. **`LIst` spelling is significant.** |
| AIR-FORECAST `ArpltnInforInqireSvc/getMinuDustFrcstDspth` | `searchDate=YYYY-MM-DD,ver=1.1` | `dataTime,informCode,informData,informGrade,informCause,informOverall,actionKnack,imageUrl1..9` | [Legacy forecast](../../../server/lib/kecoRequester.js#L531), [server2](../../../server2/src/domestic/airkorea.rs#L119); text grades split by region, requested announcement matched, `예보없음` cannot overwrite an existing grade |
| AIR-STATIONS `MsrstnInfoInqireSvc/getMsrstnList` | All stations; **no `ver`** in current caller | `stationName,dmX,dmY,addr` and station metadata; without `ver`, `dmX=latitude,dmY=longitude` | [Legacy startup](../../../server/lib/kecoRequester.js#L256), [server2](../../../server2/src/domestic/airkorea.rs#L137) |
| AIR-NEARBY `MsrstnInfoInqireSvc/getNearbyMsrstnList` | `tmX,tmY,ver=1.1` | Nearby station rows | [Legacy helper](../../../server/lib/kecoRequester.js#L835) only, no current caller; server2 has no operation variant. **Adapter-only.** |

### Time, units and validation

PM is µg/m³; observed gases are ppm; grade/KHAI numbers are dimensionless. `dataTime` is KST; exactly 24:00 normalizes to next-day instant while original text is retained. Missing/invalid concentration is absent, not zero. A named unavailable station with null time and explicitly null values is not a fabricated observation. Invalid identity/time/required structure fails the affected province before write. The legacy aggregation additionally forms province rows from urban-network stations, rounding PM/KHAI to integers and gases to three decimals ([normalization](../../../server/lib/airkoreaObservation.js#L90), [aggregation](../../../server/lib/kecoRequester.js#L725)).

Legacy: five seconds/attempt, 2 MiB body, 100 rows/page, maximum 20 pages/2,000 rows, 30-second logical/key-search budget, one immediate transient retry, province concurrency four. All operations page explicitly, including forecast. Validate result code, counts and echoes. Station/regional-statistics can traverse bounded zero `totalCount` pages but must reach a terminal empty page; a short nonempty page is insufficient. Remove echoed credential fields before archival ([paging/transport](../../../server/lib/airkoreaObservation.js#L219)).

Auth codes 20/30/31/32 or HTTP 401/403 rotate key; quota code 22 or HTTP 429 exhausts that key until next KST day; code 23 does not rotate. Transport/payload failures do not rotate. Key state is per legacy process ([key policy](../../../server/lib/airkoreaObservation.js#L343)). server2 has independently wired five-second/2 MiB/30-second acquisition bounds and S3-backed budgets; do not assume identical in-memory retry state.

Legacy collection runs in gather/local mode: station/sido every ten minutes, forecast at minute 2, metadata at startup. server2 acquisition is unavailable without configured keys. Its local quota model has **three separate dataset allowances**, each 500/key/KST day, with no configured operating allowance table. These are code defaults, not approved account quota ([quota](../../../server2/src/domestic/quota.rs#L69)).

## Air forecast GIFs and KAQ

These are image/HTML inputs, not additional formal JSON OpenAPI services. Their decoded values are **model forecasts**, not measured station observations.

| ID / request | Selection and output | Caller / bounds |
| --- | --- | --- |
| AIR-GIF **GET** returned AirKorea `imageUrl7` for PM10 / `imageUrl8` for PM2.5 | Announcement plus pollutant/GIF frame time identifies the forecast; colors/frames become hourly values at station positions | [Legacy selector](../../../server/controllers/airkorea.hourly.forecast.controller.js#L74); [server2 allowlist](../../../server2/src/domestic/airkorea_image.rs#L19) permits only AirKorea HTTP/HTTPS hosts, public body cap 8 MiB |
| KAQ-GIF **GET** configured S3 image URL | `/{folder}/{case}.{PM10,PM2_5,O3,NO2,SO2}.09KM.animation.gif`; folder/case discovered by S3 listing, excludes `dateBackup`, supports `modelimg_CASE4`/`modelimg` | [Legacy](../../../server/controllers/kaq.hourly.forecast.controller.js#L174); image HTTP client has no explicit timeout. S3 listing is documented once under [AWS](platform.md#aws-storage-and-operational-apis). |
| KAQ-MAPCASE **GET** `http://www.kaq.or.kr/map_case.asp` | Website HTML/text selects model case | [Requester](../../../server/controllers/kaq.hourly.forecast.controller.js#L209), [scheduled invoker](../../../server/controllers/kaq.hourly.forecast.controller.js#L386); three-second attempts, at most three, no delay |

KAQ is gated by `GATHER_AIR_FORECAST_ENABLED`; its literal UTC schedule in source is minute 7 at hours 8,9,10,11,20,21,22,13. Folder-to-publication +20-hour arithmetic is an implementation convention. The external KAQ copy Lambda and historic producer observations are described in [AWS correlation](../../architecture/aws-code-correlation.md); they are not a new repository-owned provider transport or proof the producer is healthy today. No public normative KAQ/GIF specification was verified.

## Current global air providers

The modern legacy-server chain is Google → OpenWeather → WAQI in the free phase; after local budgets, WAQI if not tried, then explicitly enabled paid OpenWeather → Visual Crossing → Google. Each provider is attempted at most once per chain (maximum four). **server2 has Google/OpenWeather/WAQI only**, sharing one process chain between domestic and world routes. There is no native VC-air adapter ([legacy chain](../../../server/lib/air/providerChain.js#L46), [server2 chain](../../../server2/src/world/air.rs#L472)).

| ID / operation | Auth and request | Consumed response / units | Source and official reference |
| --- | --- | --- | --- |
| GLOBAL-GOOGLE-AIR **POST** `https://airquality.googleapis.com/v1/currentConditions:lookup` | Query `key` from `GOOGLE_SECRET_KEY`; JSON `location:{latitude,longitude}`, `extraComputations:[LOCAL_AQI,POLLUTANT_CONCENTRATION]`, `universalAqi:true,languageCode:en` | `dateTime,pollutants[].code/concentration.value/units,indexes[].code/aqi`; supported µg/m³, gas ppb/ppm normalized | [Adapter](../../../server/lib/air/providers/google.js#L41); [official method](https://developers.google.com/maps/documentation/air-quality/reference/rest/v1/currentConditions/lookup) |
| GLOBAL-OWM-AIR **GET** `https://api.openweathermap.org/data/2.5/air_pollution` | `lat,lon,appid` from `OWM_SECRET_KEY` | `list[0].dt,components.{pm2_5,pm10,o3,no2,so2,co},main.aqi`; all concentration components µg/m³ | [Adapter](../../../server/lib/air/providers/openweather.js#L20); [official docs](https://openweathermap.org/api/air-pollution) |
| GLOBAL-WAQI **GET** `https://api.waqi.info/feed/geo:{lat};{lon}/` | `token` from `WAQI_SECRET_KEY` | `status,data.time,iaqi.*.v,city.name/geo,aqi,attributions`; pollutant numbers are **AQI subindices**, not concentration | [Adapter](../../../server/lib/air/providers/waqi.js#L24); [official docs/attribution terms](https://aqicn.org/api/) |
| GLOBAL-VC-AIR **GET** `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{lat},{lon}/today` | `key` from `VC_SECRET_KEY`, `unitGroup=metric,include=current,elements=datetime,datetimeEpoch,pm2p5,pm10,o3,no2,so2,co,aqius,aqieur` | `currentConditions.datetimeEpoch`, pollutants µg/m³, AQI fields, root `queryCost` | [Legacy adapter](../../../server/lib/air/providers/visualcrossing.js#L20); paid phase only; [Timeline docs](https://www.visualcrossing.com/resources/documentation/weather-api/timeline-weather-api/). Detailed air specification was not independently retrieved. |

The WAQI inverse conversion is an **estimate** from subindex to concentration; preserve originating station/agency attribution. It is not interchangeable with measured provider concentration. A usable current reading needs PM10 or PM2.5, age ≤8h, future skew ≤1h and, for WAQI, station distance ≤30 km. The chain normalizes PM to µg/m³ and gases to ppm before requested grading.

Legacy cache: 0.01° cell, 30-minute success / two-minute failure; auth/quota puts a provider down ten minutes. Default provider timeout three seconds (`AIR_PROVIDER_TIMEOUT_MS`, bounded 0.5–10s), no adapter retry; optional overseas-air branch deadline four seconds (`AIR_RESPONSE_DEADLINE_MS`, bounded 0.5–8s). Weather may succeed without air. See [configuration](../../../server/config/air.js#L49) and [operating policy](../../operations/air-provider-policy.md). These budgets are not response percentiles.

Local free-budget defaults and paid caps are policy estimates, not provider price/entitlement assertions: legacy Google 10,000/month, OWM 1,000,000/month with 95% reserve, OWM 60/min; paid disabled by default. server2 uses configured monthly caps, OWM process minute cap and S3 budget state. WAQI's modeled allowance likewise is not evidence of account approval. Older WAQI route behavior differs; see [legacy WAQI](retired.md#still-wired-older-weather-routes).

## Visual Crossing world weather

**WORLD-VC — GET** `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{lat},{lon}/{range}`. Official [Timeline documentation](https://www.visualcrossing.com/resources/documentation/weather-api/timeline-weather-api/). Auth `VC_SECRET_KEY` → `key`. This is the current provider behind the retained `/dsf` route name; Dark Sky acquisition is retired.

Request query: `unitGroup=us,lang=en,include=days,hours,current,elements={allowlist}`. Coordinates use at most six decimal places. Combined/recent/forecast range strings are `last1days/next7days`, `yesterday/next7days`, `today/next7days`. The combined legacy code treats the first range as D−2..D+7 based on observed behavior; the string alone is not a one-day-history guarantee.

Consumed allowlist: `datetime,datetimeEpoch,temp,tempmax,tempmin,feelslike,feelslikemax,feelslikemin,humidity,precip,precipprob,preciptype,snow,windspeed,winddir,pressure,visibility,uvindex,cloudcover,conditions,icon,source,sunriseEpoch,sunsetEpoch,moonphase`; root `days,currentConditions,timezone,tzoffset,queryCost`, and row `tzoffset`. Provider-local dates and UTC epochs must preserve DST. US units mean °F, mph, inches/miles; pressure hPa. Response conversion applies client units.

Request-time cache fill uses DB or S3 raw storage ([legacy requester](../../../server/lib/VC/vcRequester.js#L14), [world response](../../../server/controllers/worldWeather/dsf.controller.js#L1062), [server2](../../../server2/src/world/source.rs#L88)). The entire legacy call is bounded to 2.5s, including at most one retry after 300ms for socket reset/EPIPE or early concurrency-429; 4 MiB compressed body cap, gzip, keepalive/maxSockets 8. Auth/quota blocking differs from transient concurrency-429.

Legacy checks allowance using estimated combined/recent/forecast costs 49/25/1; this is not an atomic reservation. It records actual `queryCost` after acquisition. server2 instead pre-funds up to two attempts at fixed 49/25/1 local units per attempt and returns unused reservation to its window pool; it does not reconcile those units to response `queryCost` ([funding](../../../server2/src/world/source.rs#L406)). Provider billing and local funding units remain distinct. Costs and timeout bounds are not live latency measurements.

## MFDS food-poisoning risk

**LIFE-MFDS — GET** `https://poisonmap.mfds.go.kr/api/risk.do`. No query/body/key; JSON Accept and identifying User-Agent. This is an official-website-backed endpoint; a normative public OpenAPI specification was **not** retrieved. The public landing page returned no extractable content during documentation review, which says nothing about an authenticated/data call.

Consumes `success=true,data[]` with `sd,sgg,baseDate=YYYYMMDD,regDatetime=YYYY-MM-DDHHmm,todayRisk,tomorrowRisk,afterTomorrowRisk`. Risk 0..1 maps to percent and grades at 0.315/0.559/0.743. Missing risk stays absent; bad identity/date/publication invalidates the batch. Uses newest publication, skips past dates, expires after target KST day, falls back from district to province row. See [legacy parser/requester](../../../server/lib/foodPoisoning.js#L28), [server2 parser](../../../server2/src/domestic/mfds.rs#L1) and [native acquisition](../../../server2/src/domestic/kma/source/life_live.rs#L183).

Legacy schedule 08:20/12:20/17:20 KST plus startup catch-up. HTTP ten seconds, 1 MiB, no redirects/retry; DB write budget 30s, optional response-read append two seconds. Legacy response reads do not fetch MFDS. server2 has its own live acquisition path and raw nation/day/slot identity; no API-key/S08 public-data budget is required.

## KASI rise/set astronomy

Official [KASI service](https://www.data.go.kr/data/15012688/openapi.do), [v1.2 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002694817&fileDetailSn=1). Base `https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/`; legacy builder uses HTTP. Credentials **`DONGNAE_SECRET_KEYS`**, query spelling **`ServiceKey`**, `_type=json` even though portal format metadata says XML. JSON response is validated by the implementation.

| ID / GET operation | Parameters | Output and wiring |
| --- | --- | --- |
| ASTRO-KASI-AREA `getAreaRiseSetInfo` | `location` named area, `locdate=YYYYMMDD` KST | `location,locdate,longitudeNum,latitudeNum`; `sunrise,suntransit,sunset,moonrise,moontransit,moonset,civilm,civile,nautm,naute,astm,aste` HHmm events. [Legacy](../../../server/controllers/kasi.riseset.controller.js#L193) loops 102 areas; [server2](../../../server2/src/domestic/riseset.rs#L119) is wired. |
| ASTRO-KASI-COORD `getLCRiseSetInfo` | `longitude,latitude,locdate,dnYn=Y` | Same event family. [Legacy builder](../../../server/controllers/kasi.riseset.controller.js#L233) exists but fallback is unreachable because `length >= 0` returns DB results at [line 601](../../../server/controllers/kasi.riseset.controller.js#L601). Not ported to server2; **adapter-only**, not default. |

Missing event `------` is omitted; assemble event dates with the KST contract. Legacy area job polls at minute 55. Five seconds/attempt; auth/quota tries each configured key once, other failure does not rotate. server2 local KASI allowance is 10,000/API/key/KST day, not proof of approved operator quota.
