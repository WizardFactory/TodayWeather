# Intent: stop quota retry storms and rotate forecast keys — issue 2604

Revision 1, 2026-09-27. Owner: main agent for AK. Source: issue [#2604](https://github.com/WizardFactory/TodayWeather/issues/2604) (body revised 2026-09-27) and its review comments; AK: "댓글과 본문 업데이트하고 구현 시작".

## Problem

On a data.go.kr daily-quota day the gather worker keeps re-requesting every grid (HTTP 429 / code 22) because `_recursiveRequestData` treats a quota rejection like any transient failure, and it never switches to another `DONGNAE_SECRET_KEYS` entry. The retry budget also doubles as grid coverage: `requestData` marks every index above 100 failed without a request, so lowering the retry count drops grids.

## Desired outcome and acceptance criteria

- AC1: `requestData` requests every grid of a 2,032-grid list in one pass with at most the configured concurrency in flight (default 101); with retry 1 every grid is collected when all succeed.
- AC2: A quota (HTTP 429 or code 22, including an HTTP 200 body) or auth (HTTP 401/403 or codes 20/30/31/32) rejection stops new requests; in-flight requests settle; the unsent grids are reported as not collected. With one key the Manager ends the cycle with an error and no retry pass.
- AC3: With two keys, a rejection on the first key re-requests only the uncollected grids with the second key; when both are rejected the cycle ends with an error. The key choice is kept per service (`VilageFcstInfoService` / `MidFcstInfoService`) across cycles.
- AC4: `resultCode 03`, invalid bodies, transport errors and 5xx are still retried; other 4xx (e.g. 400) are not retried.
- AC5: Quota/auth rejections do not log one warning per request; each stop logs one summary (`dataType`, pending grids, reason, key index); no log line contains the key.
- AC6: `npm run test:offline` passes; the warning requester keeps its behaviour while sharing the code classification; docs (gather policy, weather collection, external providers) describe the new behaviour and the new policy variable.

## Scope

In scope: `server/lib/collectTownForecast.js`, `server/controllers/controllerManager.js` (`_recursiveRequestData`), a shared data.go.kr rejection classifier used by it and `kmaWarningRequester`, `server/config/gather.js` (`GATHER_REQUEST_CONCURRENCY`), offline tests and smoke, docs.

Out of scope: `_recursiveRequestDataByBaseTimList` / `requestDataByUpdateList` (past condition; disabled on the host), KASI/lifeIndex classifier consolidation, host drift, adding keys on the host, deployment.

## Constraints

Node 16.20.2 gather runtime (code stays ES5 like the surrounding file); master defaults keep current load (101 in flight); no provider/production access in tests; no key values in code, logs or docs (public repository).

## Authority and endpoint

Endpoint local: implementation, tests, local commits on the task branch. Push, PR, deployment and host changes need a separate AK request.

## Risks and open questions

- `GATHER_TOWN_RETRY` changes meaning (passes → failure retries); the host value (180) stays safe but larger than needed.
- Whether data.go.kr counts quota per key or per operation is not measured; per-service key state is a conservative choice.
- Host collector cutoffs (`i > 20` recorded, ≈101 observed) must be rechecked by AK before choosing `GATHER_REQUEST_CONCURRENCY` for the host.

## Amendment 2026-09-27 (r1a)

Source: independent verification `reports/sdlc/issue-2604/independent-verification.md` F1 (MEDIUM, CHANGES_REQUIRED). With every retry pass walking the whole list, a failure on every grid that is not a quota/key rejection (for example `resultCode 03`) sent about 20× the former requests (365,760 instead of 18,180 at retry 180). AC4 is extended: such a cycle sends at most `grids + (retry − 1) × concurrency` requests, and transient failures are still retried to full coverage. Retry passes request at most `concurrency` failed items; the first pass and the pass after a key change walk the whole list. F2 (stale K4 row and reconciliation table) is corrected in the docs. The risk line on `GATHER_TOWN_RETRY` changes: it now bounds retry passes of at most 101 requests each.
