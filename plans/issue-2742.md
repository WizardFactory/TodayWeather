Task: issue-2742-s15b; owner: Claude builder (S15b worktree); revision/base: ae21b6cc; date: 2026-10-14.
Inputs: [intent](../intent/issue-2742.md), [spec](../specs/issue-2742.md). Declaration (S15b-1): [S15b-1.json](../server2/config/tasks/S15b-1.json).
Split, decisions and fill rule: [#2742 comment](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6167282481).
Design stage: skipped with reason for S15b-1. The request flow is the S15 gateway sequence; the
snapshot only replaces the store. The data flows are listed in the spec and in
`docs/architecture/server2.md`.

# Plan

## Slices

| Slice | Content | Completion |
| --- | --- | --- |
| S15b-1 | Source/snapshot and wiring; towns (repository CSV + `coordinate2xy`), region code, forecast zone (S13b records), grid/RSS/mid documents from raw records, warning zones; D4 | Oracle-equal documents and answers; named temporary forwards |
| S15b-2 | AWS/city page parsers, `KmaStnInfo` from KMA pages and geocoding, station hourly/minute answers; the legacy #2564/#2648 ASOS history composition, enabled; on-demand ASOS hourly/daily acquisition through S08 as raw records | Station answers and ASOS fill equal legacy over oracle inputs |
| S15b-3 | AirKorea station list (S13b) with `$near` selection, `arpltn`, dust forecast; area numbers from repository data and geocoding; life index; KASI; MFDS; air fallback; KAQ/AirKorea image pipeline (D2; calibration keys required) | Air/life answers equal legacy; decoder characterized with synthetic GIFs |
| S15b-4 | Request-time acquisition (latest grid publications, 23-slot current backfill, RSS, mid, zone list, unknown-town geocoding and storage); warm per-cell memory and exact-raw packs; the two S15 declared forwards reproduced natively; S3-only end-to-end parity; release smokes | Zero legacy forwards; a cold cell served within the native attempt |

## Cold-cell design (D5; implemented in S15b-4)

A cold request first loads the S3 records it can find. In S15b-4 it then acquires through S08 what
is missing and publishes it before serving:

- the latest current, shortest and short publications, RSS and mid;
- the 23 past current slots of the KMA backfill;
- ASOS hourly/daily records for older hours back to D-7 (S15b-2).

S14 capture then continues while demand lasts. Latency is bounded in three ways:

- A per-cell memory holds parsed raw acquisitions. Complete publications are immutable; recent
  publications are rechecked, so a warm request reads only new publications.
- Closed KST cell-days are packed as section 5 exact-raw packs (one object per cell, day and
  family) after the response. A cold read is then about 10 pack GETs plus the open day's
  publications, instead of about 500 catalog lookups.
- Acquisitions run concurrently under the S08 and S3 admissions, inside the 3-second attempt.

**Open check:** whether `getUltraSrtNcst` serves the slot exactly 24 hours ago. If it does, the
first request fills it from KMA and the yesterday comparison works; if not, the slot keeps legacy
ASOS behavior (`comparisonAvailable: false`). This needs an authorized live call; S15b makes none.

## Scenarios (S15b-1)

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| B1 | App user in a seeded town | Snapshot for a `base.csv` town | `towns`/`town` equal the legacy-loaded documents; `mCoord` equals `coordinate2xy` | AC2; `source::towns_*` oracle tests |
| B2 | App user in a metro city or province | `region_code` for metro, province, empty city and unknown region | Legacy `getRegIdByTown` rows and error text | AC2; `source::region_*` |
| B3 | Mid temperature lookup | `forecast_zone` over zone states from two zone-list acquisitions (retired zone, special names 강화/광주/군위/울릉/고성) | Legacy `findForecastZoneByName` answers | AC2; `source::zone_*` |
| B4 | Grid with captured publications | Current/shortest/short/RSS pages in S3 (merge, fence, ties, rejects, retention) | Documents equal the legacy oracle; reader answers equal | AC3; `source::grid_*`, `source::rss_*` |
| B5 | Mid forecast | Forecast/land/temp records incl. a failing parse and an uncollected region | One newest parsed document or `[]` | AC3; `source::mid_*` |
| B6 | Warning area | S12 zone state with active and released zones | `special_zones` legacy documents | AC2; `source::special_zones_*` |
| B7 | Operator enables `kma` | Settings with and without S3 bucket | Source built from `SERVER2_S3_*`; missing settings refused; every request forwarded with a named reason | AC1/AC4; `gateway::runtime`, `source::snapshot_*`, `kma_smoke.py` |
| B8 | Reviewer checks D4 | Re-recorded oracle at 192 | 74 matches plus 2 declared forwards; S02 goldens equal | AC5; `parity::*` |
| B9 | Reviewer checks placement | Placement gate | Only declared paths | AC6 |

## Files (S15b-1)

- Add:
  - `server2/src/domestic/kma/source/` (source, snapshot, towns, region, zone, grid, rss, mid,
    records, `data/` with PROVENANCE);
  - `server2/tests/domestic/source.rs` and fixtures;
  - `server2/config/tasks/S15b-1.json`.
- Change:
  - `server2/src/domestic/kma/{mod,backend,chain,data}.rs` (exports, source selection, the
    shared `_findTown` helper);
  - `server2/src/gateway/runtime.rs` and its test (`kma` reads `SERVER2_S3_*`);
  - `server2/src/world/air_store.rs` (`IndexListing for BoundedS3`);
  - `server2/tests/domestic/*` and `fixtures/oracle.json.gz` (D4);
  - `server2/tools/kma_smoke.py` (S3 peer);
  - `server2/examples/kma_checkpoint.rs` and `tools/kma_checkpoint.py` if the D4 config changes
    them.
- Docs: intent/spec/plan `issue-2742.md`; the S15b section in `docs/architecture/server2.md`.

## Order

1. Declaration and issue comment.
2. Red tests.
3. Oracle driver and fixtures.
4. Towns, region and zone.
5. Grid, RSS and mid.
6. Source, snapshot and wiring.
7. D4.
8. Green, refactor, checks, smoke and placement.
9. Commit, push, PR, CI, Codex review loop, readiness.

## Checks

```
cargo +1.99.0 fmt --check
cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings
cargo +1.99.0 test --locked --workspace
python3.11 server2/tools/kma_smoke.py --binary <release>
bash server2/deploy/smoke.sh --binary <release> --skip-reused
python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S15b-1.json --base ae21b6cc
python3.11 server2/tools/test_placement.py
python3 scripts/check-artifact-policy.py --staged
python3 scripts/check-artifact-policy.py --range
```

## Rollback and blast radius

A library and a source selected only by `kma` in `SERVER2_NATIVE_FAMILIES`. That family still
forwards every request in S15b-1. Revert the PR to roll back.

## S15b-3 (2026-10-15)

Declaration: [S15b-3.json](../server2/config/tasks/S15b-3.json) (S15b-3a). Endpoint pre-merge.

| PR | Content | Completion |
| --- | --- | --- |
| S15b-3a | Nationwide AirKorea observations, station list, dust forecast, air fallback; kma AirKorea acquisition settings; shared air chain | Oracle-equal documents and answers; single-flight acquisition; deadline release |
| S15b-3b | Area numbers (repository data + geocoding), life index (UV V5, pollen V3 national datasets), KASI, MFDS (keyless) | Oracle-equal answers; live-confirmed requests |
| S15b-3c | KAQ/AirKorea GIF forecasts with the deployed calibration (service host config.js L89-L174) | V37 decoder characterization; oracle-equal hourly rows |

### Scenarios (S15b-3a)

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| C1 | App user in Seoul | Snapshot after nationwide datasets and a station list are stored | `arpltn` equals `getArpLtnInfo` (merged, list, three stations) | A3-1; `air::arpltn_answers_*`, `air_s3::air_inputs_restore_*` |
| C2 | First user of the hour | No dataset of the hour; two concurrent requests | One provider call, published, both served | A3-2; `air_s3::a_missing_national_dataset_*` |
| C3 | User while AirKorea is slow | Acquisition slower than the deadline | Request returns before its deadline with stored data; the next request is served without a new call | A3-3; `air_s3::a_slow_acquisition_*` |
| C3b | Users across hours | A request once in the last 24 h; no request in the next hour | The capture acquires that hour once; the next request reads it from S3 | A3-2; `air_s3::the_hourly_capture_*` |
| C4 | User where no station has a value | No AirKorea data; air provider configured, or too slow | Fallback observation (evaluate), or none before the deadline | A3-1/A3-3; `air_s3::the_air_fallback_*` |
| C5 | Widget/web asking AirKorea forecasts | `airForecastSource=airkorea` | `getDustFrcst` list or error text | A3-1; `air::dust_forecast_*`, `air_s3::the_snapshot_*` |
| C6 | Operator enables `kma` | Key without units, bad root, placeholder keys | Refused, refused, read-only | A3-4; `gateway::runtime::kma_airkorea_*` |
| C7 | Reviewer checks placement | Placement gate | Only declared paths | A3-5 |

### Checks

```
reports/.../cargo.sh fmt --check; clippy --locked --workspace --all-targets -- -D warnings; test --locked --workspace
python3.11 server2/tools/kma_smoke.py --binary <release>; bash server2/deploy/smoke.sh --binary <release> --skip-reused
python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S15b-3.json --base 05c06c67
python3 scripts/check-artifact-policy.py --staged / --range
```

Rollback: revert the PR; `kma` remains off until S15b-4.

## S15b-2 station observations and ASOS history

Declaration: [S15b-2.json](../server2/config/tasks/S15b-2.json). Base `05c06c67`, merged with
master `f49921b6`. Outside paths: this plan, the intent/spec records and the S15b-2 section of
`docs/architecture/server2.md`.

### Sources and which was followed

| Topic | Provider documentation | Legacy collection | Deployed assembly | Followed |
| --- | --- | --- | --- | --- |
| AWS minute/hourly, city pages | KMA web pages, no API document; live shapes 2026-10-14 | `kmaScraper.js` `getAWSWeather`/`getCityWeather`/`_parseStnMinInfo` ([K8](../docs/rewrite/external-providers.md)); cadence in [weather collection](../docs/architecture/weather-collection.md) | `controllerKmaStnWeather.js:784-1240` | legacy code; the city page ignores `tm` (live) |
| Station registry | — | `_saveStnInfo` ([data model](../docs/rewrite/data-model-reference.md)) | `getStnList` 2d `$near` | legacy code, seeded from the `kmastninfos` copy (AK 2026-10-15) |
| ASOS ranges | data.go.kr ASOS: `stnIds` required, D-1 only, dev quota 10,000/day; live: no nationwide form | `lib/history/{provider,recovery,policy,store}.js` ([H1](../docs/rewrite/external-providers.md#historical-observations-asos), [lifecycle](../docs/rewrite/server-data-lifecycle.md)) | `controllerTown.js:1288-1320`, `:2796-2803` ([assembly items 10/20](../docs/rewrite/server-response-assembly.md), [mobile API](../docs/architecture/mobile-api.md)) | legacy code; read budget 250 ms in code vs 3 s in `configuration-inventory.md` (code followed; server2 waits AK's 3 s) |
| Ongoing ASOS hours | API허브 nationwide forms need an authKey (not configured) | — | — | AK 2026-10-15: AWS hourly page rows |
| Recent grid hours | `getUltraSrtNcst` −23 h `00`, −24 h `10` (live) | `PastConditionGather` 23 slots ([gather reconciliation](../docs/architecture/gather-source-reconciliation.md)) | — | KMA backfill 23 h, ASOS older (AK 2026-10-14) |

### Live confirmation (2026-10-14 23:56–23:58 KST; keys loaded in-process, never printed)

| Call | Result |
| --- | --- |
| `GET https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min` | 200 `text/html` EUC-KR, 467,734 B, 745 stations, page 2026.10.14.23:54 |
| `…/nph-aws_txt_min?202610142200&0&MINDB_60M&0&m` | 200, 745 rows of 22:00 |
| `…/weather/observation/currentweather.jsp?tm=2026.10.14.22:00` | 200 `text/html;charset=UTF-8`, 97 rows, page 23:00 (latest only) |
| ASOS hourly `stnIds=108`, 20261007 00 – 20261013 23 | `00`, 168 items, one page |
| ASOS daily `stnIds=108`, 20261007 – 20261013 | `00`, 7 items |
| ASOS hourly without `stnIds` / `stnIds=0` / `stnIds=108,112` | `11` / `03` / `02` |
| `getUltraSrtNcst` 60,127 at −23 h / −24 h | `00` 8 items / `10` "최근 1일 간의 자료만 제공합니다." |

### Calls per path

Acquisitions, which also hold when a call fails; each acquisition makes at most two HTTP attempts per page:

- AWS minute: at most one per 2 minutes (≤ 30/h, ≤ 720/day).
- AWS hourly: the latest and previous hours ≤ 6/h each until acquired. The backfill acquires each missing hour of the 8-day window at most once per 6 hours: 190 once at a cold start, ≤ 190 per 6 h during an outage.
- City: ≤ 6/h while missing.
- ASOS: one recovery run per mapped station at most once per hour. That is 2 calls cold, then ≤ 2 per station and day, plus hourly runs while ranges stay incomplete (≤ 8 pages per range).
- Station geocoding: once per unseeded station address.

### Scenarios

| ID | Goal | Proof |
| --- | --- | --- |
| C1 | Pages parse like cheerio | `stations::observation_pages_parse_like_legacy`, merge test |
| C2 | Savers, registry and station answers | `stations::station_store_saves_and_answers_like_legacy` (5 oracle scenarios) |
| C3 | ASOS store and plan like `Recovery.run` | `asos::asos_history_store_rebuilds_like_legacy_recovery` (live 108 bodies, December, rejections) |
| C4 | ASOS provider page checks | `asos::asos_acquisition_checks_pages_like_the_legacy_provider` (loopback stub) |
| C5 | Chain with the read enabled | `parity::all_oracle_scenarios_match_legacy_bytes` (85, 9 new) |
| C6 | Single-flight, publish, fresh process from S3 | `observe::station_and_history_inputs_are_acquired_once_published_and_answered` |
| C7 | 3-second answer, completion for the next request | `observe::late_acquisitions_answer_as_absent_data_and_complete_for_the_next_request` |
| C8 | Seed converter and importer | `observe::station_seed_converter_keeps_export_lines_and_rejects_other_fields`, `observe::the_registry_starts_from_the_imported_legacy_seed` |
| C9 | Coverage never forwards | `coverage::coverage_fills_recent_hours_from_kma_and_older_hours_from_asos` and the reworked suite |
| C10 | Settings fail closed, no provider in the smoke | `runtime::kma_requires_data_go_kr_keys_daily_units_and_valid_provider_roots`, `kma_smoke.py` |

### Open decisions and limitations

- `_updateRnsHitRate` is ported but not wired: legacy runs it only from `/gather` against the
  retired `KmaStnMinute`, and v000903 applies neither the 0.5 rule nor the mountain filter.
  Wiring it would change answers legacy serves (decision pending).
- Not reproduced: legacy hourly re-runs at minutes 4/9/15/30 (one acquisition from minute 15),
  city fields of backfilled hours, registration timing of unseeded stations (first fold, page
  order), and the `ASOS_HISTORY_STATIONS` allowlist (every registry city station is a candidate).
- AWS-page rows used for ASOS hours are labelled `KMA_ASOS` in provenance (with `origin` stored).
- The `kmastninfos` export and import against production are separately authorized actions.

## S15b-2s station registry seed (2026-10-15)

AK authorized a one-time read-only export of the legacy `kmastninfos` on 2026-10-15. It ran with
`find` only, and the connection URL was loaded in-process and never printed or stored. It returned
776 documents at `2026-10-15T00:34:30.549Z`. Converted by `export_station_seeds.py`, the seed is
carried as provenance-labelled static data (`domestic/kma/source/data/kmastninfos.seed.jsonl`;
public station facts only). The registry starts from it before any page arrives, so seeded
stations need no geocoding and keep `rnsHit`, `rnsCount` and `isMountain`. A repeated `stnId` is kept as legacy
holds it (`965` and `989` appear three times each in the export). A newer export published by `station_seed_import`
replaces the carried one.

Cutover steps (AK 2026-10-15):

1. A final read-only export is imported at cutover.
2. Once legacy is retired, server2 takes over updating `rnsHit`/`rnsCount` with the ported
   `_updateRnsHitRate` (`source/rnshit.rs`). It stays unwired while legacy runs, as legacy
   behaves on the v000903 path, with no runtime flag.

Declaration: [S15b-2s.json](../server2/config/tasks/S15b-2s.json). Base: master `dbf3a4bc`.

### Scenarios (S15b-3b)

Declaration: [S15b-3b.json](../server2/config/tasks/S15b-3b.json).

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| L1 | App user in any town | Snapshot | `area_no`/`area_no_near` equal the rebuilt `areaNoList` readers | B3-1; `life::area_numbers_*`, `life_s3::the_snapshot_*` |
| L2 | User after UV/pollen issuances | Snapshot at an instant between runs | `life_index` equals `_fromLifeIndexDb2` | B3-1; `life::life_index_*`, `life_s3::life_inputs_restore_*` |
| L3 | First user of a UV slot | No current issuance; two requests | One acquisition, published before use, both served | B3-2; `life_s3::missing_national_*` |
| L4 | User while UV is slow | Acquisition slower than the deadline | Request within its deadline without the issuance; next request has it | B3-3; `life_s3::a_slow_acquisition_*` |
| L5 | Out-of-season pollen | Provider `99` | Asked once per issuance | B3-2; `life_s3::missing_national_*` |
| L6 | MFDS outage | 503 | Slot asked once, answer without fsn | B3-2/B3-3; `life_s3::an_mfds_slot_*` |
| L7 | Rise/set | KASI capture with failing areas | Other areas captured; answers equal `getRiseSetList` | B3-1/B3-2; `life::kasi_*`, `life_s3::the_kasi_capture_*` |
| L8 | Pollen day+3 | Provider `twodaysaftertomorrow` | Kept in `pollen_day3`, absent from the legacy answer | B3-4; `life::pollen_day_three_*` |
| L9 | Operator enables `kma` | No new setting; MFDS at the legacy endpoint (keys and units: S15b-2) | Production root; loopback roots only through the test constructor | B3-5; `life_s3::life_settings_*` |

Live record (2026-10-15, keys loaded in-process from `server/.env`, nothing stored outside the
local S3 peer): raw probes of UV, the three pollen kinds (oak and pine `99`), KASI and MFDS (with
and without the legacy User-Agent); the server2 acquirer published UV (4 pages, about 9 s), weeds
pollen (4 pages), KASI 서울 and MFDS into the local peer twice, oak answered no data, and the folds
answered from them. The OpenWeather 401 of S15b-3a came from the first of two `OWM_SECRET_KEY`
assignments; the last one (dotenv's) answers 200.

### Scenarios (S15b-3c)

Declaration: [S15b-3c.json](../server2/config/tasks/S15b-3c.json). Base: master `0997d702`.

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| F1 | Decoder | Nine synthetic GIFs (two streams longer than their frame) | Every frame equals get-pixels 3.3.2 | C3-1; `air_forecast::gif_frames_equal_get_pixels` |
| F2 | Forecast rows | Ten `do` runs of characterized animations (skip, 54-frame 17-cycle, missing PM2.5 path, broken legend, 47 frames, a 12 cycle), eight stations | Rows, errors and `getForecast` answers equal legacy master | C3-1; `air_forecast::hourly_forecast_rows_*` |
| F2b | #2757/#2762 regression cases | The 46 harness cases and the cycle-start arithmetic | Same rows or rejection | C3-1/C3-2; `air_forecast::the_legacy_image_regression_cases_*`, `cycle_starts_equal_legacy` |
| F3 | App user (`kaq`) without KAQ data | Replay of `air-kaq-forecast` with KAQ hidden | `forecastSource` `airkorea`, the hourly rows and AQI, no KAQ-only days | C3-3; `air_forecast_s3::a_kaq_request_without_*` |
| F4 | App user (`kaq`) with KAQ data | Parity replay | Legacy bytes | C3-3; `parity::all_oracle_scenarios_*`, `air_forecast_s3::a_kaq_request_without_*` |
| F5 | Widget/web (`airkorea`) and the store | S3 snapshot | `airkorea` rows from S3, `kaq` rejected with the legacy error | C3-1/C3-3; `air_forecast_s3::the_snapshot_answers_*` |
| F6 | First users of an announcement | Two concurrent requests, loopback provider | One acquisition, published before use, both served | C3-4; `air_forecast_s3::a_missing_image_forecast_*` |
| F7 | User while the images are slow | 2 s per image | Request within its deadline without the forecast; a later one has it | C3-4; `air_forecast_s3::a_slow_image_*` |
| F8 | Process across announcements | Another host's acquisitions, one late of the previous day, no publication count change | Folded in completion order within a minute, equal to a cold read | C3-4; `air_forecast_s3::other_hosts_acquisitions_*` |
| F8b | New station list | Overlapping requests with the old and new list | Decoded at once for the new list | C3-4; `air_forecast_s3::a_new_station_list_*` |
| F9 | Unpublished or rejected announcement | Expected documents missing, a 12 cycle or without PM2.5 | The previous announcement is acquired unless stored | C3-4; `air_forecast_s3::the_expected_announcement_*` |
| F10 | Provider data legacy rejects | Another host, a 12 cycle, no PM2.5 path; a 404 | Never fetched; nothing stored | C3-4; `air_forecast_s3::rejected_image_paths_*`, `image_paths_are_fetched_*` |
| F14 | Late 23시 announcement | Read on the fourth day | Kept until its rows expire | C3-4; `air_forecast_s3::a_late_announcement_*` |
| F15 | Same-millisecond acquisitions | Two groups at one instant | Both folded | C3-4; `air_forecast_s3::acquisitions_completed_in_the_same_*` |
| F16 | Malformed image | Cyclic LZW chain | Error, not a hang | C3-4; `air_forecast::a_cyclic_lzw_stream_*` |
| F11 | Operator | Legacy calibration names | Deployed values when unset or empty | C3-2/C3-5; `air_forecast::the_calibration_reads_*` |
| F13 | Hostile image | Huge frames, too many frames | Refused before allocation | C3-4; `air_forecast::gifs_beyond_the_decoding_bounds_*` |

Live record (2026-10-15; settings read in-process from `server2/.env`, never printed; records
only in a local S06 test peer started with room for the GIFs): dust forecast, station list and
nationwide calls through the request path; the server2 acquirer fetched the 23-cycle pair the
`11시 발표` documents named (sha256 equal to the #2757 evidence) and the 17-cycle pair the `17시 발표`
documents named (54 frames), and the server2 decoder and the legacy master controllers stored the
same 384 and 432 rows for the four smoke reference points. Some provider calls
were slow or timed out (raw station-list pages took over 30 s for two keys, then 0.2-0.4 s); the
downloaded images were deleted after the check.

## S15b-4 native KMA without legacy forwards (2026-10-15)

Base: master `c48b29aa`. S15b-4 is split into three PRs
([#2742 comment](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6194920828)):

| PR | Content |
| --- | --- |
| S15b-4a | Request-time acquisition of the missing forecast inputs: latest grid publications, the grid backfill, RSS, mid forecasts, the forecast-zone list and the warning cycle |
| S15b-4b | Unknown-town geocoding and storage, the two S15 declared forwards, removal of every remaining forward reason, the S3-only parity harness with matched/forwarded/total counts, the KMA shadow family module and the release/S19 smokes |
| S15b-4c | Cold-cell latency (warm per-cell memory, exact-raw packs, the bounded local disk cache) and the measured EC2 disk sizing |

### S15b-4a request-time forecast acquisition

Declaration: [S15b-4a.json](../server2/config/tasks/S15b-4a.json).

**Sources and which was followed.**

| Input | Provider documentation | Legacy collection | Legacy answer when absent |
| --- | --- | --- | --- |
| Current, ultra-short and short grids | [VilageFcstInfoService_2.0](https://www.data.go.kr/data/15084084/openapi.do) (`getUltraSrtNcst`, `getUltraSrtFcst`, `getVilageFcst`; development account 10,000 per day) | `controllerManager.js:2433` (current at minutes 2, 12, …), `:2444` (ultra-short at 47, 54, 4, 14), `:2423` (short at 12); backfill `PastConditionGather.js:22` ("kma 1.2부터는 23시간 전까지만 제공함"), `:2353-2356` | `controllerTown.js:4407-4421` (`find` empty: "there is no data"; S15 assembly reproduces it from an empty collection) |
| Short RSS | `www.kma.go.kr/wid/queryDFS.jsp?gridx&gridy` (keyless; no published specification) | `controllerManager.js:2382-2385` (hourly, in the minute-2 block from `:2338`) | `controllerTown.js:494` over an empty collection |
| Mid forecasts | [MidFcstInfoService](https://www.data.go.kr/data/15059468/openapi.do) (`getMidFcst`, `getMidLandFcst`, `getMidTa`; issued at 06:00 and 18:00) | `controllerManager.js:2365-2376` (minute-2 block) | `controllerTown.js:4535` (`_getMidDataFromDB`) |
| Forecast-zone list | [FcstZoneInfoService](https://www.data.go.kr/data/15057111/openapi.do) (`getFcstZoneCd`) | `controllerManager.js:2530-2534`: `getFromKma()` once at process start | `controllerTown.js:4505-4514`: an empty `find` is the "error to get forecast zone" error |
| Warnings | [WthrWrnInfoService](https://www.data.go.kr/data/15000415/openapi.do) | `controllerManager.js:2668` (`time % 3 == 0`); `kmaWarningRequester.js:17-20` (same `DONGNAE_SECRET_KEYS`, 30 s timeout) | `controllerTown24h.js:1924-1934`: a store error skips `specialInfo` |

Followed: legacy cadence and absent-data answers. Where server2 cannot run legacy's schedule for every
cell, it acquires the same publication on demand, as S15b-2 and S15b-3 do (O-9: published through S06
before use).

**Live confirmation** (2026-10-15 23:35 KST; keys loaded in-process from `server2/.env`, never
printed; 9 calls; nothing stored):

| Call | Result |
| --- | --- |
| `getUltraSrtNcst` 60,127 `base_time` 2200 | `00`, 8 items |
| `getUltraSrtFcst` 2230 | `00`, 66 items |
| `getVilageFcst` 2300 | `00`, 980 items (one 999-row page) |
| `getMidFcst` `stnId` 109 `tmFc` 202610151800 | `00`, 1 item |
| `getMidLandFcst` 11B00000 | `00`, 1 item |
| `getMidTa` 11B10101 | `00`, 1 item |
| `getFcstZoneCd` page 1 | `00`, 755 items (one 1,000-row page) |
| `getWthrWrnList` `stnId` 108, today | `00`, 5 items |
| `wid/queryDFS.jsp` 60,127 | 200 `text/xml`, `tm` 202610152300 |

**Calls per path.** Each data.go.kr page attempt is one S08 unit on the key's quota owner (one per
key and KST day, shared by every service of these keys). An acquisition retries a failed page once
(two attempts, S08 executor), so its worst case is twice its pages.

| Path | Calls when it succeeds at once | Worst case | Retry bound |
| --- | --- | --- | --- |
| Missing latest grid publication | 1 page per family and cell (the live `getVilageFcst` answer, 980 rows, fits one 999-row page) | 5 pages × 2 attempts | 5 minutes per publication |
| Grid backfill | ≤23 current + 23 ultra-short + 7 short pages for a cold cell, 3 in flight per pass, 8 passes per process | the same × 2 attempts × pages | one pass per cell, family and latest publication (at most hourly). Each publication shares the latest acquisition's flight and 5-minute retry bound, so a running one is joined and a recent failure is not asked again. A publication still missing is asked by the next pass. |
| Missing latest RSS | 1 keyless GET per cell | 2 attempts | 5 minutes |
| Missing latest mid publication | 1 page per collected region (3 regions per town, shared by every town of the region) | × 2 attempts | 5 minutes |
| Forecast-zone list | 1 page (755 zones live) once per process | 10 pages × 2 | once per process |
| Warning cycle | Unchanged cycle: 4 calls (`getPwnStatus` and the three bulletin lists; `collector.rs:130-138`, `:373-386`). Shared by every request. | Plus a zone sync (`getPwnCd` per planned day, 10 days at most per sync) hourly, on a new announcement or on bootstrap; announcement documents; pagination (20 pages at most per list); each key tried once on auth or quota errors | one cycle per 3 minutes while requests arrive, never two at once |

**Baseline per active cell and KST day** (successful single-page answers): 24 current + 24
ultra-short + 8 short = 56 units, plus 8 keyless `queryDFS` acquisitions: one per RSS
publication (`rss_latest`, every 3 hours), where legacy polls hourly. A cold cell adds up to 53 units
once. On top of that, the same budgets fund:

- shared work: mid regions (6 units a day per region), the zone list, and warning cycles. Under
  continuous demand an unchanged cycle costs 4 units every 3 minutes (1,920 a day), plus the hourly
  zone sync, announcement work, the bootstrap and pagination;
- the other S15b consumers of these keys: ASOS (S15b-2), UV, pollen and KASI (S15b-3b);
- retries and extra pages.

### Scenarios (S15b-4a)

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| Q1 | First user of a cell with no stored forecast | Snapshot with every grid, RSS, mid and zone input missing | No forward; the acquired current publication is used in the same request; the others answer legacy's empty collections; `forecast_zone` answers `[]` (legacy's empty `find`, `controllerTown.js:4505-4514`) | `source_s3::missing_inputs_are_acquired_at_request_time_and_never_forwarded` |
| Q2 | Next user of the cell | Second request | No repeated acquisition (retry bounds); one backfill pass of 23 current hours | same test |
| Q3 | User while every forecast provider is slow | Every forecast acquisition takes 6 s; 20 s deadline | The request waits once, at most 3 s, for all of them (15.2 s before the shared bound) | `source_s3::a_request_waits_for_late_acquisitions_once_within_three_seconds` |
| Q4 | User while every provider is slow, through the gateway | Forecast, life and AirKorea acquisitions take 6 s; the gateway's 3 s native attempt | Answered natively before the attempt ends. Waits stop 500 ms before the deadline. The warning state and the air and life reads stop 300 ms before it, which leaves the assembly its time. Before this fix the request was forwarded on a mid read timeout. | `source_s3::a_request_answers_within_the_gateway_attempt_while_every_acquisition_is_slow`, `source_s3::the_kma_backend_serves_within_the_gateway_attempt_while_every_acquisition_is_slow` (`KmaBackend` under the gateway's `timeout_at`) |
| Q5 | Six first users of a cell at once | Concurrent snapshots | One acquisition of the latest publication, used by all six | `source_s3::concurrent_first_requests_share_one_acquisition_per_publication` |
| Q6 | Warning cycle with rejected keys | Keys A and B not registered, C valid | A, B, then C once around the list; later requests start with C (legacy `kmaWarningRequester.get`) | `source_s3::warning_requests_rotate_through_every_key_and_keep_the_one_that_answered` (before: A, B repeated) |
| Q7 | A collected mid region with no record and no acquirer | Snapshot | Legacy's empty answer | `source_s3_oracle` (11D10000) |
| Q8 | Operator enables `kma` | No new setting | The `kma` phase answers natively from S3; its acquisitions reach only the loopback provider roots | `tools/kma_smoke.py` |
| Q10 | User of a cell whose stored grid records legacy would not keep | Current 10:00 and 09:00 stored with `t1h` -50; short 08:00 stored incomplete | All three are acquired again, under the same bounded retries (`PastConditionGather.js:80-90`, `controllerManager.js:1212-1215`); valid stored hours are not (before: none were) | `source_s3::stored_acquisitions_legacy_would_not_keep_are_acquired_again` |
| Q9 | First user of a new hour while the previous latest publication is still being acquired, or just failed | The 10:00 acquisition is slow (4 s) or fails; the clock moves to 11:50 | The new backfill pass joins the running 10:00 flight or skips the recent failure; 10:00 is asked once (before: twice) | `source_s3::a_backfill_pass_joins_a_publication_a_latest_acquisition_is_still_asking`, `source_s3::a_backfill_pass_skips_a_publication_a_latest_acquisition_just_failed` |

### Open decisions and limitations (S15b-4a)

- **Quota.** S08 funds every data.go.kr service of these keys from one built-in 10,000 units per
  key and KST day (S15b-2). 10,000 is the published development-account allowance; the approved
  production allowance of these keys is not known here.
  - With the baseline above, one key covers at most about 170 continuously active cells, before
    the shared and other consumers.
  - Legacy collects every town with the same keys, so the production keys likely have
    operating-account quotas.

  Options:
  - (a) keep 10,000;
  - (b) set the built-in per-key units to the approved operating quotas (AK to give the values);
  - (c) account per service, as data.go.kr does.
- Until legacy retires, legacy and server2 spend the same keys.
- The `queryDFS` RSS has no published specification; its shape is the S13 characterization.
- **Owned work outlives requests.** Provider calls, publications and warning cycles run in their
  own tasks. An owned bound (S13d, 600 s at most) never cancels them; it only stops tracking.
  - A backfill pass whose bound ends leaves its unstarted publications to the next pass.
  - Retry keys are bounded at 65,536 (expired keys pruned; beyond that new acquisitions are
    skipped and S3 answers as stored).

## S15b-4b (2026-10-16)

S15b-4b is split into three PRs
([#2742 comment](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6206378683)):

| PR | Content |
| --- | --- |
| 4b-1 | Legacy replies outside the router list, the V8 `Date.parse` port, unpaired surrogates, grids outside KMA, defects as dependency failures (no provider) |
| 4b-2 | Unknown towns (`_findTown` → `convertGeocode`: Kakao address search, then Google), the town addition stored in S3, the `KR` remap (`geo.name2address`); removal of the remaining forward mechanism |
| 4b-3 | S3-only parity counts, the KMA shadow family module, the KMA release and S19 smokes |

### S15b-4b-1 legacy replies outside the router list

Declaration: [S15b-4b1.json](../server2/config/tasks/S15b-4b1.json). Base: master `a9b3a23d`.

**Sources and which was followed.**

| Path | Legacy | Followed |
| --- | --- | --- |
| Escaped exception, `next(err)` | `app.js:167-197`: the handlers take three arguments, so Express skips them as error handlers; finalhandler 0.4.1 (`express` 4.13.4, `server/package-lock.json`) | Production body `Internal Server Error\n`, as the oracle recorded for `query-malformed-escape` |
| End of the router list | `app.js:168-172` 404 middleware → finalhandler | 404 `Not Found\n` |
| Coordinate outside Korea | `controllerTown.js:170-174` `res.redirect`, `_getUrlWithCoord` `:5648-5659` | 302; the body carries the legacy default `apiServer.url`, and the gateway never relays a non-200 body |
| `Date.parse` | Node 16.20.2, V8 9.4 `src/date/dateparser*.{h,cc}`, `src/builtins/builtins-date.cc` | Full port, compared with the binary |
| Unpaired surrogates | V8 strings are UTF-16; Node 16 `JSON.stringify` is well-formed | Stand-in code points, mapped back wherever code units matter |
| `mCoord` outside the grid | `_getTownDataFromDB` `find({'mCoord.mx', 'mCoord.my'})` returns nothing (`controllerTown.js:4407-4421`) | Empty grid collections, no acquisition |

**Live calls:** none. No provider is involved.

### Scenarios (S15b-4b-1)

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| N1 | Malformed escape in the query | Oracle `query-malformed-escape` | Express 500, matched natively (before: forwarded) | `parity::all_oracle_scenarios_match_legacy_bytes` |
| N2 | Station page with a small year | Oracle `stn-small-year-datetime` | Matched natively (before: forwarded) | same |
| N3 | Any date string | Corpus of 20,388 strings (TimeClip and offset-wrap edges included) | Equal to Node 16.20.2 `Date.parse` | `v8_date::date_parse_equals_node_16_on_the_recorded_corpus`, `time::tests` |
| N4 | `next(err)`, escaped exception, redirect, defect | Unwinding payloads | 500, 500, 302, defect | `chain::tests::replies_outside_the_router_list_are_answered_natively` |
| N5 | Outside-Korea redirect URL | Query keys and values | `_getUrlWithCoord` string | `chain::tests::the_redirect_url_follows_get_url_with_coord` |
| N6 | Emoji cut in half | `substr`, concatenation, comparison | Node 16 semantics | `js::tests::coercion_follows_javascript` |
| N7 | Store row without `shortData` (async callback) | Replay | 500 (before: forwarded) | `replay::an_exception_in_a_store_callback_is_not_caught_by_an_earlier_try` |
| N8 | Query with bracket syntax, prototype names, empty keys | Known town through `KmaBackend` | Served natively (before: forwarded) | `source_s3::qs_query_structure_is_answered_natively` |
| N9 | Any query string | Corpus of 8,025 queries | Equal to Express 4.13.4 / qs 4.0.0 `req.query` (JSON and prototype reads) | `qs::req_query_equals_express_4_13_4_on_the_recorded_corpus` |
| N10 | S3 unreadable | Malformed listing | Dependency failure, no forward | `source_s3::an_s3_read_failure_is_a_dependency_failure_not_a_forward` |
| N11 | A path the routes do not take | Too many segments, malformed escape | 404 / 400 natively | `backend::tests::gateway_paths_parse_like_express` |
