Task: issue-2729-s13a; owner: Claude builder (S13a worktree); revision/base: 45e9193b6a6d6168314eea0c48a6c1bf1c46d6cb; date: 2026-10-13.
Inputs: [intent](../intent/issue-2729.md), [spec](../specs/issue-2729.md). Declaration: [S13a.json](../server2/config/tasks/S13a.json).
Design stage: skipped with reason. The flows reuse the S08 admission/funding and S06 publication
sequences already documented; outside paths are limited to `docs/architecture/server2.md`, so no
new diagram is added. The server2 design text records the contracts.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| F1 | S15 needs AirKorea station data for one sido | Stub serves two ordered pages (100 + n rows) with `returnType=json` requests | Two exact records in one group; request pairs equal legacy; an inconsistent page 2, a foreign sido or a duplicate row yields no records | AC1/AC2; `formats::airkorea_*` |
| F2 | S15 needs sunrise/sunset for an area | Ring has two keys; stub answers 401 then a KASI item | Rotation to key B, one exact record keyed by area; `_type=json` and `ServiceKey` sent | AC1/AC2; `formats::riseset_*` |
| F3 | S15 needs forecast-zone codes | Stub answers the zone list with `resultMsg OK` | One exact record; `type=json`; a truncated list (totalCount > rows) or `resultMsg` error yields nothing | AC1/AC2; `formats::zone_*` |
| F4 | Operator's key is rejected or quota is used | Gateway XML/JSON envelopes, codes 22/30/31, provider error codes | No record; ring advances for KASI/zone; AirKorea stops without rotation | AC2; `formats::rejection_*` |
| F5 | Overseas user requests weather with air | Native world with LiveAir, loopback Google/OpenWeather/WAQI stubs, S08 budgets | Legacy order; down marking after 401/429; budget exhaustion skips; first usable observation wins; one fetch per cell | AC3; `air::chain_*` |
| F6 | Operator restores after replacement | Run the S11 oracle air scenarios with a WAQI stub, then a new engine with providers disabled and empty memory | Same bytes from S3 only; missing records give no air, not a fabricated value | AC3; `air::restore_*` |
| F7 | Privacy reviewer checks archives | Requests at precise coordinates in one cell | Keys, catalogs, bodies and provider requests contain only the cell coordinate | AC4; `air::privacy_*` |
| F8 | Reviewer checks compatibility and placement | Run full tests, placement gate, local world runtime defaults | S11/S12/S13 tests unchanged and passing; native off by default; only declared paths | AC5; full suite, check_placement.py |
| F9 | Release-mode integration | Release build: loopback provider stubs and the S3 peer | Domestic groups publish and read back byte-identical; air restore from S3 | AC1/AC3; `formats::smoke_*`, `air::smoke_*` |

## Files

- Change: `server2/src/budget/model.rs`, `server2/src/providers/{mod,transport,acquisition,rejection}.rs`,
  `server2/src/domestic/{mod,family,acquire}.rs`, `server2/src/world/{mod,air,runtime}.rs`.
- Add: `server2/src/domestic/{airkorea,riseset,zone}.rs`, `server2/src/world/{air_chain,air_store,air_transport}.rs`,
  `server2/tests/formats.rs`, `server2/tests/formats/**`, `server2/tests/air.rs`, `server2/tests/air/**`.
- Docs: intent/spec/plan `issue-2729.md`; one S13a section and S11/S13 sentence updates in `docs/architecture/server2.md`.
- Not changed: `plans/issue-2614.md`, Cargo manifests, legacy `server/`.

## Order

1. Declaration and issue comment. 2. Red tests. 3. Transport format, classifier and provider
identities. 4. Domestic families. 5. World air parsers, transport, store, chain, runtime.
6. Green, refactor, fmt/clippy/test, placement, release smoke, artifact policy. 7. Docs, commit,
push, PR, CI, Codex review loop, readiness.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `cargo +1.99.0 test --release --locked --test formats smoke`
and `--test air smoke`; `python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S13a.json --base 45e9193b`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing `ResponseFormat`, domestic request types and `world::LiveAir`.

## Rollback and blast radius

Library code plus an opt-in loopback-only runtime variable. Shared changes are additive: the
default format and `classify` are unchanged and the new provider variants are rejected by the
shared funded transport. Native world and domestic families stay off by default. Revert the PR
to roll back.
