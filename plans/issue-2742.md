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
| L9 | Operator enables `kma` | Key without units, bad MFDS root | Refused | B3-5; `gateway::runtime::kma_life_*`, `life_s3::life_settings_*` |

Live record (2026-10-15, keys loaded in-process from `server/.env`, nothing stored outside the
local S3 peer): raw probes of UV, the three pollen kinds (oak and pine `99`), KASI and MFDS (with
and without the legacy User-Agent); the server2 acquirer published UV (4 pages, about 9 s), weeds
pollen (4 pages), KASI 서울 and MFDS into the local peer twice, oak answered no data, and the folds
answered from them. The OpenWeather 401 of S15b-3a came from the first of two `OWM_SECRET_KEY`
assignments; the last one (dotenv's) answers 200.
