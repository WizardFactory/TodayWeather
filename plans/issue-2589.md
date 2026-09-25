# Plan: Load geo and push controllers without provider credentials — issue 2589

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2589.md) r1 and [spec](../specs/issue-2589.md) r1. Design skipped (no structure/flow change). Owner: main agent (builder). Branch `fix/2589-load-without-credentials` from `master` `caaa21fe`, pushed to `ak-fork`, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/controllers/geo.controller.js` | `getKeyList(name)` lazy/cached/defensive; empty-key errors in Kakao/Daum requests; `if (err)` before parse in `location2address` | R1–R3 |
| `server/test/offline/geo-keys.test.js` (new) | VM regression test | AC1–AC3 |
| `server/test/offline/credential-free-load-smoke.js` (new) | Real-module Node 16 load smoke for both controllers and the service app | AC1, AC2, AC4 |
| `server/test/offline/run.js` | Add the regression test to `test:offline` | AC5 |
| `.github/workflows/rss-offline.yml` | Regression test on the Node 16/22 matrix; new Node 16.20.2 job with `npm ci` of the lock for the smoke | AC5 |
| `server/test/offline/README.md`, `docs/architecture/service-overview.md` or `evidence.md` | Test docs and load-time credential note | AGENTS.md |
| `intent/`, `specs/`, `plans/issue-2589.md` | Tracked SDLC artifacts | — |

Boundaries: no change to `controllerPush.js`, `pushProviders.js`, `config.js`, `controllerManager.js`, `kecoController.js`, routes or clients.

## Order

1. Write the regression test and smoke first.
2. Red on base: regression test fails (load throws for unset/non-JSON); smoke fails for missing keys (`SyntaxError` loading push).
3. Implement R1–R3.
4. Green: regression test (UTC); smoke on Node 16.20.2.
5. Post-refactor: re-run after final edits.
6. Regression: `test:offline` and `test:runtime` on Node 22.22.2 and 16.20.2; RSS/air/weather-desc smokes.
7. Commit, push, PR, read CI; independent verification in a fresh subagent context; issue comment on the out-of-scope `startManager` parse.

## Commands

```sh
node server/test/offline/geo-keys.test.js
NODE_PATH=/tmp/tw-2589-candidate/node_modules <node16> server/test/offline/credential-free-load-smoke.js
NODE_PATH=/tmp/tw-air-smoke/node_modules npm --prefix server run test:offline
NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/runtime-node16.test.js
```

`/tmp/tw-2589-candidate` is `npm ci` of master `server/package.json`/`package-lock.json` with Node 16.20.2.

## Migration, rollback, blast radius

No migration; revert to roll back. Blast radius: Korean reverse geocoding in `location2address` (error object on Kakao failure) and hosts whose key strings are missing/invalid (load instead of crash).

## Risk review

- What could break: a caller relying on the `TypeError` message (none found); a key list that is valid JSON but not an array (previously `retry(undefined)`, now a clear error).
- Riskiest part: CI job with a full `npm ci` (native `grpc` prebuilt download). If the hosted runner cannot install, the job fails visibly; it is not skipped.
- Rejected alternative: default the settings in `config.js` (gather host keeps its own config).
- Proof: Red on base and Green on the candidate for the same tests; real-module smoke on Node 16.20.2; full offline regression on Node 16/22; independent verification.

## Gate

PROCEED within the `pr` endpoint. The other-provider PR review is skipped by AK and recorded as not satisfied.
