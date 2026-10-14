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

Captured records are read per grid (S14 `CaptureIndex::rebuild` for one grid, then `read_slot` for
each captured publication) and per mid region and RSS grid (catalog lookup of the latest
publications). Documents are derived in memory; nothing derived is stored.

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
  - `organizeForecastData` / `midForecastPolicy.parse`, then `saveMid` with `saveOnlyLastOne`: one
    document per `regId` from the newest publication that parsed; for equal publications the
    earlier fetch wins, because legacy skips an already stored publication.
  - Regions legacy never collects answer `[]`: forecast `stnId` and land codes from
    `collectTownForecast`; temperature zones from the land-zone list and the active zone state.
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
