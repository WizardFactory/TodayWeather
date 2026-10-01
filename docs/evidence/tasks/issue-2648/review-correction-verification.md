# Independent verification of review corrections

Date: 2026-09-30. Verifier: non-builder Codex agent `qa_asos`. Scope: local verification of corrections for PR #2656 review `5370162301`; no GitHub write, commit, deployment or production query.

Base observed during verification: `e93b96579c53ffef594d1292ddad08239a52af4b`.
Final source/test candidate: `b374d0c1875a4a7b5935195e15a8c7e29a86469d276b1cced031f0541b8e9754`. All 18 manifest file hashes matched the worktree at report completion.
The verified worktree changes are identified by these SHA-256 hashes:

| File | SHA-256 |
| --- | --- |
| `server/lib/history/observations.js` | `6cf6683c6d408869f75c870ed1991e08b0069b6e9d6330bf1ccdb708aaa70f29` |
| `server/test/offline/historical-fallback.test.js` | `ca182078a6b857f0cfa27a0f52daf2585f59d234d998b3cbdd1cf24bafaadd3b` |
| `server/test/offline/history-integration-smoke.js` | `6925463684cc0c368eeba1a0624ef9d17f7c8ab53bbecc36d4714b38b2d93120` |
| `server/test/offline/legacy-comparison-harness.js` | `604558101d02fbf49eba0efdb35bef35090cdcc4b40f8119dc4ff704d661af63` |

## Verdict

**PASS for the reviewed correction.** No unresolved mandatory finding was found in these changes. This does not resolve the external review on behalf of its reviewer, certify CI, or establish merge readiness.

The actual legacy app's `_diffTodayYesterday` computes a difference whenever both `t1h` fields exist; it ignores the additive availability flag. The correction omits `t1h` from the request-local yesterday projection when source compatibility or current temperature validity fails. It retains the original historical temperature and other projected fields. Selection now skips invalid exact-slot rows, allowing valid zero at `0000` to win over a sentinel at its equivalent preceding-date `2400`, in either input order.

The new harness extracts and executes the unchanged client function, including its translation completion callback. It does not replace the client comparison with a server-side assertion. The integrated smoke checks the serialized, converted response with this client function, verifying suppression for both C and F responses. Valid grid-to-grid comparisons remain visible.

## Independently executed verification

Environment: Linux, Node `v22.22.2`; integrated run uses `TZ=UTC`. No production process or authenticated provider was started.

| Check | Result and observed behavior |
| --- | --- |
| `node server/test/offline/historical-fallback.test.js` | Exit 0, 11 scenarios. Added scenarios execute the legacy client for incompatible sources and invalid current temperatures, preserve valid grid differences, retain the original historical temperature, and prefer valid midnight duplicates in both row orders. Earlier fallback, provenance, conversion and deadline regressions remain green. |
| `node server/test/offline/history-read-cache.test.js` | Exit 0, 5 checks; unchanged cache behavior remains green. |
| Additional independent inline Node assertions | Exit 0, 8 cases. Frozen source rows remain unmodified; invalid current values `-50`, `null`, `undefined`, `NaN`, `Infinity` and a numeric string yield no client comparison and omit projected temperature while retaining humidity. Both midnight alias orders retain a zero observation and the valid `+2` client difference. |
| `NODE_PATH=/tmp/tw-2585-mongo/node_modules:/tmp/issue-2560-offline/node_modules TZ=UTC node server/test/offline/history-integration-smoke.js` | Exit 0. Independently rerun with isolated real MongoDB and loopback HTTP fixture: 175 records, 5 recovery requests, 16 response/client scenarios across DB formats 1.0/2.0, C/F and four coverage states. New serialized-response assertions confirm no incompatible yesterday temperature and no legacy comparison text. Readback, idempotency, leases, wrong-date rejection and bounded retry checks also pass. |
| `git diff --check` | Exit 0. |

The builder's local `review-r1-smoke.log` reports the same successful integrated outcomes. `review-r1-offline.log` contains the complete offline run through its last suite with no failing suite result; this was assessed as builder evidence, not an independently repeated full-suite run. Durable selected execution context is retained in the [builder verification record](verification.md); raw logs remain ignored local output.

## Boundaries

Only the selected comparison projection loses `t1h`; the chart/history source row remains intact. Duplicate resolution prefers valid temperature over invalid temperature and does not establish a new priority between two valid observations with different sources. The current selection still conservatively rejects incompatible source pairs.

No Angular application/browser session, released native binary, production cache, live provider, deployment or production latency was verified. The extracted unchanged JavaScript comparison and actual serialized-response smoke establish the relevant client predicate behavior. Diagram browser/visual checks and whole-suite execution are separate builder evidence. External review resolution and any merge decision remain outside this verifier's authority.
