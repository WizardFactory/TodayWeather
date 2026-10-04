# Alarm preparation retry execution plan
Input: [specification](../specs/issue-2677.md). Owner: main (Claude). Endpoint: pre-merge.

1. Add failing regressions first: dispatcher retry/bound/deadline/guard/ambiguous-send, weatherSource bounds and typing, engine scheduled-batch recovery and safe readback including a sensitive-field exclusion check. Record the intended Red.
2. Add `errors.js` (PreparationError) and `weatherSource.js`; wire `runtime.js` weather() through it.
3. Update `dispatcher.js` (phase split, preparation retry, stage/reason/attempts, sanitized reasons) and `engine.js` (persist result fields, manifest summary, pass cumulative preparation count).
4. Run the push offline suite and the complete `npm run test:offline` where the environment permits. Additional smoke: a loopback HTTP origin that hangs the first request per URL, driven through the real `weatherSource`, Dispatcher and Engine with in-memory storage.
5. Update `docs/architecture/push-notifications.md` and `push-s3-design.md` for the retry/readback contract; assess the Archify push diagrams.
6. Commit, push, open the PR, wait for CI, run independent review, apply selected findings, renew affected checks.

Scenarios: S1 scheduled alarm batch with one weather outage (AC1); S2 persistent outage, disabled/changed registration, ambiguous send (AC2); S3 campaign readback of mixed preparation/FCM failures with sensitive data absent (AC3). Machine definitions: `reports/sdlc/issue-2677/user-scenarios.json`.

Riskiest part: a retry delaying a send past eligibility or duplicating a send. Proof: guard re-run test and exact-once assertions. Rejected alternative: raising the 5 s timeout only, which lengthens stalls without recovery. Rollback: revert; campaigns remain readable. No dependencies added. Blast radius: scheduled alarm and conditional alert preparation.
