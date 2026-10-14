# Contract: AirKorea quota key rotation (legacy)
Inputs: [intent](../intent/issue-2745.md), [issue-2636-r2 spec](issue-2636-r2.md). Base: `05c06c67`.

## Quota classification
A failure is quota when its code is `PROVIDER_22` (envelope `resultCode 22`, gateway `returnReasonCode 22`, or the `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` marker, also inside a 401/403 body) or `HTTP_429`. The classifiers from #2737 are unchanged; only the key loop treats these codes differently. `PROVIDER_23` (per-second limit) is not a daily quota and still stops without a key change.

## Key loop (`airkoreaObservation.create().withKeys`)
Order is unchanged: the remembered working index, otherwise the last entry, then descending with one wrap. For each position:

1. If the key is exhausted (`now() < until`), skip it without HTTP and record `QUOTA_EXHAUSTED`.
2. Otherwise run the whole operation (all pages) with that key.
   - Quota: store `until = start of the next KST day` for that key text, call `onKeyExhausted(operation, index, code, until)`, and continue with the next position (the operation restarts at page 1).
   - Credential rejection: unchanged (`onKeyRejected`, next position).
   - Success: remember the index; return.
   - Any other failure: return it (the single transient retry happens inside the operation as before).
3. After every position: `QUOTA_EXHAUSTED` when any key was exhausted, otherwise `NO_VALID_KEY`. Both carry `rejected` codes and no key text.

Inside the key loop, every page attempt (including the transient retry) first rechecks the key; if a parallel request marked it exhausted meanwhile, the operation stops with `KEY_EXHAUSTED` before HTTP and the loop moves to the next key without logging again (review R-1). The exhaustion map is per client (one per `Keco`), keyed by key text, in memory only, and shared by all five operations. `options.now` (default `Date.now`) supplies the wall clock; budgets and timeouts keep `Date.now()`. The 30-second budget still covers the whole key search. `Keco._onKeyExhausted` logs `AIRKOREA KEY_QUOTA operation=<op> keyIndex=<i> code=<code> until=<ISO UTC>`.

## Bounds
Per request with n keys and P pages: each key is used for at most one pass; within a pass each page has at most two attempts (one transient retry). A key never repeats a page after a quota or credential rejection. Worst case n·P·2 attempts, the same bound as the #2737 credential failover, and still capped by the 30-second budget.

## Verification
Offline (`server/test/offline/airkorea-keys-endpoints.test.js`, injected transport and clock): quota on the last key then success on the previous key and memory; every quota form rotates; all keys exhausted → `QUOTA_EXHAUSTED` with one call per key, no HTTP until KST midnight, probing again at 15:00 UTC; exhausted key skipped by later credential failover and mixed failures → `QUOTA_EXHAUSTED`; all-credential → `NO_VALID_KEY`; quota on page 2 restarts with the next key without repeating a page; `KEY_QUOTA` log without key text. Full `npm run test:offline` with the CI dependency set.

Rejected alternatives: continuing at the failed page with the next key (differs from the credential path and needs a per-page key selector; quota normally occurs on page 1); persisting exhaustion in Mongo (not requested; restart cost is one call per key).
