# Execution plan: issue-2636-r2
Owner: Claude (Anthropic), main context. Inputs: [intent](../intent/issue-2636-r2.md), [spec](../specs/issue-2636-r2.md). Endpoint: pre-merge (no merge, no deployment).

## Ordered work
1. Offline tests first (`server/test/offline/airkorea-keys-endpoints.test.js`, fixtures `msrstn`, `nearby`, `frcst` trimmed from 2026-10-13 read-only probes): key skip order and memory, wrap-around, no switch on quota/timeout/5xx/payload, `NO_VALID_KEY`, sanitized logs, supported URL/parameters, page assembly and consumer shapes for station list, forecast and nearby, item `serviceKey` removal, no legacy host in source. Confirm intended Red.
2. `server/lib/airkoreaObservation.js`: operation table, generic paged `query`, 401/403 and gateway-body classification, `fetchWithKeys`/`queryWithKeys` with remembered key index and `onKeyRejected`.
3. `server/lib/kecoRequester.js`: route station/sido, station list, forecast and nearby requests through the client; remove `request`, `_jsonRequest`, `_checkLimit` and index recursion; add `_onKeyRejected` log.
4. Register the test in `server/test/offline/run.js`; run the full offline runner and the existing nation smoke.
5. Real smoke `server/test/e2e_local/airkorea-collection-smoke.js`: the operator key list, real provider, in-memory MongoDB, production schemas, readback through `kecoController`.
6. Documentation: `docs/architecture/weather-collection.md`, `docs/operations/airkorea-recovery.md`, `docs/rewrite/external-providers.md`, `docs/rewrite/security-and-privacy-inventory.md`, and the Archify sources/HTML `weather-collection` and `nation-air-recovery`.
7. Commit, push, PR, CI, cross-provider PR review and correction; stop at merge-ready.

## User scenarios
See [issue-2636-r2.scenarios.json](issue-2636-r2.scenarios.json).

| ID | Covered by |
| --- | --- |
| S1 scheduled collection with an expired last key | offline key tests; real smoke (5 configured keys, expired last) |
| S2 quota exhaustion | offline `quota ... never move to another key` |
| S3 no valid key | offline `NO_VALID_KEY` test |
| S4 gather startup station list | offline station-list test; real smoke (672 stations) |
| S5 scheduled dust forecast | offline forecast tests; real smoke |
| S6 operator rollout | operations runbook (not executed) |

## Migration, rollback and blast radius
No schema or data migration. Blast radius: AirKorea collection in the gather process (station, sido, station metadata, forecast) and the unused nearby lookup. Rollback: restore the previous `server/lib` revision; stored rows remain valid. Riskiest point: key rejection classification; quota must never switch keys (tested).

Rejected alternatives: configuration-only reordering; rotation on quota; keeping the legacy host for metadata/forecast.
