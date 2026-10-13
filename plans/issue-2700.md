Task: issue-2700-s15; owner: Claude builder (S15 worktree); revision/base: 87ab79cd; date: 2026-10-13.
Inputs: [intent](../intent/issue-2700.md), [spec](../specs/issue-2700.md). Declaration: [S15.json](../server2/config/tasks/S15.json).
Design stage: skipped with reason. The request flow is the existing S10 gateway sequence plus one
forward outcome; the spec lists the middleware order and store boundary. The architecture text is
updated in `docs/architecture/server2.md`.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| K1 | App user opens Seoul weather (v000903 address route) | Assemble the oracle inputs at 2026-09-24T00:10Z | Same bytes and ETag as `domestic-v000903`; dependency queries in legacy order | AC1; `parity::direct_*` |
| K2 | User with another locale/units | Six locale/unit cases, `(null)` units, DB 1.0 rows | Byte parity, including F/mph/inHg/bft/kr and AQI units | AC1; `parity::direct_*` |
| K3 | User during rain forecast (#2620) | Shortest POP covered, missing hour, old rows | Slot-hour POP replaced, kept when hour T lacks POP, integer POP | AC1; `parity::pop_*` |
| K4 | User of a cell with short history | Never-requested, partial, resumed-after-8-days current rows | Yesterday/comparison and daily rows exactly as legacy | AC1; `parity::history_*` |
| K5 | User in a warning zone | Active zone row for the town | `specialInfo` and summary as legacy (ko) | AC1; `parity::special_info` |
| K6 | Gateway caller (`/weather/v000903/coord`) | Native switch on; five gateway cases | Status, body and headers equal the goldens; legacy default; rollback | AC2; `switch::*` |
| K7 | Cell the source cannot serve | Source returns Forward / store lacks the town | Request reaches the legacy origin; no native body invented | AC2; `switch::forward_*` |
| K8 | Operator measures the checkpoint | Release run of all golden workloads | Time, peak RSS, CPU recorded | AC4; `performance` test, report |
| K9 | Reviewer checks placement | Placement gate with S15.json | Only declared paths changed | AC5 |

## Files

- Add: `server2/src/domestic/kma/` (assembly, JS value model, store trait, backend, locales),
  `server2/tests/domestic.rs`, `server2/tests/domestic/`, `server2/config/tasks/S15.json`.
- Change (additive): `server2/src/domestic/mod.rs` (`pub mod kma;`), `server2/src/gateway/backend.rs`
  (defaulted `fetch_or_forward` and the forward branch), `server2/src/gateway/runtime.rs`
  (opt-in KMA mode), `server2/tools/shadow/` (KMA family module if feasible).
- Docs: intent/spec/plan `issue-2700.md`; one S15 section in `docs/architecture/server2.md`.
- Not changed: `server/`, `plans/issue-2614.md`.

## Order

1. Declaration and issue comment. 2. Red: parity harness over the 21 cases. 3. JS value model,
time/precipitation/policy helpers. 4. Middleware port in route order, checked against a local
per-middleware oracle trace. 5. Backend, forward outcome, runtime option. 6. Green, refactor,
fmt/clippy/test, checkpoint, release smoke, placement, artifact policy. 7. Commit, push, PR, CI,
Codex review loop, readiness and issue status.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; release checkpoint and smoke;
`python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S15.json --base 87ab79cd`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing `server2::domestic::kma`.

## Rollback and blast radius

Library plus an opt-in handler; legacy stays selected by default and the runtime source forwards.
Revert the PR to roll back. Production switches remain S20.
