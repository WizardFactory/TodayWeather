Task: issue-2741-s13b; owner: Claude builder (S13b worktree); revision/base: ae21b6cc6525d4b51fd879469f9b573ebceb4fe6; date: 2026-10-14.
Inputs: [intent](../intent/issue-2741.md), [spec](../specs/issue-2741.md). Declaration: [S13b.json](../server2/config/tasks/S13b.json).
Design stage: skipped with reason. The change reuses the S08 funding and S06 publication flows
already documented; no new component or flow is added, so no diagram changes. The server2
design text records the record contracts for S15b.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| B1 | S15b needs the day's dust forecast | Stub serves the legacy `frcst.json` page for `searchDate` | One exact `airkorea-dust-forecast` record, period 23:00 of the day; query pairs equal legacy; a missing field, a 10-of-28 page or `03` yields nothing | AC1/AC2; `formats::dust_forecast_*` |
| B2 | S15b needs station coordinates | Stub serves `msrstn.json`, then a two-page list | Exact `airkorea-station-list` records in order; no `ver`; a bad `dmX`, a duplicate or a `serviceKey` echo yields nothing | AC1/AC2; `formats::station_list_*` |
| B3 | Operator's AirKorea keys include an expired one | Three keys; the last answers 401 `31` | Request moves to the previous key, restarts page 1, remembers it; quota `22` (also with 401) stops; all rejected → Auth | AC1; `formats::airkorea_keys_*` |
| B4 | S15b needs forecast-zone codes | Stub serves a 755-item page, then 1000 + 5, then 1000 + `03` | One or two exact `forecast-zone` records; `dataType=JSON`, `numOfRows=1000`; mismatched echo, bad item, duplicate, `03` first, eleventh page → nothing | AC1/AC2; `formats::forecast_zone_*` |
| B5 | Reviewer checks compatibility | Full suite and placement gate | S13/S13a tests pass, the newsky2 path is gone, only declared paths changed | AC3; full suite, check_placement.py |
| B6 | Release-mode integration | Release build, loopback stub, S3 test peer | Each kind publishes and reads back byte-identical | AC2; `formats::smoke_*` |

## Files

- Change: `server2/src/domestic/{airkorea,zone,acquire,family,publication}.rs`, `server2/src/providers/{transport,rejection}.rs`, `server2/tests/formats/**`.
- Add: `server2/config/tasks/S13b.json`, fixtures `airkorea-forecast.json`, `airkorea-station-list.json`, `forecast-zone.json` (replaced).
- Docs: intent/spec/plan `issue-2741.md`; S13b section and S13a/S15 sentence updates in `docs/architecture/server2.md`.
- Not changed: `plans/issue-2614.md`, Cargo manifests, `budget/`, legacy `server/`.

## Order

1. Declaration and issue comment. 2. Red tests. 3. Providers (format removal, 401/403 rule).
4. Domestic requests, key selection and zone paging. 5. Green, refactor, checks, release smoke.
6. Docs, commit, push, PR, CI, Codex review loop, readiness.

## Checks

`cargo +1.99.0 fmt --check`; fresh `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `cargo +1.99.0 test --release --locked --test formats smoke`;
`python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S13b.json --base ae21b6cc`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing request constructors, key selection and the getFcstZoneCd path.

## Rollback and blast radius

Library code only; no route, scheduler or setting uses these requests yet. The shared
provider change removes an unused format and narrows one AirKorea-only classification. Revert
the PR to roll back.
