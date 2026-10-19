# F1 final registration copy implementation plan

Stable task `issue-2819-final-registration-copy`, base `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`, branch `fix/final-registration-copy-2819`, endpoint pre-merge. [Intent](../intent/issue-2819-final-registration-copy.md); [spec](../specs/issue-2819-final-registration-copy.md); [paths](../server2/config/tasks/FinalRegistrationCopy.json). Root owns all lifecycle stage/status/notebook writes and one Cargo lease. This plan does not initialize competing status files. Current deliverable is preparation, not code/test readiness until the root design gate resolves the spec choices.

## One coherent PR boundary

Complete final source bundle→read-only deletion-aware preview→one bounded durable finalization→cold verification, plus operational procedure. Existing import remains compatible. F2 input/owner wiring, generic cutover actuator, live copies and full recovery qualification are excluded. No independent parallel writer or server2 implementation outside its directory.

## Ownership and exact files

Worker prepares declaration/intent/spec/this plan and ignored test-design only. After root authorization, worker owns declared push final-copy module, CLI, synthetic fixture, state tests and owned functional-smoke entrypoint/tool. Root integrates shared Cargo declarations, any existing durable journal API changes, state-test module registration and all shared maintained docs/diagrams/manual/evidence; coordinate before editing those files. New module registration is an explicit shared boundary. No concurrent mutation of the same shared file.

Root-maintained exceptions are named in the declaration, including `docs/operations/server2-cutover.md`/PDF, new final-copy operator guide/PDF, server2 architecture/cutover diagram, `plans/issue-2614.md` and selected synthetic CLI capture/evidence. Task intent/spec/plan are this worker's preparation scope. Do not edit a maintained document merely to record an unexecuted test as passed.

## Ordered implementation slices after the gate

1. **Input/preview vertical slice:** strict bounded complete source bundle parser, canonical source/native/plan fingerprints, ownership classification and read-only CLI preview. Add the intended failure for baseline import→legacy unregister→final export retaining the row before implementing removal planning. Demonstrate ordinary migrate::import still behaves as before.
2. **Atomic journal application:** integrate the agreed source marker/high-water contract into the existing durable path; require exact preview digest and native revision; apply one bounded entry and reconcile duplicate/conflict/unknown/restart. Preserve existing source/import metadata and every delivery claim/result. No hidden chunk loop or automatic stale replanning.
3. **Integrated functional path:** actual CLI/library orchestration with owned loopback S3, synthetic source bundle and fresh native state reader/API. Exercise successful removal+retained native edit, idempotent repeated operation, stale plan, interrupted/ambiguous publication and cold restore without OAuth/provider/FCM. Capture actual commands and aggregate results.
4. **Manual/documentation/integration:** root updates operational stop/edit-freeze/final-copy procedure, renders and visually verifies actual CLI screenshot PDF and affected diagram, reviews placement/dependencies and artifact retention. Required tests/smoke must bind the final candidate. Root runs independent PR review/fallback and CI through pre-merge only. No commit/network action by the worker in the preparation phase.

## User scenarios and coverage

| Scenario | User/goal and prerequisites | Actions | Observable success / failure | Acceptance |
| --- | --- | --- | --- | --- |
| FCP-S1 | Operator preserves a user's legacy unregister; synthetic earlier import plus complete final source absence | Preview; inspect digest/counts; apply exact plan; fresh restore/API lookup | Only source-owned absent row is tombstoned; unrelated native and claims unchanged | COPY-1/2/3/4 |
| FCP-S2 | Operator imports latest source updates without losing a native edit | Preview against native-changed imported row and native-only row | Conflict/kept counts; no destructive apply; no mutation before explicit safe new plan | COPY-2/3 |
| FCP-S3 | Operator receives malformed/truncated/wrong-source/superseded export | Preview/apply with rejected/count/hash/source/generation mismatch | Nonzero BLOCKED; no journal/claim/state change, no token output | COPY-1/4 |
| FCP-S4 | Native mutation races after preview or at journal CAS | Apply old expected plan while owned peer commits a native update | STALE; native update survives; no rebase of destructive plan | COPY-3 |
| FCP-S5 | Response to finalization PUT is lost or process exits | Reconcile exact operation; restart with same bundle/plan | COMMITTED/ALREADY_COMMITTED only with actual matching durable entry; otherwise NOT_APPLIED/SETTLEMENT_REQUIRED; no double delete/reset/replay | COPY-3/4 |
| FCP-S6 | Operator reviews cutover prerequisites without operation authority | Review actual stop/freeze receipt references, bundle and dry run | Tool facts distinct from manual host evidence; missing receipt/custody blocks acceptance, no live action | COPY-5 |
| FCP-S7 | Operator handles empty final collection or oversize finalization | Complete two-scope manifest vs omitted/truncated scope; oversized change set/history | Proven complete empty can plan owned removals; missing/oversized input blocks atomically with zero writes | COPY-1/3 |
| FCP-S8 | Recovery uses an older compatible reader after finalized deletion | Restore identical journal/tombstones and current high-water with owned inputs | No resurrection/claim replay; unsupported compatibility remains explicit BLOCKED | COPY-3/4/5 |

Detailed planned behavioral assertions/commands are in ignored `reports/sdlc/issue-2819-final-registration-copy/test-design.md`; they are NOT_RUN. Existing migrate, durable fault/restore and API tests are reused, not replaced. Root will bind actual Red/Green/additional-smoke receipts to candidate digests; setup failures are not Red.

## Verification and completion gates

Use TDD for the missing source-absence behavior; retain actual intended Red before runtime edits. After Green, any refactor requires passing checks, then a distinct owned-process functional smoke. Re-run affected migrate/state/delivery-no-replay and format/clippy/placement checks under the coordinator's toolchain/target lease. Do not start Cargo or duplicate targets independently. Source-input parsing/security, transaction safety, stale generation/native-edit preservation and unknown-write recovery are required, not optional fixture cases.

Manual capture contains only synthetic identities/aggregate results. Preserve failed runs, original inputs, source maps and selected executable hashes outside disposable Cargo output. Root runs artifact checker on actual staged/outgoing content; no force-add of reports. Independent eligible review and exact CI are required before pre-merge readiness. Endpoint receipt must state `merge_authorized:false`; no auto-merge/queue or operational authority is inferred. #2819/#2704/#2705 remain open for their full remaining scope.

## Decisions and blockers

Root design gate must resolve the spec's atomic-size bound, durable source high-water/marker/history retention and provenance-receipt semantics. No user F2 answer is needed for this F1 preparation and no F2 runtime wiring is included. Actual source counts/change size and host freeze/copy evidence are unavailable here; production applicability remains unverified. A bound exceedance is a visible operational blocker, not an excuse to weaken completeness or silently apply a subset.


Root design gate selects canonical State + journal header + snapshot head metadata (spec2), not retained-history scanning. Independent judge findings same-byte encoding, fingerprint coverage, strict metadata, ownership gaps and bounded predecessor checks are required. Old writers losing the marker are ineligible after finalization; no compatibility PASS inferred. Reuse existing CAS/readback/conditional void for explicit settlement, never resend/chunk/replan. Root owns Cargo and shared manual/diagram integration.

## Selected independent review1 corrections

Original native review1 PASS with no Required remains recorded. Root selects001 repeated-settle existing-void recognition (actual failing behavior before fix),003 pin marker-erasure/no-predecessor boundary in tests/docs,004 whole-plan native conflict documentation,005 plan from journal-replayed state plus other-owner seq-1 compaction then cold restore, and007 exact format check/receipt wording. No new generic custody store or input-file adversary framework is selected for002/006. Existing owner-only retained immutable local inputs remain a prerequisite; unknown/copy/lost custody blocks operational reuse. All original findings carry to independent review2.
