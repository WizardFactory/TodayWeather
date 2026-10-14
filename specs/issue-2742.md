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
  `ultra_short_base`, short `short_base`, RSS `rss_latest`, mid `mid_tm_fc`) is a temporary forward
  until S15b-4 acquires it at request time. Older gaps are not a forward reason; S15b-2 fills
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
  a valid data time is unusable; the publication is the most common data time (ties: newest).
  Record key `sido-nationwide`, kind `airkorea-station`, partition of that hour.
- The S3 source reads published catalogs only. Observations: the hour partitions of the last 26
  hours, re-read at most every 60 s (the last 3 hours each refresh) or after an own acquisition,
  parsed rows kept per acquisition and folded in completion order. Station list: every acquisition
  since 2026-01 in completion order, refreshed every 10 minutes. Dust forecast: search dates
  `date-2..date`.
- A request starts (or joins) the acquisition of a missing current dataset: the nationwide hour
  of the request instant (one attempt per hour every 10 minutes), a station list older than 7
  days (waited for only when none exists), the expected dust announcement (only for
  `airForecastSource=airkorea`). The request waits until 100 ms before its deadline; an
  acquisition runs with a 30 s call bound and a 10 s publication bound. A request that waited sees
  acquisitions completed by the wall clock; otherwise only those completed by its instant.
- Demand-gated capture: while a request arrived in the last 24 hours, the process checks every 10
  minutes (first check 10 minutes after the first request) and acquires the current nationwide hour
  once when it is neither stored nor already acquired by this process.
- S08: one budget store per key and KST day (`SERVER2_AIRKOREA_DAILY_UNITS`, owner = domain-separated
  SHA-256 of the key), shared by the AirKorea operations; keys follow the S13b legacy `withKeys`.

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

