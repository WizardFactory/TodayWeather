Task: issue-2742-s15b (slice S15b-1); owner: Claude builder (S15b worktree); revision/base: ae21b6cc; date: 2026-10-14.
Authority: AK authorized S15b and its split on 2026-10-14 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC6 from [intent](../intent/issue-2742.md).

# Specification (S15b-1)

Legacy references are master `ae21b6cc` (the S15 baseline files are unchanged except those #2737 and
#2740 touched). The process clock zone is UTC; KST is computed explicitly. "Legacy document" means
the document as the legacy saver stores it through Mongoose 5.1.2. That is the materialized form:
fields inherited from organizer templates are copied as own fields, unknown paths are stripped
by `strict`, `__v: 0` is set on insert, and BSON round-trips values (`undefined` becomes `null`).

## Source and snapshot (AC1, AC4)

`domestic::kma::source::S3Source<T>` implements `KmaSource` over a `CatalogTransport` behind the
shared `BoundedS3` admission (12 in flight; S14 index rebuilds also hold permits through the new
`IndexListing for BoundedS3`). For a request it:

1. Resolves the town with the legacy `_findTown` rule over the rebuilt town list. If the town is
   absent, the snapshot returns a temporary forward (geocoding the town is S15b-4).
2. Loads the grid families for the town's `mCoord`, the mid regions the chain will ask for, the
   forecast-zone state and the S12 warning zone state, all within the request deadline.
3. Returns a `Snapshot`, an in-memory `KmaStore` (`db_version` 2.0).

`kma` in `SERVER2_NATIVE_FAMILIES` builds the source from `SERVER2_S3_*`; no other setting exists.
A call the snapshot did not load (unexpected arguments) or a method owned by a later slice calls
`unavailable` with a named reason. The family stays off until S15b-4.

Answers (legacy query and result form):

| Method | Answer |
| --- | --- |
| `towns()` | every rebuilt town document (projection `{_id:0}`), in load order |
| `town(f,s,t)` | first matching town document, as a one-element list |
| `region_code(r,c)` | `getRegIdByTown` over `region.csv` (`city.slice(0,3)`, first 8 rows match any city); error `Fail to find code table {r}{c}` |
| `forecast_zone(r,c)` | `findForecastZoneByName(r,c)` over the zone state: active (`retired != true`), `regSp` `C`, by `regName` (plus `regId` for the legacy special cases) |
| `town_model(m,mx,my)` | the grid's documents of collection `m` at the request instant, sorted by `fcsDate` (stable) |
| `mid_model(m,regId)` | `find({regId}).sort({pubDate:-1}).limit(1)`: the one stored document or `[]` |
| `special_zones(codes)` | S12 zone-state entries with `active`, `warnVar > 0` and `areaCode` in `codes`, in state order, as legacy documents |

## Reference data (AC2)

These files are copied byte for byte into `server2/src/domestic/kma/source/data/`, with
provenance: `part.csv`, `base.csv`, `region.csv` and `kma_forecast_land_zones.csv`.

- **Towns.** The `part.csv` rows (`initTownDataToMongo`) come first, then the `base.csv` rows whose
  `town` triple is new (`updateTownDataToMongo`), in file order. Each document is
  `{town:{first,second,third}, gCoord:{lat,lon}, areaNo, mCoord:{mx,my}, __v:0}`. `mCoord` is the
  `coordinate2xy` `lamcproj` port. Numbers are cast as Mongoose casts them: `part.csv` strings via
  `Number`; `base.csv` via `parseFloat` and `parseInt(...).toString()` for `areaNo`, with an empty
  `areaNo` omitted. A Node oracle over every row pins the grid values and document form.
- **Forecast zones.** Each complete S13b `forecast-zone` acquisition (kind defined by #2741; pages
  in order) is parsed with the legacy `_parsePage`/`normalizeZone` rules. A failing page, an item
  that does not normalize, or a duplicate `regId` drops the acquisition, as legacy writes nothing.
  Accepted lists are applied in fetch order as `update({regId},{$set: zone, $unset: retired,
  retiredAt[, geo]}, upsert)`, followed by retiring absent active zones. Until #2741 lands, the
  record body format is the legacy `getFcstZoneCd` JSON page, tested with fixtures.

## Raw records to legacy documents (AC3)

Captured records are read from published catalogs only, listed per key and KST month. An
acquisition is dated by its last page (complete only then), and applies only if complete at the
request instant.

- **Grid families** read the publications that can still own a retained slot: 216 h plus the
  family's horizon and a trailing day (current 9 days, ultra-short 10, short 15).
- **RSS** reads 13 days.
- **Mid** walks months newest first, back to `HISTORY_START_MONTH` (202601, before any server2
  record), until a saved document is found. Legacy keeps the last saved document without a time
  bound.
- **Forecast zones** fold every list since that month, in completion order.
  - Every 10 minutes, memory re-reads the partitions from one day before the last folded list.
  - A new list that sorts after the last folded one is appended. A late publication that sorts
    before it triggers a full refold, so warm memory equals a cold fold.
  - A daily refold also catches lists published more than a day after their fetch day.

Documents are derived in memory; nothing derived is stored.

- **Current** (`ultra-srt-ncst`, no publication check, as the DB 2.0 current collection):
  - `organizeCurrentData` on each acquisition's items. The items carry the xml2js string form of
    the JSON values.
  - `_emitOrganizedData`.
  - `saveCurrent`: the new row gets the old document's keys it lacks, then a materialized `$set`.
  - Fetches of one slot apply in fetch order.
- **Shortest/short** (`ultra-srt-fcst`, `vilage-fcst`):
  - `rawItems`, the organizer, `within`, `batch`/`complete` and `canonical`, with a whole-publication
    reject as legacy.
  - Then `fencedUpdate`: a slot keeps the row of the newest publication, ties go to the later
    fetch, and a miss inserts with `$setOnInsert`.
- **Retention:** `fcsDate <= anchor - 216 h`, where the anchor is the family's latest publication
  at the request instant (`publicationInstant`).
- **RSS** (`town-rss`): `parseShortRss`, then `saveShortRssNewForm` (last write wins per
  `fcsDate`). Retention is `fcsDate <= t - 216 h` at the last hourly run (minute 2) before `t`.
- **Mid** (`mid-fcst`, `mid-land-fcst`, `mid-ta`):
  - `organizeForecastData` / `midForecastPolicy.parse`, then `saveMid` with `saveOnlyLastOne`:
    one document per `regId`, overwritten by every successful save in save order. A save is
    skipped when the stored document already has its publication (`checkPubDate`).
  - Save order equals publication order across months. Both legacy (`getMidForecast`,
    `getMidLand`, `getMidTemp`) and server2 (S15b-4) request only the wall-clock target `tmFc`,
    which never decreases. The reader therefore walks publication months newest first and folds
    a month's acquisitions in completion order. An acquisition of an older publication completed
    after a newer one cannot be produced; S15b-4 must keep this invariant.
  - Stored documents are read for every region. Collection eligibility only decides whether a
    missing latest publication forwards for request-time acquisition:
    - forecast `stnId` and land codes from `collectTownForecast`;
    - temperature zones from the land-zone list and the active zone state.

    A retired zone keeps its stored document.
- **Freshness:** a missing latest publication (current `current_base`, shortest
  `ultra_short_base`, short `short_base`, RSS `rss_latest`, mid `mid_tm_fc`) was a temporary forward
  in S15b-1. Since S15b-4a the request acquires it, waiting at most 3 s with no forward; data that
  is still late gets legacy's answer for absent data. Older gaps are not a forward reason; S15b-2 fills
  history (ASOS).

## D4

The S15 oracle driver is run again with `manager.MAX_CURRENT_COUNT = 192` set after loading the
harness. All 76 recordings are kept; their bodies are checked against the S02 goldens, and tests
use `AssemblyConfig::default()`.

## Verification

- **Oracle fixtures:** a pinned Node 16.20.2 driver (retained in the fixture PROVENANCE) loads the
  legacy organizers, savers, `forecastGridCollection`, `midForecastPolicy`, the RSS parser,
  `coordinate2xy`, `getRegIdByTown` and `findForecastZoneByName` with Mongoose 5.1.2 and an
  in-memory collection double. It records the stored documents and reader answers for synthetic
  provider inputs. Rust tests assert equality.
- **Snapshot tests:** with records in the S06 loopback S3 test peer, the snapshot answers the
  S15b-1 methods as recorded, and forwards with the named reasons.
- **Gateway runtime:** `kma` builds the S3 source from settings; a missing bucket is refused.
- **Release smoke:** `tools/kma_smoke.py` runs legacy -> `kma` -> legacy with a task-owned S3 peer.
  Every request is still forwarded (S15b-1 temporary), with identical bytes.
- **Checks:** fmt, fresh clippy, `cargo test --locked --workspace`, `deploy/smoke.sh`, the
  placement gate, `test_placement.py`, and artifact policy `--staged` and `--range`.

# Specification (S15b-3a), 2026-10-15

Legacy references are master `05c06c67`. "tw_svc" is the legacy service mode assembly
(`routes/v000903/route.kma.v000903.js` L57-L58: `getKeco`, `getAirFallback`, `getKecoDustForecast`).

| Source | Provider documentation | Legacy collection mirrored | tw_svc assembly fed |
| --- | --- | --- | --- |
| Real-time observations | B552584 대기오염정보 기술문서 v1.4 (data.go.kr 15073861): `getCtprvnRltmMesureDnsty`, `sidoName` required (`전국`, 17 sido names, `전남광주`), `numOfRows`/`pageNo`, `ver` 1.3 = PM 1-hour grades, codes 00/03/22/30-32, 500 requests a day (development) | `kecoRequester._collectProvinces` L775, `parseRLTMCtprvn` L201 → `airkoreaObservation.parseRows` L107, `saveRLTMCtprvn` L218 | `controllerTown.getKeco` L2563 → `kecoController.getArpLtnInfo` L397 (`_getArpLtnList` L129, `_checkDateTime` L214, `_mergeArpltnList` L226) |
| Station list | 측정소정보 기술문서 v1.2: `getMsrstnList` (S13b) | `getAllMsrStnInfo` → `completeGeoMsrStnInfo` L364, `parseMsrstnList` L272, `saveMsrstnList` L323 | `getArpLtnInfo` `MsrStn.find({geo: {$near, $maxDistance: 1}}).limit(6)` |
| Dust forecast | v1.4: `getMinuDustFrcstDspth`, `searchDate`, `ver` 1.1 (S13b) | `getMinuDustFrcstDspth` → `_checkDataTime` L472, `_parseFrcst` L525, `_saveFrcst` L570 | `controllerTown.getKecoDustForecast` L2618 → `getDustFrcst` L331, `_convertDustFrcstRegion` L267 |
| Air fallback | provider APIs of S13a (Google, OpenWeather, WAQI) | request time only | `controllerTown24h.getAirFallback` L1075 → `airFallback.getArpltn` L146 → `observation.evaluate` L119 |

Where they disagree: the documentation allows `sidoName=전국`, which legacy never used; AK chose
the nationwide dataset, so the observation rows are the same per station but come from one call
(followed: documentation and AK). Legacy `parseRows` rejects a province batch with one row
without a valid `dataTime` (7 live rows on 2026-10-14); server2 skips the row (followed: keep the
other 665 stations rather than reproduce a batch loss). Legacy geocodes a station without
coordinates; server2 does not store it (none live).

## Datasets and acquisition (A3-2, A3-3)

- `AirKoreaRequest::nationwide()`: query `sidoName=전국`, `pageNo`, `numOfRows=1000`, `ver=1.3`;
  every row needs a nonblank `stationName` and is unique per station and data time; a row without
  a valid data time is unusable, and a page of such rows only is not fatal; the publication is the
  most common data time over all pages (ties: newest). Attempts are bounded at 5 s (legacy).
- `AirKoreaRequest::dust_forecast_for(announcement)`: the announcement `_checkDataTime` expects
  when the call starts is searched by its date and recorded as the record period; the fold parses
  the items of that announcement (a record without one uses the announcement at completion).
  Record key `sido-nationwide`, kind `airkorea-station`, partition of that hour.
- The S3 source reads published catalogs only. Observations: the hour partitions of the last 26
  hours, re-read at most every 60 s (the last 3 hours each refresh) or after an own acquisition,
  parsed rows kept per acquisition and folded in completion order. Station list: every acquisition
  since 2026-01 in completion order, refreshed every 10 minutes from one day before the last folded
  list (a late list of an earlier day refolds) and refolded daily. Dust forecast: search dates
  `date-2..date`. A refresh that fails answers with the last successful fold.
- A request starts (or joins) the acquisition of a missing current dataset: the nationwide hour
  of the request instant (one attempt per hour every 10 minutes), a station list older than 7
  days (waited for only when none exists), the expected dust announcement (only when the request
  reads AirKorea forecasts: `airForecastSource` `airkorea`, or absent or `(null)` as legacy
  `checkQueryValidation` defaults it). The request waits until 100 ms before its deadline (every
  read, lock and parse is bounded by it; a re-read that cannot finish keeps the first result); an
  acquisition runs with a 30 s call bound and a 10 s publication bound. A request that waited sees
  acquisitions completed by the wall clock; otherwise only those completed by its instant.
- Demand-gated capture: while a request arrived in the last 24 hours, the process checks every 10
  minutes (first check 10 minutes after the first request) and acquires the current nationwide hour
  once when it is neither stored nor already acquired by this process.
- S08: one budget store per key and KST day (`SERVER2_AIRKOREA_DAILY_UNITS`, owner = domain-separated
  SHA-256 of the key), shared by the AirKorea operations; keys follow the S13b/S13c acquirer
  (`withKeys`, a quota answer exhausts the key until KST midnight and moves to the next key).

## Answers (A3-1)

| Method | Answer |
| --- | --- |
| `arpltn(town, now)` | `{arpltn?, list?, stnList}` of `getArpLtnInfo`; a town without `gCoord` is the callback error |
| `dust_forecast(region, city, date)` | the `getDustFrcst` list or its error text (`Fail to find dust forecast ...`, `dust forecast length is zero ...`) |
| `air_fallback(gCoord, now)` | loaded when the AirKorea answer has no value: the evaluated observation or null (no provider, unusable, or not ready by the deadline) |

The snapshot answers only the arguments it loaded (the town's coordinate, the request instant, the
request's region, city and KST date); anything else forwards with a named reason.

## Verification

- Oracle `server2/tests/domestic/fixtures/air.json.gz` (Node 16.20.2, Mongoose 5.1.2, collection
  double with an emulated 2d `$near`) and tests `air.rs`, `air_s3.rs`; gateway runtime settings;
  fmt, clippy, workspace tests, release smokes, placement and artifact policy.
- Live (2026-10-14, keys from `server/.env`): AirKorea nationwide, station list and dust forecast;
  WAQI, Google Air Quality, OpenWeather.

# Specification (S15b-2)

Legacy references are master `f49921b6`; sources followed on disagreement are named.

## Pages and station collections (AC7)

- Parsing: `KmaScraper._parseStnMinInfo`, `_decodeKmaHtml`, `_parseCityWeatherHtml` and
  `_mergeAWSandCity` (`server/lib/kmaScraper.js`), with cheerio 0.20.0 / htmlparser2 3.8.3 tree
  rules, legacy entity decoding and strict EUC-KR (`iconv`). `YYYY.MM.DD.HH:MM` parses as V8 does.
- Savers: `_saveStnHourly2`/`_saveStnMinute2` (`kmaScraper.js:821-832`, `:1630-1642`) upsert
  `{stnId, date}` with Mongoose 5.1.2 casts. `_saveStnInfo` (`:608-714`) registers a station the
  first time its address geocodes (`(산간)` removed) and updates `isCityWeather` unless the run had
  no city data (`keepCityWeather`). Registration is applied in page order (legacy runs rows in
  parallel). Geocoding is the product geocoder with the `_convertGeoCodeByApiServer` checks
  (Korean location in 33–39 N, 124–132 E).
- Readers: `getStnHourlyAndMinRns` (`controllerKmaStnWeather.js:1108-1240`) and
  `getCityHourlyList` (`:817-837`) with `getStnList` (`:784-810`; 2d `$near`, planar degrees,
  inclusive `$maxDistance`, natural order on ties), `findHourlies2`, `_getStnMinute2`,
  `_checkPrecipFromStnMinuteList` and `_findRainStnMinuteList` (the `date` identity rule).
- Seed (AK 2026-10-15): `export_station_seeds.py` validates a `mongoexport` of `kmastninfos`
  against `modelKmaStnInfo.js` and keeps the lines byte for byte; `station_seed_import` publishes it
  as one raw record (`legacy-mongo`/`kma-stn-info`); the registry starts from the newest seed.
- Rain-sensor statistics: `_updateRnsHitRate` (`kmaScraper.js:1317-1408`), the 0.5 rule
  (`controllerKmaStnWeather.js:411-417`) and `_filterStnList` (`:765-774`) are ported as functions.
  Source followed: the legacy call graph. None of them is on the v000903 path (`/gather` only, and
  `getStnHourly`/`getStnMinute` of v000001), so the snapshot copies the seeded values unchanged.

## ASOS history (AC8)

- `KmaStore::history(town)` answers `loadForTown`: `{mapping, hourly, daily}` or
  `{mapping?, reason, hourly: [], daily: []}`; null means reads disabled.
- `mergeCurrentByStnHourly` reads `city_hourly` then `history` and runs `mergeLegacy` then
  `mergeHourly`; a failed read keeps the default `{reason: 'cache-read-timeout'}`.
- `mergeMidWithShort` runs `mergeDaily` and `status` before its window filter;
  `historyStatus = status + mapping + reason` (`lib/history/service.js:66-77`,
  `policy.js:163-290`).
- Docs: `docs/architecture/mobile-api.md` (historical observation composition),
  `docs/rewrite/server-response-assembly.md` items 10 and 20. On the read budget the docs say 3 s
  (`configuration-inventory.md:78`) and the code 250 ms; the code is followed, and server2's own
  wait is AK's 3 s.

## Request-time acquisition (AC9)

- Nationwide pages: AWS minute when the newest page is older than 2 minutes; AWS hourly per KST
  hour from minute 15 (legacy runs at 4/9/15/30, `controllerManager.js:2754-2800`; one acquisition
  per publication here) plus a once-per-hour backfill of the 8-day window three at a time
  (`getStnPastHourlyWeather`); the city page of the latest hour (it serves only that hour).
- ASOS: `policy.nearest` over the registry's city stations (haversine ≤ 100 km, lower ID on ties);
  the window D-7..D-1 KST; `Recovery.run` ranges of incomplete keys, each at most once per hour;
  `Provider.fetch` checks per page (`provider.js:107-142`); `policy.normalize` and `Store.save`.
  AWS hourly rows of the station fill ongoing hours first (AK 2026-10-15), counted only for pages
  fetched within 2 h of their hour. One recovery run per station at a time, at most hourly.
  Replay is in fetch order; a range's `allowed` keys are those no earlier range completed (the
  plan-time set under serialized runs).
- Waiting: S3 state first, then the needed acquisitions, a fold and station geocoding, all within
  `min(deadline, 3 s)`. Late: empty station collections (legacy errors such as `Fail to find stn
  coords`) and `cache-read-timeout`; no 503 and no forward.
- Settings: `SERVER2_DATA_GO_KR_KEYS`, `SERVER2_DATA_GO_KR_DAILY_UNITS` (required with `kma`),
  optional `SERVER2_DATA_GO_KR_BASE_URL`, `SERVER2_KMA_BASE_URL`, `SERVER2_KMA_WEATHER_BASE_URL`.

## Coverage (AC10)

`coverage(request, index)` returns `Complete`, `NeedsLatest` (only fetchable publications missing),
`Fill {fetch, asos, absent}` or `IndexIncomplete`; there is no legacy reason. Fetch reach: current
and ultra-short latest + 23, short latest + 7, AWS hourly the window, city and minute latest only.
`asos`: missing current hours from D-7 00:00 KST. `absent`: the rest.

# Specification (S15b-3b), 2026-10-15

Legacy references are master `7ca6f002`; tw_svc readers are those of `controllerTown`
(`getLifeIndexKma` L2390, `getRiseSetInfo` L3345, `foodPoisoning.append` call L2544).

| Store call | Provider documentation / live shape | Legacy collection mirrored | tw_svc reader |
| --- | --- | --- | --- |
| `area_no`, `area_no_near` | Repository data (no provider) | `utils/updateAreaNo.js` 2016 upsert; `utils/update.areano.to.db.js` 2018 `$set {areaNo: parseInt, updatedAt}` on an existing town (a new town's Kakao geocode throws at `x.toFixed`) | `findAreaNo` L2410 `find({town}).limit(1)`; `findNearAreaNo` L2451 `$near` 0.3, limit 3 |
| `life_index` | 기상청 생활기상지수 V5 `getUVIdxV5` (3,851 areas, `hN`); 보건기상지수 V3 `getOak/Pine/WeedsPollen…V3` (`99` outside the provision period; day+3 as `twodaysaftertomorrow`) | `convertUvItemsV5` L1209, `convertPollenItemsV3` L1446, `saveLifeIndex2` L1027, `_removeOldData` L1045, `lastIssued` L1331/L1588 | `_fromLifeIndexDb2` L267 via `appendData2` L336 |
| `rise_set` | 한국천문연구원 출몰시각 `getAreaRiseSetInfo` (one item per area/day) | `gatherAreaRiseSetFromApi` L771, `updateAreaRiseSetFromApi` L674, `_apiRaw2modelKasiRiseSet` L623, `_updateKasiRiseSet` L646 | `getRiseSetList` L582 (`_findRiseSetByGeo` L511, `_findKasiRiseSetList` L460, `_model2RiseSet` L486) |
| `food_poisoning` | MFDS `poisonmap.mfds.go.kr/api/risk.do` (keyless, no published API document; 267 rows live) | `lib/foodPoisoning.js` `fetchRisk` L60, `slot`/`due` L127/L136, `parse` L22, `collect` L141 | `append` L178 |

Where they disagree: the pollen V3 response carries day+3 as `twodaysaftertomorrow` while legacy
reads `todaysaftertomorrow` (followed: legacy for the answer, the provider for server2 data). The
KASI capture asks today's column first instead of legacy's per-area order (same stored set).

- Folds: life index over the acquisitions of the last 14 days (incremental; a refold when an
  acquisition completed before the last applied one, and daily); MFDS over the last three KST
  days with the TTL applied; KASI over the window UTC D-8..D+9 kept 30 days.
- Request time: owned S3 reads (single-flight per dataset and own-publication count), owned
  acquisitions for the current UV slot, the latest pollen issuance and the current MFDS slot, each
  waited for until the request deadline; a no-data pollen issuance and an asked MFDS slot are not
  asked again; KASI captured while requests arrive and answered `[]` until first read.

# Specification (S15b-3c), 2026-10-15

Legacy references are master `1d60f728` (#2757 at `91c77fcb` and #2762; the parity target, AK). tw_svc
assembly: `controllerTown24h` `checkQueryValidation` L68 (absent or `(null)` → `airkorea`),
`_insertForecastPollutants` L690, `_getAirForecast` L1196, `AirForecastList` L1264;
`controllerTown.getKecoDustForecast` L2618 (skipped unless `airkorea`, L2627).

| Store call | Provider / live shape | Legacy collection mirrored | tw_svc reader |
| --- | --- | --- | --- |
| `air_forecast("airkorea", station)` | `getMinuDustFrcstDspth` `imageUrl7` (PM10) and `imageUrl8` (PM2.5): animated GIFs on `https://www.airkorea.or.kr/dustImage/…`; the `11시 발표` documents of 2026-10-15 named the previous day's 23-cycle (820×820, 48 frames of 673×795 at (66,10), 5.1/4.9 MB), the `17시 발표` ones the 17-cycle (54 frames, 6.2/5.9 MB) | `kecoRequester.getMinuDustFrcstDspth` L649-703 → `AirkoreaHourlyForecastController.do` L95 (`_checkHourlyForecast` L127, `_getImgPaths` L67, `getDustImage` with `airkoreaImageLayout.frameStart`, `getPixelMap` with `layout.validate`, `getDustInfo` with `layout.station`, `_makeHourForecast` override, `_updateDb` L28, `_removeOldData` L116) | `getForecast` (`img.hourly.forecast.controller` L149) |
| `air_forecast("kaq", station)` | none (KAQ source gone) | — | `KaqHourlyForecastController.getForecast` L469 → `_findLatestMapCase` L231-239 (`Fail to get map case`) |

Where they disagree: `kaq` — legacy answers no forecast; server2 answers AirKorea labelled
`airkorea` when the store has no KAQ forecast at all (AK). Legacy fetches the provider URL as
given; server2 fetches its validated path on the built-in root (the same resource). Legacy decodes
any GIF; server2 bounds the frame descriptors first. Legacy accepts an image of any date for an
announcement; server2 rejects (before download, and in the fold) an image whose first frame is
after the announcement's next day 00:00 KST, which the eight-day read window relies on (parity
exception, safety bound; review S15b3c-R7).

- Acquisition: keyless `airkorea-image` / `airkorea-forecast-image` / key `national`, period and
  partition of the announcement; both URLs must pass `frameStart` (six-hour cycles 05/11/17/23)
  before any download; page 1 PM10, page 2 PM2.5 (status 200, a GIF with frames on the 820×820
  canvas within the decoding bounds), page 3 a manifest of the two URLs; paths fetched on
  `https://www.airkorea.or.kr/`;
  8 MiB per image; 60 s call budget.
- Fold: the acquisitions of the last eight KST days (the longest accepted animation, 120 frames,
  plus a day of row life) in completion order (ties by fetch group) as
  `do` runs (a stored `pubDate` with both codes is skipped; an image that fails the layout stores
  nothing; rows older than one day are removed at each run and at the cut). Refresh: the eight day
  catalogs' control objects list the acquisitions; unknown ones are read one lookup each and
  decoded before the next is read, once per station list; at most every minute, at once for a new
  station list or after an own acquisition ended. Decoding: frame descriptors bounded (120 frames,
  4 Mi pixels a frame, 64 Mi in all), an LZW code chain longer than the table is an error.
- Request time: a request reading the forecast (`airForecastSource` absent, `(null)`, `airkorea`
  or `kaq`) loads the station list and the dust forecast, reads the fold and, when the fold lacks
  the expected announcement, starts one owned acquisition of its images (of the previous
  announcement while the expected one names no acceptable pair), waiting only until its deadline.
