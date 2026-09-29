# Spec: stop quota retry storms and rotate forecast keys — issue 2604

Revision 2, 2026-09-27 (r2: R5a retry bound from independent verification F1; bound wording per re-verification N1). Consumes [intent](../intent/issue-2604.md) r1a.

## Requirements

- R1 Shared classification (`server/lib/dataGoKrRejection.js`, new): `code(body)` returns the first `returnReasonCode`/`resultCode` digits of a string body (else `undefined`); `isQuota(statusCode, code)` = HTTP 429 or code `22`; `isAuth(statusCode, code)` = HTTP 401/403 or code `20`/`30`/`31`/`32`. `kmaWarningRequester` uses these predicates; its `isAuthError`/`isQuotaError` values are unchanged for every input.
- R2 Page classification (`_requestPage`): after a transport error check, derive the code from the body for any status. Quota → reason `KMA quota exceeded`; auth → `KMA key rejected`; otherwise non-2xx 4xx → `KMA request rejected`; other non-2xx → `KMA HTTP failure` (5xx, 3xx, no response); 2xx follows the existing XML validation. Reasons stay static strings.
- R3 Failure handling (`getData.fail`): quota/auth set `stopReason` (`quota`/`auth`, first wins) and log at `debug`; `KMA request rejected` marks the item `rejected`; other reasons keep the `warn` line. Collector-level retry is skipped once `stopReason` is set or the item is rejected.
- R4 Walk (`requestData`): build all URLs first, then request with at most `concurrency` requests in flight (constructor default 101, the former cutoff); each settled item starts the next. After `stopReason` is set no new request starts; when in-flight requests have settled, every unsent item is counted as failed (`isCompleted: false`) and `dataCompleted` fires once. The walk is re-entrancy safe (synchronous completions do not recurse). Items with an empty URL keep their current behaviour. `requestDataByBaseTimeList` is unchanged.
- R5 Manager (`_recursiveRequestData`): sets `collectInfo.concurrency = gatherPolicy.requestConcurrency`. Keys: `dongnae_keys[index[service] % n]` with `service` = `VilageFcstInfoService` for TOWN_* and `MidFcstInfoService` otherwise; the index lives in module state across cycles (replaces the random draw). After saving completed items: if `stopReason` is set, log one `warn` summary (`dataType`, pending grids, reason, key index, keys tried) and, if keys remain untried in this cycle, advance the index and re-request only the uncollected grids (retry count not decremented); otherwise call back with an error without a retry pass. Rejected items are excluded from retries and counted in one `warn` line per pass. The per-grid `verbose` retry line becomes one line per pass. With no configured keys the passed key is used and counts as one key.
- R5a Retry bound (r1a): a retry pass (failed or invalid-T1H list) sets `collectInfo.requestLimit = requestConcurrency`; the walk sends at most that many requests and counts the rest as failed, so they wait for the next pass. The first pass and the pass after a key change have no limit. One cycle sends at most `grids + (retry − 1) × concurrency` requests per key, plus at most one walk of the pending grids per key change (bounded by the number of keys).
- R6 Policy: `GATHER_REQUEST_CONCURRENCY` (integer 1–1000, default 101) → `requestConcurrency`. `GATHER_TOWN_RETRY`/`GATHER_MID_RETRY` now count failure-retry passes after a full walk.
- R7 Docs: gather runtime policy (new variable, changed retry meaning, host note), weather collection steps 2–4, external providers K1 row.

## Failure behaviour

| Response | Item | Walk | Manager |
| --- | --- | --- | --- |
| 429 / code 22 (any status) | failed | stop, settle | rotate or end cycle with error |
| 401/403 / codes 20,30,31,32 | failed | stop, settle | rotate or end cycle with error |
| other 4xx | failed, `rejected` | continue | not retried, warned |
| 5xx, 3xx, transport, invalid/empty body, `resultCode 03` | failed | continue | retried (existing) |

## Security and observability

No log or error contains the URL or key; summaries print the key index only. Quota/auth per-request lines move to `debug`.

## Compatibility and migration

Default load stays at 101 concurrent requests per pass; a pass now covers every grid, so the same retry budget means more retries of real failures. No schema, route or `DB_DATA_VERSION` change. Host deployment remains AK-owned; host cutoffs must be rechecked before choosing the concurrency.

## Alternatives rejected

- Keep the cutoff and only add quota stop: preserves the coverage coupling (AK comment 2026-09-27).
- Walk sequential batches of 101 in the Manager: extra passes and callback plumbing; a bounded pool in `requestData` keeps one pass.
- Adopt the warning requester's full response contract: different product semantics (AK review).

## Verification strategy

Offline unit tests (new `gather-quota.test.js`) for R1–R6 with synthetic XML and deferred HTTP stubs; updated drift/policy tests; a real-HTTP smoke that runs the real Manager recursion and collector with the real `request` library against a local fake data.go.kr server over 2,032 grids and two keys.
