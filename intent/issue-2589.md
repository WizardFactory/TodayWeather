# Intent: Load geo and push controllers without provider credentials — issue 2589

Revision 1, 2026-09-26. Owner: main agent for AK. Source: issue [#2589](https://github.com/WizardFactory/TodayWeather/issues/2589) and AK's request to follow it.

## Problem

`server/controllers/geo.controller.js` parses `config.keyString.kakao_keys` (and `daum_keys`) with `JSON.parse` at module load. On a host whose configuration has no Kakao key (the gather host today), `require` throws `SyntaxError`, and every module that requires it (`controllerTown`, `route.geo`, the scraper chain) fails to load. The gather host therefore stays on an old `geo.controller.js` and an old `controllerPush.js`, and cannot take master file by file.

## Desired outcome and acceptance criteria

- AC1: With `kakao_keys` and `daum_keys` unset, not JSON, or JSON that is not an array, `require('controllers/geo.controller')` succeeds.
- AC2: Without Kakao keys, `_getAddressFromKakao` calls back with an `Error` naming the missing Kakao key, sends no HTTP request and does not throw; a single `log.warn` is written per process. `location2address` for a Korean coordinate passes that error to `next`.
- AC3: With a valid key list, the Kakao request is unchanged: `Authorization: KakaoAK <key>`, one attempt per key, parsed result as before.
- AC4: `require('controllers/controllerPush')` and `new ControllerPush()` succeed with the real Node 16.20.2 dependency tree when no Firebase JSON or APNs certificate exists; no Firebase app is initialized.
- AC5: `test:offline`, `test:runtime` and the new checks pass on Node 16.20.2 and 22.22.2 (local and CI).
- AC6: The gather host can be updated to master `geo.controller.js` and `controllerPush.js` without adding keys. This workflow does not touch hosts; AC6 is a human-owned deployment check recorded in the handoff.

## Scope

In scope: lazy, defensive key-list parsing in `geo.controller.js`; clear error for missing Kakao keys; offline regression test and a real-module load smoke for both controllers; test registration, CI workflow, offline README and architecture note.

Out of scope: `startManager`/`_appendFromKeco`/utility parse sites (run inside functions, not at load; reported on the issue as follow-up); gather host deployment; Google key handling; config defaults; client or widget changes.

## Constraints

Node 16.20.2 service runtime; no provider, DB or network access in tests; no credentials in tests or logs; AGENTS.md verification and documentation rules.

## Authority and endpoint

Endpoint `pr` (AK, 2026-09-26). Covered: implementation, tests, smoke, commits, push to `ak-ongyeol/TodayWeather` (remote `ak-fork`), PR against `WizardFactory/TodayWeather` `master`, CI reading, issue/PR comments. Excluded: merge, auto-merge, merge queue, host changes, deployment, credentials. AK decision: skip the other-provider PR reviewer; that gate stays incomplete and is reported.

## Risks and open questions

- A service host with a broken key string now serves Korean geocode errors instead of failing at startup. The warning makes this visible.
- Full-master gather still parses `kakao_keys` in `startManager` (runtime, gather/local mode). Follow-up, not this issue.

## Consumers

Spec, plan, builder, independent verifier, PR description, completion.
