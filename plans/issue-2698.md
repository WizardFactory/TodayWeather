Task: issue-2698-s13; owner: Claude builder (S13 worktree); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Inputs: [intent](../intent/issue-2698.md), [spec](../specs/issue-2698.md). Declaration: [S13.json](../server2/config/tasks/S13.json).
Design stage: skipped with reason. The flow reuses the existing S08 admission and S06
publication sequences; the root limited outside paths to `docs/architecture/server2.md`, so
no new diagram is added. The server2 design text records the acquisition contract.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| P1 | S15 assembler needs a short forecast for one grid | Ring has a funded key; stub serves page 1 (999 rows) and page 2 | Two ordered records, `complete` on both, one group, exact bytes; a missing or inconsistent page 2 yields no records | AC1; `acquire::paged_*` |
| P2 | Operator's key hits quota | Stub answers JSON or XML gateway quota/auth envelopes | Rotation to the next quota owner or a terminal error; no record; ring stays on the new key | AC1/AC2; `rejection::*`, `acquire::rotation_*` |
| P3 | KMA publishes late | Stub answers `03`, empty `00` or a previous publication | NotPublished/Stale with one funded attempt; nothing stored | AC1/AC2; `acquire::late_*` |
| P4 | Scraper input from KMA web | Stub serves RSS XML, EUC-KR AWS and UTF-8 city pages; also redirect, HTML error and stale cases | Exact raw records with publication periods; invalid or stale bodies rejected | AC1; `formats::*`, `acquire::web_*` |
| P5 | Reviewer checks request parity and accounting | Freeze clock at publication boundaries; inspect query pairs and metrics | Base times, query pairs and funded attempt/reservation counts match legacy and the budget authority | AC2; `publication::*`, `requests::*`, `acquire::metrics_*` |
| P6 | Release-mode integration | Real loopback provider stub, S3 peer, budget store and catalog publication | Published groups read back byte-identical; failed acquisitions publish nothing | AC1/AC2; `smoke::*` in `--release` |
| P7 | Reviewer checks placement | Run placement gate with S13.json | Only declared paths changed; no legacy runtime dependency | AC3; check_placement.py |

## Files

- Change: `server2/src/lib.rs` (add `pub mod domestic;`), `server2/src/providers/{mod,acquisition,rejection}.rs`.
- Add: `server2/src/providers/public.rs`; `server2/src/domestic/{mod,keys,publication,family,format,acquire,metrics}.rs`;
  `server2/tests/providers.rs`, `server2/tests/providers/*.rs`, fixtures and `PROVENANCE.md`.
- Docs: intent/spec/plan `issue-2698.md`; domestic acquisition contract text in `docs/architecture/server2.md`.
- Not changed: `plans/issue-2614.md`, Cargo manifests (no new crate), legacy `server/`.

## Order

1. Declaration and issue comment. 2. Red tests for rejection, publication, requests, formats,
acquisition and smoke. 3. Executor report/validator hooks and public transport. 4. Domestic
modules. 5. Green, refactor, fmt/clippy/test, placement, release smoke, artifact policy.
6. Commit, push, PR, CI, Codex review loop, readiness.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked`; `cargo +1.99.0 test --release --locked --test providers smoke`;
`python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S13.json --base ca8735cf`;
`python3.11 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged` and `--range`.
Expected Red cause: missing `server2::domestic` module and executor report API.

## Rollback and blast radius

Library-only; no route, startup or configuration default changes. Executor changes are additive
(`execute` keeps its behaviour); JSON gateway recognition only turns a previously retried
auth/quota envelope into the #2604 terminal/rotation outcome. Revert the PR to roll back.
