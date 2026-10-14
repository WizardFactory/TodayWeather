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

AWS minute ≤ 30/h (720/day); AWS hourly 1/h plus a one-time backfill of up to 190 hours; city
1/h (≤ 6/h while the page is stale); ASOS 2 per mapped station cold, then ≤ 2 per station and day
plus hourly retries of incomplete ranges; station geocoding once per unseeded station address.

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
