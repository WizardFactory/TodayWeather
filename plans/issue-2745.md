# Execution plan: issue-2745 (legacy)
Owner: Claude (Anthropic), main context. Inputs: [intent](../intent/issue-2745.md), [spec](../specs/issue-2745.md). Endpoint: pre-merge (no merge, no deployment). The server2 change is a separate PR (S13c).

## Ordered work
1. Red: change the two tests that asserted "quota never switches keys" and add the #2745 tests in `server/test/offline/airkorea-keys-endpoints.test.js`. Result before the fix: 7 of 21 failed for missing behavior.
2. `server/lib/airkoreaObservation.js`: quota codes, KST day end, exhaustion map, `withKeys` loop, `onKeyExhausted`. `server/lib/kecoRequester.js`: `_onKeyExhausted` log.
3. Green: the file (21/21), full offline runner, ES2017 parse of changed runtime files.
4. Docs: `docs/architecture/weather-collection.md`, `docs/operations/airkorea-recovery.md`, `docs/operations/data-go-kr-keys.md`, `docs/rewrite/external-providers.md`; Archify `weather-collection` JSON and HTML through `finalize`.
5. Commit, push, PR, CI, Codex review loop; stop at merge-ready.

## User scenarios
See [issue-2745.scenarios.json](issue-2745.scenarios.json).

| ID | Covered by |
| --- | --- |
| S1 last key at quota, others work | `#2745 quota on the last key continues ...`, `every quota form moves ...`, keco log test |
| S2 every key at quota | `#2745 every key exhausted fails as quota ...` |
| S3 credential and quota mixed | `#2745 an exhausted key is skipped by later credential failover ...` |
| S4 quota during pagination | `#2745 quota on a later page restarts ...` |
| S5 operator reads logs | runbook step 2; keco log test |

## Migration, rollback and blast radius
No schema, data or configuration change. Blast radius: AirKorea key selection in the gather process. Rollback: restore the previous `server/lib` revision. Riskiest point: spending other keys' quota faster; accepted by AK's decision.
