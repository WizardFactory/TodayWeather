# Alarm preparation retry execution plan
Input: [specification](../specs/issue-2677.md). Owner: main (Claude). Endpoint: pre-merge.

1. Add failing regressions first: dispatcher retry/bound/deadline/guard/ambiguous-send, weatherSource bounds and typing, engine scheduled-batch recovery and safe readback including a sensitive-field exclusion check. Record the intended Red.
2. Add `errors.js` (PreparationError) and `weatherSource.js`; wire `runtime.js` weather() through it.
3. Update `dispatcher.js` (phase split, preparation retry, stage/reason/attempts, sanitized reasons) and `engine.js` (persist result fields, manifest summary, pass the checkpointed preparation and failure counts).
4. Run the push offline suite and the complete `npm run test:offline` where the environment permits. Additional smoke: a loopback HTTP origin that hangs the first request per URL, driven through the real `weatherSource`, Dispatcher and Engine with in-memory storage.
5. Update `docs/architecture/push-notifications.md` and `push-s3-design.md` for the retry/readback contract; assess the Archify push diagrams.
6. Commit, push, open the PR, wait for CI, run independent review, apply selected findings, renew affected checks.
7. Review 1 (PR #2680, Codex) Required F1-F6 plus the gather-offline CI failure: enforce the bound before preparing, checkpoint in-flight counts, derive the manifest summary from the part snapshot, closed reason list, deadline-aware weather queue, architecture docs and regenerated Archify push diagram (finalize + visual-check). Red/Green for each in `push-preparation-retry.test.js`; the smoke is not in `run.js` (gather-offline installs a minimal dependency set).
8. Review 2 (same reviewer) F7/F8: the bound counts failed preparations only so explicit FCM retries keep their five attempts, and a shared weather request is dropped only when every consumer's deadline has passed.
9. PR review 5404350134: Required — non-JSON 200 body and normalize exceptions become typed failures inside the response callback (no uncaught exception, slot released). Recommended (all selected) — unfinished shared requests reused with TTL from success; expiry while waiting for a retry keeps the preparation reason; `PUSH_PREPARE_ATTEMPTS` validated at startup.

Scenarios: S1 scheduled alarm batch with one weather outage (AC1); S2 persistent outage, disabled/changed registration, ambiguous send (AC2); S3 campaign readback of mixed preparation/FCM failures with sensitive data absent (AC3). Machine definitions: `reports/sdlc/issue-2677/user-scenarios.json`.

Riskiest part: a retry delaying a send past eligibility or duplicating a send. Proof: guard re-run test and exact-once assertions. Rejected alternative: raising the 5 s timeout only, which lengthens stalls without recovery. Rollback: revert; campaigns remain readable. No dependencies added. Blast radius: scheduled alarm and conditional alert preparation.
