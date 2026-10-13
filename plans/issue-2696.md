# S11 execution plan

Owner: S11 builder; base ca8735cf937a634e7af57396d605e26db8bfc4ff; 2026-10-13.
Inputs: [intent](../intent/issue-2696.md), [specification](../specs/issue-2696.md),
[path declaration](../server2/config/tasks/S11.json). The design sequence is
retained as local task evidence because maintained diagram paths are outside
this task's declared documentation exception.

## File operations

- Add `server2/src/world/`: cell, JavaScript value/date/number helpers, VC
  converter and record derivation, raw store over S06, funded VC acquisition
  over S08, chain/single flight, assembly (merge, units, summary, i18n subset),
  air rendering and the `BackendHandler`.
- Add `server2/tests/world.rs` and `server2/tests/world/` with oracle fixtures
  and provenance, parity, restore, privacy, chain and switch tests.
- Additive `pub mod world;` in `server2/src/lib.rs`; additive opt-in local world
  registration in `server2/src/gateway/runtime.rs`; `chrono-tz` for IANA offsets
  in `server2/Cargo.toml`/`Cargo.lock`; `server2/tools/world_smoke.py` for the
  release-binary smoke.
- Update only the world section of `docs/architecture/server2.md`.

## Order

1. Declaration and issue comment before dependent edits.
2. Record oracle fixtures with pinned Node v16.20.2 from the legacy harness at
   the base revision (driver kept in task evidence; outputs and provenance in
   `server2/tests/world/fixtures/`).
3. Tests first: parity/restore/privacy/chain/switch tests compile against the
   planned API and fail (Red).
4. Implement helpers -> converter/records -> store/acquisition -> chain ->
   assembly -> handler/runtime; Green; then `cargo fmt`, clippy and refactor.
5. Release-binary smoke with loopback S3, VC, geocoder and legacy peers.
6. Placement gate, artifact policy, documentation, commit, push, PR, CI,
   Codex review and corrections. No merge.

## Tests and commands

`cargo +1.99.0 fmt --check`, `cargo +1.99.0 clippy --locked --all-targets -- -D
warnings`, `cargo +1.99.0 test --locked` (manifest `server2/Cargo.toml`, local
target dir under `reports/`), `python3.11 server2/tools/check_placement.py
--root . --declaration server2/config/tasks/S11.json --base ca8735cf`,
`python3.11 server2/tools/test_placement.py`, `python3 server2/tools/world_smoke.py
--binary <release>`, `python3 scripts/check-artifact-policy.py --staged` and
`--range`. Existing S02 golden CI remains the oracle reproducibility check.

## Migration, rollback and risk

Startup defaults do not change; the gateway keeps legacy HTTP for every family
unless a native handler is registered and selected. Rollback is
`set_backend(version, Family::Dsf, Legacy)`. Native world starts from S3 raw
history only; legacy Mongo DSF records are not imported, so the first request
for a cell behaves like a legacy cell without stored records.

Highest risks: byte parity of JavaScript semantics (rounding, dates, ordering),
DST offset selection, cold-load cost for hot cells (bounded per-partition reads,
measured before cutover), and the single 3 s native attempt versus legacy
gateway retries after a slow fetch. Air acquisition is not implemented: native
activation keeps the legacy no-provider air output until the air decision is
recorded.

Blast radius: new module only; gateway runtime change is opt-in; no existing
public behavior changes.

## User scenarios

### WORLD-PARITY
User: overseas app user. Goal: identical weather JSON from the native backend.
Prerequisites: recorded VC bodies and oracle outputs for each case.
1. Register native world for v000901/2/3.
2. Request each recorded case at its recorded instant and language.
3. Compare body bytes or error class with the oracle.
Expected: identical bytes for every success; identical error class for failures.
Failure: any byte difference fails the parity test. Criteria: PARITY, CHAINS, AIR.
Coverage: `tests/world` parity suite.

### WORLD-RESTORE
User: operator after a replacement. Goal: serve without providers after restart.
Prerequisites: S3 test peer holding raw records written by earlier steps.
1. Run a recorded scenario with providers enabled.
2. Start a new engine with empty memory and providers disabled.
3. Repeat each request at the same instant.
Expected: the same bytes. Failure: missing or incomplete S3 data returns the
legacy error class instead of a fabricated success. Criteria: RESTORE.
Coverage: restore test and release smoke.

### WORLD-PRIVACY
User: privacy reviewer. Goal: no precise user coordinate in archives or provider weather requests.
Prerequisites: requests at precise coordinates within one cell and across a boundary.
1. Request nearby coordinates and boundary neighbours.
2. Inspect provider request URLs and every stored key, metadata value and body.
Expected: only cell-centre coordinates; one provider call per cell. Failure: any
precise coordinate in storage or a VC request. Criteria: PRIVACY, CHAINS.
Coverage: privacy test and smoke.

### WORLD-CHAIN
User: operator. Goal: legacy acquisition chain under failures and quota.
Prerequisites: stub VC returning errors, 401, unusable bodies; finite S08 budget.
1. Exercise combined/recent/forecast selection and the no-yesterday marker.
2. Inject provider failure, 401 and exhausted funding with and without stored data.
3. Issue concurrent same-cell requests and cancel one waiter.
Expected: stale fallback, Unavailable with retry time, backoff windows, one owned
fetch per cell, no success without publication. Failure: unfunded HTTP or a
success after failed publication. Criteria: CHAINS, RESTORE.
Coverage: chain tests.

### WORLD-SWITCH
User: operator. Goal: select native world and roll back.
Prerequisites: release binary, loopback legacy backend, S3, VC and geocoder peers.
1. Start with defaults (legacy world).
2. Start with the local native world option and request a world coordinate.
3. Restart with legacy and repeat.
Expected: legacy default, native bytes from S3/VC peers, rollback restores
legacy. Failure: native without registration or a non-loopback provider fails
configuration. Criteria: SWITCH, PLACEMENT.
Coverage: switch test and `tools/world_smoke.py`.

### WORLD-PLACEMENT
User: repository reviewer. Goal: confirm placement and dependency boundaries.
Prerequisites: S11 declaration and the PR diff.
1. Run the placement gate and its tests.
2. Review dependencies and runtime file reads.
Expected: all paths declared; no legacy runtime reads. Failure: undeclared path
or legacy dependency. Criteria: PLACEMENT.
Coverage: placement gate, review.
