Task: issue-2700-s15; owner: Claude builder (S15 worktree); revision/base: 87ab79cd; date: 2026-10-13.
Inputs: [intent](../intent/issue-2700.md), [spec](../specs/issue-2700.md). Declaration: [S15.json](../server2/config/tasks/S15.json).
Design stage: skipped with reason. The request flow is the existing S10 gateway sequence plus one
forward outcome; the spec lists the middleware order and store boundary. The architecture text is
updated in `docs/architecture/server2.md`.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| K1 | App user opens Seoul weather (v000903 address route) | Assemble the oracle inputs at 2026-09-24T00:10Z | Same bytes and ETag as `domestic-v000903`; dependency calls in legacy order | AC1; `parity::all_oracle_scenarios_match_legacy_bytes`, `parity::s02_direct_goldens_equal_recorded_oracle_bodies` |
| K2 | User with another locale/units | Six locale/unit cases, `(null)` units, DB 1.0 rows | Byte parity, including F/mph/inHg/bft/kr and AQI units | AC1; `parity::*` (locale, unit, DB 1.0 recordings) |
| K3 | User during rain forecast (#2620) | Shortest POP covered, missing hour, old rows | Slot-hour POP replaced, kept when hour T lacks POP, integer POP | AC1; `parity::*` (`domestic-pop-*`, `domestic-old-no-pop`) |
| K4 | User of a cell with short history | Never-requested, partial, resumed-after-8-days current rows | Yesterday/comparison and daily rows exactly as legacy | AC1; `parity::*` (history recordings), `switch::native_kma_reproduces_s02_gateway_goldens_and_rolls_back` |
| K5 | User in a warning zone | Active zone row for the town | `specialInfo` and summary as legacy (ko) | AC1; `parity::*` (`domestic-special-info`, `warning-two-zones`) |
| K6 | Gateway caller (`/weather/v000903/coord`) | Native switch on; five gateway cases | Status, body and headers equal the goldens; legacy default; rollback | AC2; `switch::native_kma_reproduces_s02_gateway_goldens_and_rolls_back` |
| K7 | Cell the source cannot serve | Source returns Forward / store lacks the town | Request reaches the legacy origin; no native body invented | AC2; `switch::runtime_default_source_forwards_everything_to_legacy`, `switch::assembly_paths_legacy_cannot_share_are_forwarded`, `replay::*` |
| K8 | Operator measures the checkpoint | Release run of all recorded workloads | Time, peak RSS, CPU recorded | AC4; `examples/kma_checkpoint.rs` with `tools/kma_checkpoint.py` (local and Linux CI) |
| K9 | Reviewer checks placement | Placement gate with S15.json | Only declared paths changed | AC5; `check_placement.py`, `test_placement.py` |

## Files

- Add: `server2/src/domestic/kma/` (assembly, JS value model, store trait, backend, locales),
  `server2/tests/domestic.rs`, `server2/tests/domestic/` (parity, switch and replay tests, the
  recorded-store test double, oracle recording, PROVENANCE), `server2/examples/kma_checkpoint.rs`,
  `server2/tools/kma_checkpoint.py`, `server2/config/tasks/S15.json`.
- Change (additive): `server2/src/domestic/mod.rs` (`pub mod kma;`), `server2/src/gateway/backend.rs`
  (defaulted `fetch_or_forward` and the forward branch), `server2/tools/ci.py` (checkpoint).
- No runtime mode is added (AK, 2026-10-13). `kma` joins the S10c `SERVER2_NATIVE_FAMILIES` list
  (`server2/src/gateway/runtime.rs`, its test in `server2/tests/gateway/runtime.rs`);
  `server2/tools/kma_smoke.py` is the release check. The S19 KMA family waits for S15b.
- Docs: intent/spec/plan `issue-2700.md`; one S15 section in `docs/architecture/server2.md`.
- Not changed: `server/`, `plans/issue-2614.md`.

## Order

1. Declaration and issue comment. 2. Red: parity/switch tests against the base (missing
`server2::domestic::kma`). 3. JS value model, time/precipitation/policy helpers. 4. Middleware port
in route order, checked against a local per-middleware oracle trace and the oracle recording.
5. Backend, forward outcome, checkpoint. 6. Green, refactor,
fmt/clippy/test, release smoke, placement, artifact policy. 7. Commit, push, PR, CI, Codex review
loop, readiness and issue status.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `python3.11 server2/tools/kma_checkpoint.py --binary <release example>`;
`bash server2/deploy/smoke.sh --binary <release> --skip-reused` (existing families, unchanged);
`python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S15.json --base 87ab79cd`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing `server2::domestic::kma`.

## Rollback and blast radius

Library and a handler selected only by `kma` in `SERVER2_NATIVE_FAMILIES`, forwarding to legacy until S15b.
Revert the PR to roll back. Production switches remain S20.
