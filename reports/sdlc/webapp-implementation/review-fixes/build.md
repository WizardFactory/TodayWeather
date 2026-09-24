# PR review corrections

Builder: main `/root`. Existing task build iteration 3. Base `01eb787b10cc2694ea52642b8b24ad8c5426503e`; corrections start at PR head `d85960e0b7078a35b6ce5d370d3552a81dbd1bc0`. `candidate.json` binds all 65 relevant source/test/docs files, including new tests; `changes.patch` includes tracked and newly added source changes. Original implementation evidence remains historical.

| Feedback | Author response and implementation | Verification |
| --- | --- | --- |
| C1 | Accepted: remove root ESM scope; each new workspace retains its ESM scope. | All three actual native version modules load with isolated Q dependency stub; web build/typecheck pass. |
| C2 | Accepted CI failure, refined cause: await completed dismiss/accept before next click and count exactly two dialogs. No evidence justified changing the blocker effect. | Actual failed CI trace; repeated Chromium case and full browser suite. |
| C3 | Accepted conditional defect: fresh capabilities and all matching server rule deletions must succeed before local favorite deletion. Unknown/failing state retains the favorite. | Browser abort/503/retry/success; existing push-disabled favorite deletion. |
| C4 | Accepted: current cache wins for shell resources; retained old caches are used only for hashed asset paths. Version digest includes shell and worker bytes. | Actual worker VM plus real two-version Chromium CacheStorage, offline navigation and old chunk; manifest/worker-only digest changes. |
| C5 | Accepted blocking; narrowed minute-loss explanation: claim/dedupe/persist under lock, outbound delivery outside it, global four-send bound, queue revalidation and subscription-identity error cleanup. Missed invocations recover at most five wall minutes; captured invocation time is retained. | Deferred send, concurrent ticks, responsive mutation/read, bounded sends, deletion/revision cancellation, stale 410 and bounded catch-up tests. |
| C6 | Accepted: URL parser permits exact KMA hosts only, upgrades trusted HTTP, rejects credentials/ports/unrelated HTTPS. | Domain URL cases. |
| C7 | Accepted recommendation: preserve existing matching route definitions and check both against one compatibility matrix. | Worker/server route matrix includes decimal coordinates, invalid API/asset paths. |
| C8 | Accepted: known place IDs require catalog coordinates; other IDs must match canonical validated coordinate identity. | Malformed/mismatched ID rejection plus valid catalog/coordinate cases. |
| C9 | Accepted: select valid rain fields, keep missing interval null, distinguish observation/KMA short/world hourly/daily periods, normalize explicit snow separately and display its amount/period. Legacy snapshots remain readable with unverifiable old periods suppressed. | Domain cases, conversion/zero/sentinel/legacy snapshot cases and browser UI. |
| C10 | Accepted: one loopback WEB_ORIGIN determines both Vite bind/port and BFF Origin; production validation stays strict. | Launcher spawn probe and existing actual API Origin rejection tests. |

## Additional failure found during required repetition

The first dialog repetition run had 9 passes and one interrupted navigation. Unlike the original competing-dialog-listener failure, this was caused by the initial service-worker claim triggering a document reload. A deterministic real-browser regression delayed actual registration until a weekday edit, then observed that the claim erased it (`first-claim-red.txt`). App now reloads only when replacing an existing controller. `first-claim-green.txt` verifies the edit survives; updates still reload and worker activation/cache behavior is separately exercised. This is within C2/C4 navigation/update reliability; it does not change the notification contract or require an architectural flow change.

## Limits and evidence interpretation

The first unit Green attempt failed because the isolated web dependency tree lacks legacy Q; the final module probe supplies only that dependency stub and does not invoke native tools. This verifies CommonJS compatibility, not an iOS build. One initial browser assertion expected `2.0 mm`; the existing formatter intentionally renders `2 mm`, so the assertion was corrected. Neither setup/expectation failure is presented as a product defect. Real external weather, real push/device delivery, Docker deployment and full native parity remain release work in issue #2558.

Archify source and generated artifact are updated for split claim/send and recovery behavior; artifact checks and actual Chromium visual checks passed. Main inspected all four diagram captures and the responsive desktop/mobile precipitation layout. No legacy server, collector, production deployment or merge ran.
