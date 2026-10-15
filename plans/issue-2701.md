Task: issue-2701-s16; owner: Claude builder (S16 worktree); revision/base: 1d60f728; date: 2026-10-15.
Inputs: [intent](../intent/issue-2701.md), [spec](../specs/issue-2701.md). Declaration: [S16.json](../server2/config/tasks/S16.json).
Design stage: skipped with reason. The flow adds one post-response write and one internal
lookup; it reuses the S06 publication and S15b-2 acquisition sequences, and the spec records the
layout, eligibility and order. No Archify diagram changes.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| U1 | App user opens a town; the service keeps its daily history | Native v000903 KMA request with complete inputs | Response unchanged; complete days today-6..today-1 stored as grid summaries once; a repeat request writes nothing | AC1, AC3; `recorder_*`, `snapshot_*` |
| U2 | A day has too few hours | Current rows with 17 valid `t1h` hours, then 18 | 17: nothing stored; 18: stored; `0000` row counted for the previous day | AC1; `grid_*` |
| U3 | A late station page or ASOS range arrives | Record, then publish a late input that changes the day | New revision with a later input time; reader returns it; an older input set never supersedes | AC3; `late_*` |
| U4 | Inputs are still loading or a read failed | Station fold pending, history `cache-read-timeout`, ASOS run in flight | No summary inputs, nothing stored | AC3; `snapshot_*` |
| U5 | Product owner asks for last year (internal) | Lookup with grid present, grid absent, ASOS absent | Same date grid; else nearest dates and ASOS (one on-demand range call, stored); else VC; failures return Incomplete | AC4; `lookup_*` |
| U6 | World city on a DST day | VC bodies with 23, 24 and 25 local hours | Thresholds 18, 18, 19 hours; values in metric | AC2; `vc_*` |
| U7 | Restart or another process | Fresh recorder and lookup over the same S3 peer | Reads the stored newest revision; identical PUT is a verified 412 | AC3, AC4; `store_*` |
| U8 | Reviewer checks placement | Placement gate with S16.json | Only declared paths; no legacy dependency | AC5; `check_placement.py` |

## Files

- Add: `server2/src/summary/{mod,transport,store,grid,asos,vc,recorder,lookup}.rs`;
  `server2/tests/summary.rs`, `server2/tests/summary/*` with fixtures; `server2/config/tasks/S16.json`.
- Change: `server2/src/lib.rs` (module); `domestic/kma/{mod,chain,mid,backend}.rs` (capture of the
  `getPastMid` rows, `KmaStore::summary_inputs`, the backend sink); `domestic/kma/source/{mod,observe}.rs`
  (snapshot inputs and completeness); `history/transport.rs` (share LIST helpers);
  `world/{air_store,store}.rs` (admission permit, raw VC reads by date); `gateway/runtime.rs` (wire the
  recorder with `kma`).
- Docs: intent/spec/plan `issue-2701.md`; one S16 section in `docs/architecture/server2.md`.
- Not changed: `server/`, `plans/issue-2614.md`.

## Order

1. Declaration and issue comment. 2. Red tests. 3. Model, transport, store. 4. Grid/ASOS/VC
derivation. 5. Chain capture, snapshot inputs, recorder, wiring. 6. Lookup. 7. Green: fmt,
clippy, full tests, release `kma_smoke.py`, placement, artifact policy. 8. Docs. 9. Commit, push,
PR, CI, Codex review until PASS, readiness comment.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `python3 server2/tools/kma_smoke.py` on the release build;
`python3 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S16.json --base 1d60f728`;
`python3 scripts/check-artifact-policy.py --staged` and on outgoing commits. Live: one ASOS daily call
for a last-year range (2026-10-15, station 108, 2025-10-12..18: `00`, 7 items, 0.30 s).
Expected Red cause: missing `server2::summary`.

## Rollback and blast radius

The recorder runs only with the `kma` family, which stays off until S15b-4; it writes only
`summary/v2/` objects after a natively served response. Revert the PR to roll back; stored
summaries stay (no deletes) and are ignored by older builds.
