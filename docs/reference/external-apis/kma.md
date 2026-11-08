# KMA API reference

[Manual index](README.md) · [Inventory](inventory.json) · [Review evidence](../../evidence/research/external-api-inventory-2026-10-24.md)

Reviewed at `82f7a4838dda046be966ee9c25c9cb66561d099d` on 2026-10-24. All operations here are **GET**. Twenty data.go.kr operations and four keyless website request forms have checked-out invokers. This is a source-wiring count, including conditional collectors; it is not a deployment or availability count. Inactive KMA endpoints and proposed APIHub/archive alternatives are listed [separately](retired.md#kma-inactive-and-research-only).

## Common request and identity

Public base: `https://apis.data.go.kr/1360000/`. Legacy point/mid/warning and UV V5 builders still use HTTP; zones, ASOS and pollen use HTTPS. server2 defaults to HTTPS. Actual paths and versions below must be preserved independently of the service title displayed by the portal.

Common query: `serviceKey`, `pageNo`, `numOfRows`; `dataType=JSON` where explicitly requested. Legacy point/mid calls omit `dataType` and parse XML. Validate `response.header.resultCode` and `response.body.items.item`; HTTP 200 alone is insufficient. KMA shared credentials come only from `DONGNAE_SECRET_KEYS`, except **legacy ASOS** described below. See [key normalization](../../../server/lib/dataGoKrKeys.js), [point requester](../../../server/lib/collectTownForecast.js#L308) and [server2 family definitions](../../../server2/src/domestic/family.rs#L108).

Grid `nx,ny` is the KMA forecast grid, not latitude/longitude. `base_date=YYYYMMDD`, `base_time=HHmm` and `tmFc=YYYYMMDDHHmm` are KST publication identifiers. Forecast `fcstDate/fcstTime` is valid time. Mid outlook station, mid land region and mid temperature region are three different ownership keys. Forecast-zone metadata is also distinct from observation-station metadata.

Illustrative unsigned query shapes, with placeholders only:

```text
GET /1360000/VilageFcstInfoService_2.0/getUltraSrtNcst
    ?serviceKey={encoded-key}&pageNo=1&numOfRows=999
    &base_date={YYYYMMDD}&base_time={HHmm}&nx={grid-x}&ny={grid-y}
GET /1360000/MidFcstInfoService/getMidLandFcst
    ?serviceKey={encoded-key}&pageNo=1&numOfRows=999&regId={land-region}&tmFc={KST-issue}
```

## Grid observations and forecasts

Official references: [short/ultra-short service](https://www.data.go.kr/data/15084084/openapi.do), [261019 guide in the public 2610 ZIP](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007732424&fileDetailSn=1), and [KMA usage guide](https://data.kma.go.kr/community/nuriLovePopup.do). The downloaded 261019 guide uses APIHub `typ02`/`authKey` URL examples; the application builders below use data.go.kr/`serviceKey`. Do not switch bases or assume identical access/publication behavior merely from a shared product name.

| ID / operation under `VilageFcstInfoService_2.0/` | Required product inputs | Fields used by this repository | Call evidence |
| --- | --- | --- | --- |
| KMA-01 `getUltraSrtNcst` | `nx,ny,base_date,base_time` | `baseDate,baseTime,nx,ny,category,obsrValue`; `T1H,RN1,UUU,VVV,REH,PTY,VEC,WSD` | [Legacy current/past](../../../server/lib/collectTownForecast.js#L952); [server2](../../../server2/src/domestic/kma/source/mod.rs#L1438) |
| KMA-02 `getUltraSrtFcst` | Same grid/publication | `fcstDate,fcstTime,category,fcstValue` plus base/grid; `PTY,RN1,SKY,LGT,T1H,REH,UUU,VVV,VEC,WSD,POP` | [Legacy shortest/past](../../../server/lib/collectTownForecast.js#L835); [server2](../../../server2/src/domestic/kma/source/mod.rs#L1440) |
| KMA-03 `getVilageFcst` | Same grid/publication | `POP,PTY,REH,SKY,TMN,TMX,UUU,VVV,WAV,VEC,WSD,TMP,PCP,SNO`; compatibility `T3H,R06,S06` | [Legacy short/past](../../../server/lib/collectTownForecast.js#L706); [server2](../../../server2/src/domestic/kma/source/mod.rs#L1441) |

Current ODAM supplies no modern SKY/LGT. Their acceptance by an old parser is historical compatibility. Ultra-short POP is consumed by current source; the guide dates provider expansion to 2026-06-23, while repository support arrived later. The six-hour ultra-short horizon is distinct from short forecasts. The 261019 short guide extends the outer horizon to D+3 for 02–14 issues and D+4 for 17–23 issues; that outer part is three-hourly with qualitative amount/wind codes. Do not promise every future slot is hourly or numeric. These are guide-level statements, not live response verification.

### Categories and units

| Category | Meaning / unit | Integration consequence |
| --- | --- | --- |
| `T1H,TMP,TMN,TMX` | Air temperature / daily minimum / daily maximum, °C | Legacy `TMP` is stored as `t3h`; the old name does not change the provider interval. |
| `SKY` | Clear/cloud categories | Grid SKY and station cloud-fraction conversions have different source semantics. |
| `PTY` | Precipitation-type code | A phenomenon, not precipitation amount. Missing cannot be reconstructed from cloud amount alone. |
| `LGT` | Lightning intensity | Guide table labels kA, while its explanation labels energy density kA/km² (0.2–100); retain that documentation discrepancy and source value rather than inventing a conversion. |
| `RN1,PCP,SNO` | One-hour rain / forecast precipitation / snowfall; mm, mm, cm | May contain qualitative text. Legacy `PCP -> r06`, `SNO -> s06` names do not imply six-hour accumulation. Preserve original text and code. |
| `POP,REH` | Probability / relative humidity, % | Valid zero is retained. |
| `UUU,VVV,WSD,VEC` | Wind components/speed m/s; direction degrees | Components retain sign. |
| `WAV` | Wave height, m | Not a replacement for the separate marine forecast product. |

The 261019 guide marks numeric values ≥900 or ≤−900 as missing and describes marine short-grid masking of temperature, POP, precipitation/snow and humidity. These are guide-level constraints, not a claim that every current data.go.kr parser universally handles every mask. Requested categories need not be available at every grid; missing must stay distinct from clear/no-rain zero.

### Publication, paging and bounds

The guide lists short issues at 02/05/08/11/14/17/20/23 KST, API availability after +10 min; ultra-short at HH30 after HH45; and nowcast generation after HH10 with subsequent ten-minute updates. It also describes within-issue ultra-short updates for temperature/humidity/wind. Retain fetch revision separately from issue identity. These guide timings do not guarantee every grid has arrived.

The **implemented server2 selector** is more conservative for some products: short after +10 min, ultra-short after :45, nowcast chooses the previous hour before :40, and mid chooses the 06 issue from 08 and the 18 issue from 20. See [publication policy](../../../server2/src/domestic/publication.rs#L122). Ultra-short responses can echo HH00 for an HH30 request; [family validation](../../../server2/src/domestic/family.rs#L265) canonicalizes to the requested issue.

Legacy point/mid acquisition requests 999 rows/page, sequential pages, maximum five pages, ten-second timeout/page. Completion checks include matching grid/issue, categories, duplicate slots and all expected pages. Manager key/quota retry differs from requester transport retry: it stops new sends, settles in-flight work, then retries unfinished work with another key. Other 4xx are not blindly retried. See [requester](../../../server/lib/collectTownForecast.js#L373) and [manager](../../../server/controllers/controllerManager.js#L1052). Default gather concurrency is 101, configurable with `GATHER_REQUEST_CONCURRENCY`; this is a process policy, not provider capacity.

Legacy polling minutes: current 2/12/22/32/42/52, shortest 47/54/4/14, short 12, mid/past 2. `SERVER_MODE` selects jobs, not route visibility. Source due/publication checks still apply. These schedules and request timeouts are not observed p95/p99.

### Historical reach and value preservation

The ordinary point interfaces do not establish seven-day historical retrieval. The KMA usage page limits recent base-date lookup; local code backfills 23 hourly current/ultra issues and seven short issues ([server2 acquisition](../../../server2/src/domestic/kma/source/fetch.rs#L8), [legacy past condition](../../../server/lib/PastConditionGather.js#L22)). This describes current implementation, including its short-forecast history input. The ASOS-primary working-tree implementation now restricts historical weather to acquired observations, ODAM and VSRT; legacy replay constructors keep the earlier behavior. See the [current implementation record](../../evidence/research/kma-full-response-implementation-2026-10-25.md).

Seven days of historical hourly SKY/PTY and the existing client values cannot be promised from an empty store using these point calls alone. ASOS supplies measured history and the observed adapter now maps supported nonblank domestic phenomenon codes to PTY. Blank semantics, numeric LGT and archive/APIHub alternatives still need qualification.

## Mid-range products

Official [mid-range service](https://www.data.go.kr/data/15059468/openapi.do). All four operations are under `MidFcstInfoService/`, with `tmFc` and common auth/paging. The current land/temperature normalization targets D+3..D+10, 36-hour freshness; missing extrema remain absent ([policy](../../../server/lib/midForecastPolicy.js#L5)).

| ID / operation | Location owner | Fields consumed | Wiring |
| --- | --- | --- | --- |
| KMA-04 `getMidFcst` | `stnId` | `wfSv` outlook text; requested issue attached | [Legacy](../../../server/lib/collectTownForecast.js#L1068), [server2](../../../server2/src/domestic/kma/source/mod.rs#L1462) |
| KMA-05 `getMidLandFcst` | Land `regId` | `wf3Am/Pm..wf7Am/Pm,wf8..10`, matching `rnSt...` rain probabilities | [Legacy](../../../server/lib/collectTownForecast.js#L1112), [server2](../../../server2/src/domestic/kma/source/mod.rs#L1463) |
| KMA-06 `getMidTa` | Temperature `regId` | `taMin3..10,taMax3..10` | [Legacy](../../../server/lib/collectTownForecast.js#L1112), [server2](../../../server2/src/domestic/kma/source/mod.rs#L1464) |
| KMA-07 `getMidSeaFcst` | Marine `regId` | `wf3Am/Pm..wf7Am/Pm,wf8..10`; wave lower/upper `wh3AAm/APm/BAm/BPm` through day 7, `wh8A/B..wh10A/B` | [Legacy gather route](../../../server/routes/v000001/routeGather.js#L102) invokes it. [server2 enum](../../../server2/src/domestic/family.rs#L114) is adapter-only; no ordinary runtime request construction established. |

Mid issues are twice daily. Retained old response field compatibility does not imply the old period is still published. A land location normally needs the relevant outlook, land and temperature owners; one shared `regId` is insufficient for all three.

## Forecast-zone metadata

**KMA-08** `FcstZoneInfoService/getFcstZoneCd` — [official portal](https://www.data.go.kr/data/15057111/openapi.do), [240715 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002950397&fileDetailSn=1). Fetches all zones in the current caller, JSON; required `regId,regName,regSp`, optional `regEn,regUp,stnWn,stnF3,stnFd,stnFw,tmEd,tmSt,seq,ht,lat,lon`. Geographic arrays are `[longitude,latitude]`.

The implementation treats `totalCount` as a **page item count**, not global total: 1,000/page, continue full pages, maximum ten pages; `03` after full pages terminates. Validate page echoes, duplicate IDs and complete list before retiring absent zones. Ten-second timeout, at most three transient attempts; auth/quota moves once through keys. Startup acquisition can still be pending at first request. See [legacy request/validation](../../../server/controllers/kma/kma.forecast.zone.controller.js#L105), [retirement](../../../server/controllers/kma/kma.forecast.zone.controller.js#L197), [server2](../../../server2/src/domestic/zone.rs#L153). Do not reuse this pagination rule for ASOS.

## ASOS measured historical observations

Official [hourly](https://www.data.go.kr/data/15057210/openapi.do) and [daily](https://www.data.go.kr/data/15059093/openapi.do) services provide completed dates through D−1. The local recovery adapter restricts requests to 1–7 completed KST dates; this is a local bound, not the maximum of every KMA historical interface.

The official hourly/daily guides additionally document D−1 availability after
11:00 KST. The [manual-backed reassessment](../../evidence/research/kma-storage-reassessment-2026-10-24.md#additional-independent-evidence)
retains the guide links/identities and separates that documented timing from
untested before-11 responses and actual field completeness. Do not classify this
publication delay as proven no-data or assume midnight restoration.

| ID / path | Inputs beyond common JSON/auth/paging | Fields used |
| --- | --- | --- |
| KMA-09 `AsosHourlyInfoService/getWthrDataList` | `dataCd=ASOS,dateCd=HR,stnIds,startDt,endDt,startHh,endHh`; one station, hours 00..23 | `stnId,tm,ta,hm,rn,ws,wd,dc10Tca,dmstMtphNo`, supported `...Qcflag/...Qcflg` |
| KMA-10 `AsosDalyInfoService/getWthrDataList` | `dataCd=ASOS,dateCd=DAY,stnIds,startDt,endDt` | `stnId,tm,minTa,maxTa,avgTa,avgRhm,sumRn,avgWs,iscs,sumRnDur` |

Legacy uses **`ASOS_HISTORY_SERVICE_KEY`**, scheduled gate `ASOS_HISTORY_ENABLED`, read gate `ASOS_HISTORY_READ_ENABLED`, allowlist `ASOS_HISTORY_STATIONS` (max 200). The CLI has its own explicit acquisition path. server2 uses **`DONGNAE_SECRET_KEYS`**, nearest city station within 100 km and request-side recovery. See [legacy service](../../../server/lib/history/service.js#L30), [operations](../../operations/historical-observations.md), [server2 ASOS](../../../server2/src/domestic/asos.rs#L218), [recovery](../../../server2/src/domestic/kma/source/observe.rs#L1237).

JSON, 999 rows/page, maximum eight pages; validate stable global total, page/size echoes, expected row count and repeated pages. Legacy HTTP: ten seconds, 2 MiB, at most three attempts for transport/timeout/429/5xx with 250/500 ms delays. Provider/envelope rejection is not transport retry ([provider](../../../server/lib/history/provider.js#L16)).

Normalization accepts normal hourly QC null/blank/0; 1 (error) and 9 (missing) reject the value. The captured API spelling is `rnQcflg`; the adapter also accepts `rnQcflag`. Missing/QC-rejected values remain absent. `dc10Tca` cloud tenths keep the existing repository SKY 1/2/3/4 mapping for 0–2/3–5/6–8/9–10. The observed adapter parses supported unambiguous concatenated modern two-digit `dmstMtphNo` codes into PTY 1 (rain), 2 (mixed), 3 (snow), with known nonprecipitation codes mapping to 0; unknown/ambiguous/hail codes stay absent. Numeric zero rain never proves PTY0; a supported code is required. Normal-QC empty-string rain can supply no-precipitation only when another valid measured field makes the row eligible and no supported/unknown nonblank phenomenon contradicts it. No numeric LGT is inferred. November–March reported rain is retained as `rn3h` only at three-hour ending marks, never relabelled hourly. Legacy replay keeps its winter exclusion. Daily `sumRn` remains a daily total despite the internal `rn1` name. Its empty-string zero additionally requires explicitly empty `iscs` and no positive/malformed `sumRnDur`; other event-log cases remain unqualified.

ASOS-primary merge overwrites supported historical fields and official daily extrema/rain, and removes the SHRT/RSS values of the fields history observes from past three-hour rows (label + 3 h ≤ now), together with the rain total kept beside the amount. The fields no history source observes (probability, wave height, snow amount and text, wind components) keep the stored publication's values, as legacy `_mergeShortWithCurrent` keeps them, or legacy's missing-forecast values without one; no older publication is read or acquired for them (`past-forecast-v1`, AK 2026-11-08). LGT, which no source observes either, is legacy `_summaryLgt`'s 0 for such a slot. Past days take probability, rain and snow amounts and AM/PM LGT from those rows where legacy `_getDaySummaryListByShort` gives them (D-2 and D-1). The current-time row (label ≤ now < label + 3 h) is not past: it keeps the forecast of the newest publication covering it, with observed fields merged over it as legacy `_mergeShortWithCurrent` does. Neither is the row the client shows as current (`currentIndex`), which follows the observation's time and so can be past by the clock when the observation lags. ASOS measures no wind components, so an hour it fills without a grid observation carries their missing value −100; a missing probability is sent as legacy's 0, and a missing snow amount stays −1 through the cm-to-mm conversion ([#2614 parity](../../architecture/server2.md#2614-kma-answer-parity-current-row-sentinels-and-yesterday)). Acquisition coverage is separate from field completeness, so an acquired blank row does not trigger endless identical refetch. Missing rows can still retry by the hourly lease; pre-release misses become eligible at 11:00 KST. The bound is not evidence that those rows are available. The selected [real Seoul fixture](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md) has 168 hours/7 days but 150 blank hourly rain/phenomenon pairs and 4 blank daily totals. The source-based normalization now supports124 of 168hourly rain/PTY rows and7 daily totals;44 QC9 hours and the missing midnight remain. Neither this fixture nor complete synthetic wet/dry data establishes all-weather seven-day closure.

Under ASOS-primary, the precipitation guard declared in the [history contract](../../../server2/config/contracts/kma-history.v1.json) keeps measured precipitation evidence from summarizing as PTY 0. An untyped three-hour slot becomes −1. An untyped AM/PM half loses its PTY, SKY and text and is listed in `missingDailyDates`. Stations without phenomenon recording therefore show missing halves rather than dry ones. When an observation day's hourly amounts close against the official daily total, `dry-closure-v1` treats April–October QC9 hours without a precipitation code as dry and a blank daily total without hourly precipitation as 0 mm. `wet-bulb-rain-v1` types an uncoded April–October amount as rain at a wet-bulb temperature of at least 5 °C. Hourly rule-derived values never replace measured values or recorded types from ASOS, ODAM or VSRT. `station-altitude-v1` selects a town's station by distance and altitude, so some towns read another station or none; see the [2026-10-30 research](../../evidence/research/kma-history-gap-options-2026-10-30.md#held-out-validation-of-proposed-rules-2026-10-31).

The [source qualification](../../evidence/research/kma-asos-closure-qualification-2026-10-25.md) now includes three ASOS-specific KMA portal answers: [blank rainfall versus trace zero](https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=66383), [blank QC is normal](https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=30942), and [minute/hourly conventions differ](https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=29442). Their transfer to data.go.kr JSON is an inference corroborated by the retained ASOS originals, not a universal serialization guarantee. Missing fields, JSONnull, QC1/9 and all-blank rows remain unknown. The official [ASOS dataset page](https://data.kma.go.kr/data/grnd/selectAsosList.do?pgmNo=36) documents winter 3h cadence. The initial preceding-period inference has bounded API-level corroboration below; actual full winter closure is not qualified. Its D−1after 10:00 portal wording does not replace the API guides'11:00 boundary without an actual API check.

The 2026-10-26 continuation adds real November 26–28, 2024 observations: all 20
numeric quantities occur at three-hour marks, and 03:00 through the following 00:00 sums match
the official daily 26.0/22.4 mm totals on two days. This corroborates the interval
interpretation for those station-days; no hourly split or full winter closure
is claimed. Separate AWS controls return the same numeric0 and `rns=○` for
an ASOS QC9 hour and a trace-rain hour, so neither may imply PTY0. The linked
source qualification retains original hashes and the native fixture regression.

APIHub's IX discriminator remains optional and unqualified; its absent key does not block the existing data.go.kr correction. The earlier generic FAQ could not distinguish these product-specific blanks, and its rule must not be copied to minute or HTML fields. The retained `rnQcflg` values are 124 blank / 44 missing 9; all eight numeric 0.0rain rows carry rain code01 and remain precipitation. Public station batches and full live timing remain unqualified.

The later [frozen journal controls](../../evidence/research/kma-asos-closure-qualification-2026-10-25.md#frozen-journal-checks-continued-2026-10-26-kst)
reject a universal journal fallback. The official2021 guideline derives hourly
phenomenon codes from the journal; matching them is not independent validation.
Fresh Incheon winter controls contain a trace amount without a corresponding
journal interval; Gangneung returns wet daily totals with empty journals. An
actual Mokpo row returns phenomenon string `"1"`, outside the current strict
two-digit decoder; no general padding rule is qualified. Intensity checkpoints
never establish an onset or preceding absence. The offline qualifier preserves
these failures without changing native mappings, rain quantities or LGT.

Direct public city pages are reachable at `/w/weather/land/city-obs.do`. Native construction now uses that URI; the obsolete URI discarded `tm` in redirects. Hourly/city acquisition rejects a publication newer than the requested hour, keeps older complete publications `Stale`, and requires a displayed city observation header rather than a search-form echo. Missing/malformed city headers are format faults, distinct from a different returned hour. Structurally broken pages are invalid before aging, including minute pages; valid minute/RSS requests still use minimum-publication semantics. The raw constructor continues to record the actual parsed publication, not a substituted requested timestamp. A future23:00query at22:44KST actually returned22:00 and is covered by a native no-raw/no-retry `Stale` regression; other release-delay shapes remain unqualified.

server2 also has an **internal, not response-exposed** previous-year daily lookup: same date ±3 days, Feb 29 maps to Feb 28, one acquisition per station/range/24h with concurrent sharing ([lookup](../../../server2/src/summary/lookup.rs#L267)). Ordinary history recovery has separate once/hour failure/reload/concurrency controls; it is not the same budget.

## UV and pollen indices

Official [life-index portal](https://www.data.go.kr/data/15085288/openapi.do) and [V5 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003684430&fileDetailSn=1); [pollen portal](https://www.data.go.kr/data/15085289/openapi.do) and [20260701 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003674579&fileDetailSn=1). The UV portal title says 4.0, while the guide and implemented path are `LivingWthrIdxServiceV5`; preserve both version facts.

All use JSON, `DONGNAE_SECRET_KEYS`, `areaNo=` blank for all areas and `time=YYYYMMDDHH` KST. A blank area is not a request per town.

| ID / path | Consumed fields | Timing / mapping |
| --- | --- | --- |
| KMA-11 `LivingWthrIdxServiceV5/getUVIdxV5` | `areaNo,date,h0,h3..h78` | Three-hour issuance selection; daily maximum requires noon sample. Valid zero retained. |
| KMA-12 `HealthWthrIdxServiceV3/getOakPollenRiskIdxV3` | `areaNo,date,today,tomorrow,dayaftertomorrow,todaysaftertomorrow`; compatibility `theDayAfterTomorrow` | Oak risk 0–3; missing days omitted. |
| KMA-13 `HealthWthrIdxServiceV3/getPinePollenRiskIdxV3` | Same | Pine risk. |
| KMA-14 `HealthWthrIdxServiceV3/getWeedsPollenRiskndxV3` | Same | Weeds risk. **`Riskndx` is the actual spelling.** |

Pollen guide: oak/pine April–June, weeds August–October; 06 issue covers today/tomorrow/D+2, 18 issue tomorrow/D+2/D+3. Availability is species/season controlled; scheduler polling is not a year-round or boundary-day availability promise. UV fallback tries current three-hour slot and earlier issuances; returned publication must be inspected. Legacy page size 1,000, 30 seconds/page, full-publication validation, auth/quota key traversal; transport failure does not automatically rotate. server2 allows eight pages. See [requester constants](../../../server/lib/lifeIndexKmaRequester.js#L26), [task dispatch](../../../server/lib/lifeIndexKmaRequester.js#L1063), [UV mapping](../../../server/lib/lifeIndexKmaRequester.js#L1210), [pollen mapping](../../../server/lib/lifeIndexKmaRequester.js#L1446), [server2 life acquisition](../../../server2/src/domestic/kma/source/life_live.rs#L176).

## Weather warnings and bulletins

Official [warning service](https://www.data.go.kr/data/15000415/openapi.do), [260601 guide](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003648415&fileDetailSn=1). The repository invokes these **six** operations under `WthrWrnInfoService/`; additional list operations in the guide are not used merely because documented.

| ID / operation | Query beyond common JSON/auth | Fields consumed |
| --- | --- | --- |
| KMA-15 `getPwnStatus` | `pageNo=1,numOfRows=10` | `tmFc,tmSeq,t6,other` |
| KMA-16 `getWthrWrnMsg` | `stnId=108,fromTmFc,toTmFc` one announcement date | `tmFc,tmSeq,t1,t2,t3,t4` |
| KMA-17 `getPwnCd` | `fromTmFc,toTmFc` same KST day; no `stnId` in caller | `areaCode,areaName,tmFc,tmSeq,warnVar,warnStress,command,cancel,endTime,allEndTime` |
| KMA-18 `getWthrPwn` | `stnId=108,fromTmFc=yesterday,toTmFc=today` | `tmFc,tmSeq,pwn,rem` |
| KMA-19 `getWthrInfo` | Same two-day window | `tmFc,tmSeq,t1` |
| KMA-20 `getWthrBrkNews` | Same two-day window | `tmFc,tmSeq,ann` |

See [legacy requester](../../../server/lib/kmaWarningRequester.js#L17), [collector](../../../server/lib/kmaWarningCollector.js#L215), [zone events](../../../server/lib/kmaWarningZones.js#L259), [server2 operation builders](../../../server2/src/warnings/provider.rs#L35).

Status polls every three minutes. A new `(tmFc,tmSeq)` triggers same-day bulletin and zone refresh; pending work is retried over cycles, with a status-only fallback after 20 cycles. Preliminary/info/breaking bulletins are separately read. Zone state bootstraps 60 KST dates using one-day queries, up to ten dates/cycle, then resyncs hourly with one-day correction overlap. This is not equivalent to one 60-day request.

Legacy timeout is 30 seconds/page; ordinary bulletin page size 1,000, zone events 10,000, maximum 20 pages. Continue until short page because `totalCount` is unreliable; `03` means no data. Auth/quota traverses keys, other failures are not unconditional retries. Apply issue/extension/correction/change commands 1/3/6/7, release 2/8, ignore cancellation=1, and reject older replay order. Location mapping uses local warning zones/ancestors/islands, not exact provider 읍면동 boundaries. The legacy KST-wall-time-as-UTC storage convention differs from an actual acquisition instant; preserve outward compatibility rather than silently changing it.

## Keyless KMA website inputs

These inputs remain part of the acquisition inventory even though they are not data.go.kr OpenAPI. The initial manual was source-only. The [2026-10-25 source qualification](../../evidence/research/kma-asos-closure-qualification-2026-10-25.md) adds finite actual public-city captures and a selected current-midnight native parser fixture; it does not qualify full historical coverage.

| ID / public request | Inputs and content | Source / bounds |
| --- | --- | --- |
| KMA-21 `www.kma.go.kr/wid/queryDFS.jsp` | `gridx,gridy`; XML header `tm`, per-day/hour `temp,tmx,tmn,sky,pty,wfKor,wfEn,pop,r12,s12,ws,wd,wdKor,wdEn,reh,r06,s06` | [Legacy RSS](../../../server/controllers/kma/kma.town.short.rss.controller.js#L99), [server2](../../../server2/src/domestic/family.rs#L360). Hourly minute 2; legacy has no explicit HTTP timeout. |
| KMA-22 `www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min` | No query: latest nationwide minute table | [Legacy](../../../server/lib/kmaScraper.js#L188), [server2](../../../server2/src/domestic/family.rs#L361). Even-minute scrape; gather has separate opt-in gate. |
| KMA-23 same path | Positional query `?{YYYYMMDDHHmm}&0&MINDB_60M&0&m`: nationwide hourly table | [Legacy hourly](../../../server/lib/kmaScraper.js#L195), [manual backfill](../../../server/lib/kmaScraper.js#L1092), [server2](../../../server2/src/domestic/kma/source/observe.rs#L725). Shared national page, not one per grid. |
| KMA-24 legacy `www.weather.go.kr/weather/observation/currentweather.jsp`; native `/w/weather/land/city-obs.do` | `tm=YYYY.MM.DD.HH:00`; native requires an exact displayed observation time; legacy URI discarded the query in the bounded live probes | [City parser/enrichment](../../../server/lib/kmaScraper.js#L262), [server2 endpoint](../../../server2/src/domestic/family.rs#L365), [page definitions](../../../server2/src/domestic/kma/source/pages.rs#L4). |

AWS tables contain station identity/address/altitude, rain presence, 15-min/1/3/6/12-hour/day amounts, temperature, wind, humidity and pressure. City pages add weather text, cloud, visibility, dewpoint and related fields. Missing `.`/`-` stays missing. Legacy HTML requests use 30-second attempts; hourly retries only marked errors up to ten attempts with one-second delays; city requests have a similar bounded retry path. Failed city enrichment still saves AWS alone. Parser handles old/new table layouts and UTF-8/EUC-KR.

Legacy station retention is 192 hourly slots (eight days); RSS retention can reach 216 hours. Those are **local retention**, not provider historical-query guarantees. Legacy manual station backfill attempts eight days. server2 shares national pages and treats hourly AWS as due after :15, a source-selected availability heuristic. Station-minute/hour/warning gather gates are `KMA_STN_MINUTE_ENABLED`, `KMA_STN_HOURLY_ENABLED`, `KMA_WARNING_ENABLED`; scrape/local mode has separate scheduling. Do not call `/gather/*` as a health probe.

## Local quota ownership

[server2 quota policy](../../../server2/src/domestic/quota.rs#L69) separates short, mid, zone, warning, hourly ASOS, daily ASOS, UV and pollen API datasets. Its development allowances are locally 10,000 per API/key/KST day; `OPERATING_UNITS` is empty. These constants are not proof of an operator's approved quota. One logical acquisition can consume multiple HTTP pages/attempts. Region/grid sharing reduces duplicate acquisition but cannot bypass provider accounting.
