Task: issue-2699-s14; owner: Claude builder (S14 worktree); revision/base: 47a96078; date: 2026-10-13.
Inputs: [intent](../intent/issue-2699.md), [spec](../specs/issue-2699.md). Declaration: [S14.json](../server2/config/tasks/S14.json).
Design stage: skipped with reason. Outside paths are limited to `docs/architecture/server2.md`;
the flow reuses the S06 publication and S08 admission sequences, and the spec records the
demand, capture and coverage contract.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| H1 | Operator seeds legacy history before cutover | Run the converter on v1/v2/station `mongoexport` files, import twice with two export instants, read back | Seed documents equal the export lines; both revisions retained; current rows equal the legacy read projection; arrays, unknown collections or extra fields are rejected | AC1; `legacy::*` |
| H2 | S15 asks for a cell's 8-day inputs | Exports up to E and captures after E, then coverage at t | `Complete` with 192 slots, yesterday slot and `2400` attribution; any missing publication yields `Legacy` | AC1/AC2; `coverage::*`, `schedule::windows_*` |
| H3 | App user opens a never-requested or resumed cell | No demand or demand expired over 8 days ago; touch; capture backfill; coverage | Touch returns New/Resumed; backfill fetches 23 slots; coverage stays `Legacy` naming the gap until every publication is present; no ASOS substitution | AC2/AC3; `coverage::cold_*`, `capture::backfill_*` |
| H4 | Privacy reviewer checks demand records | Write demand; read raw bytes; load records with extra fields or mismatched keys | Only grid, lastDemandMs, expiresMs (push: aggregate cells); invalid objects rejected and never active | AC2; `demand::*` |
| H5 | Spot replacement | Touch cells and capture; drop the process; rebuild demand and index from S3 | Same active set and captured set; no re-fetch of present publications | AC2/AC3; `smoke::*`, `demand::rebuild_*` |
| H6 | Operator checks quota policy | Ticks with and without demand, expired demand, budget exhaustion, per-tick cap, second owner | Requests only for active cells at recorded intervals; minute page every 2 minutes only with demand; funding error stops the tick; second owner refused | AC3; `capture::*` |
| H7 | Release-mode integration | Loopback provider stub and S3 peer; touch, tick, publish, restart, rebuild, coverage, import, readback | Published groups and exports read back byte-identical | AC1-AC3; `smoke::*` in `--release` |
| H8 | Reviewer checks placement | Placement gate with S14.json | Only declared paths changed; no legacy runtime dependency | AC4; `check_placement.py` |

## Files

- Add: `server2/src/history/{mod,demand,transport,schedule,index,coverage,capture,legacy,metrics}.rs`;
  `server2/tests/history.rs`, `server2/tests/history/*.rs` and fixtures;
  `server2/tools/migration/{export_history_seeds.py,history_seed_import.rs}`;
  `server2/config/tasks/S14.json`.
- Change (additive): `server2/src/lib.rs` (`pub mod history;`), `server2/Cargo.toml`
  (`[[example]] history_seed_import`; S12 adds a sibling example).
- Docs: intent/spec/plan `issue-2699.md`; one S14 section in `docs/architecture/server2.md`.
- Not changed: `server/`, `plans/issue-2614.md`, `server2/src/domestic/`, `server2/src/providers/`.

## Order

1. Declaration and issue comment. 2. Red tests (demand, schedule, capture, coverage, legacy,
smoke). 3. Demand state and adapter. 4. Schedule and index. 5. Capture runner. 6. Coverage.
7. Legacy converter/import/projection. 8. Green, refactor, fmt/clippy/test, placement, release
smoke, artifact policy. 9. Commit, push, PR, CI, Codex review loop, readiness.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `cargo +1.99.0 test --release --locked --test history smoke`;
`python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S14.json --base 47a96078`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing `server2::history` module.

## Rollback and blast radius

Library and offline tools only; no route, startup default or legacy change. Revert the PR to roll
back. Running the importer against production storage needs separate authority.
