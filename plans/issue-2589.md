# Issue 2589 execution plan

Implements [intent](../intent/issue-2589.md) and [spec](../specs/issue-2589.md).
Owner: OpenAI /root. The named execution notebook is `.planning/2026-10-03-issue-2589-credential-free-load/`; it remains local under the artifact policy. This plan reconciles completed local work with the new pre-merge scope; it does not relabel historical stage execution.

1. Retain baseline reproduction and local code/test changes. Geo/config fix plus callback propagation; Push stays unchanged.
2. Add the regression to the minimal offline runner and the real Node16 load/loopback smoke to the existing locked-dependency push-worker CI job. Update architecture prose and offline test instructions.
3. Refresh scoped Red (baseline module), Green and post-refactor evidence, then real Node16 smoke. Reuse the completed full Node22 runner for unchanged source; CI verifies the committed candidate and job wiring. Retain environment failures separately.
4. Check intended staged content and outgoing commit artifacts. Commit/push the task branch and create a PR against master. Post a material issue update with the PR and actual evidence.
5. Request separate-context Anthropic review using verified current model/medium/auto settings. Resolve Required findings and selected recommendations, renew affected checks and repeat review. Check CI, protections, current head/base and absence of auto-merge/queue before declaring readiness.

## User scenarios and mapping
- S1 (AC1/AC3): Gather operator with no Kakao keys requires Geo and Push, then invokes KR coordinate geocoding. Both load; one sanitized warning and a clear callback error; no provider call. Tests: invalid configuration matrix and real-dependency unset/removed smoke.
- S2 (AC1): Operator provides malformed JSON, non-array, empty or invalid entries and repeats geocoding across instances. Load succeeds, warn once and fail safely. Tests: regression matrix, real malformed smoke.
- S3 (AC1): Service operator provides ordered valid keys; provider fails the first request and accepts the second. Header order, retries, longitude/latitude and KR middleware fields stay correct. Tests: stub retries/error exhaustion and Axios loopback smoke.
- S4 (AC2/AC3): Gather operator has no APNs/Firebase files. Load/construct Push without SDK initialization or credential reads; retain station API fallback. Tests: real CommonJS smoke, existing 11-case push runtime suite and city parser/fallback tests. Actual gather replacement stays a deployment handoff.

Blast radius: module startup and geocode failure propagation. Riskiest part: provider errors masked during parsing. Rejected alternative: installing host keys or leaving example keys as defaults. Rollback: revert the task commit; no data migration. No live providers, database, app startup or host update. No new feature/UI/PDF/manual; no structural diagram change. Pre-merge excludes integration and production actions.

## Accepted review correction R3-CI-001
Add `scripts/verification/check-ci-artifacts.py` and isolated Git regressions in `scripts/verification/test_artifact_ci.py`; update only the artifact workflow invocation and retention documentation. Establish Red against the current zero-base invocation, implement the new-branch merge-base resolver, then Green/post-refactor plus existing policy/hook checks and a separate actual-repository event smoke. Preserve PR/nonzero-push history ranges, manual tip checks and fail-closed missing baselines. Push the correction, renew CI and ask the same independent reviewer to resolve R3-CI-001. No product code changes; reuse unaffected product test evidence with its exact source mapping.

S5 (AC3/pre-merge readiness): Maintainer pushes a new task branch from the published default branch. A zero-before event checks the task range successfully despite retired historical artifacts, while an unpublished bad intermediate commit still fails. Ordinary pushes and PRs retain their explicit ranges; a missing baseline fails. Tests: isolated Git event regression and actual-repository CI resolver smoke. No remote permissions or protection settings change.

## Claude review corrections

Apply H1-GEO-001 and H1-CI-002 with regression Red, minimal fixes, Green/post-refactor and separate integrated smoke. Reuse earlier product checks only for unchanged code. Renew candidate identity, staged/outgoing checks, CI and independent Claude review before readiness.

- S6 (AC1/AC3, H1-GEO-001): Gather operator converts a new station address with missing, malformed or empty Kakao keys. No Kakao request occurs; one warning is emitted; the existing Google fallback returns coordinates or its error. With configured keys, selection and provider-error fallback stay intact. Tests: complete-module invalid matrix and actual request/XML/coordinate loopback smoke, two repeated calls per scenario.
- S7 (AC3/pre-merge, H1-CI-002): Maintainer checks a branch containing an added-then-deleted forbidden artifact and a tip `history_base` pointing at the bad commit. PR, ordinary push and derived new-branch checks reject that intermediate commit; existing-ref pre-push rejects the merge-side violation without modifying the remote or index. Tests: real Git regression/control fixtures and separate local bare-remote merge/push smoke.

H1-REC-001 is not selected: nonblank example-string filtering is outside the specified missing/invalid JSON/list contract and would add provider-key content policy. H1-REC-002 is not selected at pre-merge: #2674 is not integrated here; its potential conflict is an integration constraint to preserve in the review record, not authority to change another PR or merge.
