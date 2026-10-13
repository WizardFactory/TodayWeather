# S19 execution plan (first increment: gateway/geocode family)

Owner: S19 builder (Claude); base ca8735cf937a634e7af57396d605e26db8bfc4ff; 2026-10-13.
Inputs: [intent](../intent/issue-2704.md), [spec](../specs/issue-2704.md). Exact paths and reasons: [S19 declaration](../server2/config/tasks/S19.json), posted [before dependent edits](https://github.com/WizardFactory/TodayWeather/issues/2704#issuecomment-6139253207).

Order: declaration -> Rust metrics regression test (Red) -> additive metrics hook (Green) -> shadow tool unit tests and family tooling -> fmt/clippy/full test -> `deploy/smoke.sh` against the actual release binary -> operator guide with actual capture and PDF -> placement gate and artifact policy -> commit/push/PR/CI -> Codex review and corrections -> pre-merge readiness. No merge.

Existing checks reused: foundation `tools/smoke.py`, S10 `tools/gateway_smoke.py` (both invoked by `smoke.sh` unless `--skip-reused`), S02 records, S10 provider fixtures and the S03 local S3 peer. New checks: `tests/integration/main.rs` (metrics deltas through actual loopback HTTP), `tests/integration/test_shadow.py` (comparator, oracle, fixture provenance, loopback refusal, registry, bash syntax) and the release-binary smoke stages.

CI: `server2/tools/ci.py` runs `test_shadow.py`, and after the reused smokes it runs `bash deploy/smoke.sh --skip-reused`. The rollback deadline probes add about 30s. `.github/workflows/server2.yml` is unchanged.

Rollback of this change: revert the PR. The metrics hook only adds counters; the tooling has no runtime side effects.

## Open decision

**S19-GAP-1 (needs an owner decision; not changed here).** The foundation's absolute connection lifetime (`SERVER2_CONNECTION_SECONDS`, default 9) closes a public socket at about 9s. The gateway's 9s deadline therefore never delivers the legacy `501 Not Implemented` in the default configuration. The client sees a closed connection, and `server2_gateway_abandoned_total` increments. The S04 foundation guide already says these limits "require S10 assessment before cutover". Options:

1. Raise the default lifetime when the gateway is enabled (for example to 10-12s). This is the smallest change, but the slow-header bound becomes longer.
2. Reject gateway startup unless `SERVER2_CONNECTION_SECONDS` exceeds the 9s deadline. The operator then chooses the value explicitly.
3. Apply the absolute lifetime only to idle and header/body-reading phases, not while a dispatched request is owned by the gateway. This is the most faithful to the slowloris intent but changes `listener.rs`.

Until the owner decides, the rehearsal probes the deadline with a 12s lifetime and pins the default-configuration observation as a strict known gap.

## User scenarios

### SMOKE-1
User: server2 operator before a family switch. Goal: verify the release binary locally with one command. Prerequisites: a built release binary and Python 3; no credentials.
1. Run `bash server2/deploy/smoke.sh --binary <release>`.
2. Read the scenario PASS lines and the JSON reports in the ignored output directory.
3. Confirm that the S3 peer total is zero for the gateway family.

Expected: every stage passes, and the reports record revision, binary hash and counters. Failure: any scenario assertion exits nonzero with the observed deltas. A missing binary exits 2. Criteria: SMOKE, METRICS. Coverage: smoke.sh run, the operations guide capture and the CI stage.

### METRICS-1
User: reviewer of provider demand. Goal: prove there is no unnecessary provider work and that failure counters are correct. Prerequisites: delayed and faulted loopback providers and backend.
1. Cold, warm and same-key concurrent lookups.
2. Quota exhaustion with 16 dummy keys.
3. Provider and backend outages, and admission pressure.

Expected: one flight per key, RAM hits on warm requests, no provider call after quota rejection, exactly three backend attempts, and 503s that do no work. Failure: any extra provider/backend hop or wrong counter fails the scenario. Criteria: METRICS, SMOKE. Coverage: `integration` Rust test, GW-* scenarios.

### REPLAY-1
User: cutover owner preparing S20/S10a evidence. Goal: compare legacy-geocoder and native-geocoder serving on frozen inputs. Prerequisites: the frozen workload fixture and S02 records.
1. Run `replay.py --self-check --report <file>`.
2. Inspect the declared and unexplained differences and the cold/warm percentiles.
3. Inspect the S02 oracle mismatches.

Expected: 0 unexplained differences, 0 oracle mismatches, and a perturbed baseline is detected. Failure: any unexplained difference exits 1 and lists the request, pass and field. Criteria: REPLAY. Coverage: replay stage and `test_shadow.py` comparator tests.

### ROLLBACK-1
User: operator rehearsing rollback. Goal: switch `/weather` and `/geocode` together and return to legacy without breaking cache or deadline contracts. Prerequisites: the same legacy origin for all phases.
1. Run `rollback.py`.
2. Check each phase's Cache-Control, geocoder source, cross-phase ETag revalidation and empty-memory cost.
3. Check the deadline probes and the S19-GAP-1 pin.

Expected: correct cache headers, 304 for identical bodies across switches, 501 no-store at the 9s/5s/3s caps, and the known gap reported. Failure: a mixed geocoder source, a wrong cache header, or an out-of-window deadline fails. A change in the gap observation fails until the pin is re-assessed. Criteria: ROLLBACK. Coverage: rollback stage and the operations guide.

### PLACE-1
User: repository reviewer. Goal: confirm that placement and dependency boundaries hold. Prerequisites: the S19 declaration and the PR diff.
1. Run `check_placement.py` against the base.
2. Review imports: the tooling reads only `server2/` assets.
3. Run `scripts/check-artifact-policy.py` on staged content and the outgoing range.

Expected: PASS with all paths declared and no legacy reads. Failure: undeclared paths block readiness. Criteria: PLACEMENT. Coverage: placement gate and CI.
