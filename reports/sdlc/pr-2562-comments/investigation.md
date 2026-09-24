# PR #2562 comment assessment — 2026-09-24

Assessed head: `d85960e0b7078a35b6ce5d370d3552a81dbd1bc0`. Base: `01eb787b10cc2694ea52642b8b24ad8c5426503e`. Author-side feedback assessment, not independent PR approval. Application code is unchanged.

## Conclusion and comment history

Two issues should be corrected before integration: root package scope breaks native Cordova scripts, and the web verification job fails. The subsequent downgrade concerns favorite deletion and service-worker cache selection; those corrections accurately narrow their affected conditions, but do not fix the two earlier issues.

All ten distinct comments are accounted for below. Seven recommendations identify real conditional functional/validation defects; route-regex duplication is a preventive maintenance recommendation. Two explanations need refinement: the recorded CI failure shows competing handlers for one dialog, and notification queue waiting alone does not erase the invocation-time minute.

Source comments: [initial general review](https://github.com/WizardFactory/TodayWeather/pull/2562#issuecomment-5812187870), [inline review](https://github.com/WizardFactory/TodayWeather/pull/2562#pullrequestreview-5303241479), [correction and additions](https://github.com/WizardFactory/TodayWeather/pull/2562#issuecomment-5812565927). All four inline threads were unresolved at intake.

## Required before integration

### C1 — Root ESM package scope: accept, high confidence

`package.json:5` declares `type: module`; the nearest enclosing scope now applies to existing CommonJS files under `tw.ios/cordova`, `ta.ios/cordova` and `applewatch/cordova`. All three actual `node <platform>/cordova/lib/versions.js` commands fail at their first `require` with exit 1 under Node 22.22.2. The source files are unchanged, but module-loading behavior changed. See [native-module-probe.json](native-module-probe.json).

Preferred remedy: remove root `type` and retain the explicit module scopes in the three new workspaces; root build scripts already use `.mjs`. Alternatively give legacy trees explicit CommonJS scopes. Verify the actual native module load plus web typecheck/build/tests; a source-only unchanged-native assertion is insufficient. This assessment did not execute an iOS build or native tools.

### C2 — Failed web CI: accept; revise the causal diagnosis

[Web verify](https://github.com/WizardFactory/TodayWeather/actions/runs/35985329184/job/107586538548) failed; both RSS jobs passed. The failed browser case is `web/e2e/web.spec.ts:123`. Actual first error: `dialog.accept: Cannot accept dialog which is already handled!`, followed by the URL assertion failure. This is not evidence that the app necessarily shows two confirmations.

The retained [trace extract](ci-trace-extract.json) shows this sequence in milliseconds:

1. First settings click starts at 8161.179.
2. The assertion that the URL is still `/notifications/seoul` starts at 8207.864 and passes before a dialog event. That URL was already true, so this assertion does not await cancellation.
3. The second click starts at 8212.719, after the acceptance listener has been installed.
4. One confirmation event appears at 8221.43.
5. Both the line-131 dismiss handler and line-134 accept handler act on that dialog; the second operation throws.

The directly supported fix is to await each expected dialog and its handling before registering the next phase; await the blocker reset/next actionable state before the second click. Do not substitute a sleep. Then rerun the targeted scenario with repetitions under CI and the full web job. The effect keyed on `blocker` deserves a separate one-confirmation-per-attempt assertion, but this trace does not establish repeated effects as the cause. Preserve the genuine local eight-pass history while explicitly distinguishing the current remote failure.

## Recommended fixes

| ID | Finding and disposition | Evidence and impact | Proposed correction / verification |
| --- | --- | --- | --- |
| C3 | Favorite deletion with unknown capabilities: accept narrowed severity | `web/src/App.tsx:534` skips server cleanup when capabilities are absent, then removes the local favorite. Applies to a push-enabled installation with persisted rules and an unresolved/failed capability query. If capabilities are known enabled and cleanup fails, the existing catch already prevents local success. Push-disabled deployments avoid this issue. | Resolve capability state before claiming full deletion, or show explicit pending server cleanup offline. Cover unknown, disabled, enabled-success and enabled-failure cases. Do not accidentally describe local-only deletion as notification cancellation. |
| C4 | Service-worker cache lookup: accept narrowed severity | `web/public/sw.js:57` searches all caches while activation retains a previous shell cache. Unhashed manifest/icon/direct non-navigation index requests can receive an older response. Known navigations use network first and fall back to the **current** cache at lines 43–50; hashed new assets normally miss the old cache. | Prefer the current cache for the current shell. Retain a deliberate fallback for old hashed assets needed by existing tabs. Test a two-version installation/activation sequence with changed icon/manifest and offline navigation. |
| C5 | Push sends hold the transaction queue: accept; narrow the missed-minute claim | `web-api/src/notifications.ts:244,368,392,404` serializes sends with reads/writes. An injected deferred sender reproduces a blocked settings read. Full-store persistence occurs per delivery. However, `tick(now = new Date())` captures time **before** entering the queue: queued 07:00 and 07:01 calls both send when released. Queue delay alone is not proof of skipped minutes. If no tick is invoked during a scheduled minute (event-loop stall/suspension/restart), the exact-minute matcher has no catch-up. | Claim/dedupe work under the lock, deliver with bounded concurrency outside it, reconcile expired subscriptions under the lock using the claimed subscription identity. Specify a bounded recovery window for genuinely missed invocations. Preserve dedupe and test concurrent rule edits/subscription replacement. |
| C6 | Warning-image URL handling: accept | `packages/weather-core/src/index.ts:472` drops KMA HTTP links but allows arbitrary HTTPS destinations. `server/lib/kmaScraper.js:1508,1552` builds an HTTP KMA URL. Probe: KMA HTTP becomes absent; `https://untrusted.example/...` survives. UI renders an explicit external anchor (`web/src/App.tsx:983`), not a server-side fetch or injected script. | Parse URLs, allow the intended exact KMA hosts (including the existing `www.weather.go.kr`), reject credentials/unexpected destinations and upgrade only trusted HTTP URLs. Verify valid/invalid links; do not claim SSRF or XSS from this observation. |
| C7 | Duplicated SPA-route regex: accept as maintenance | The regexes in `web-api/src/server.ts:77` and `web/public/sw.js:41` are currently identical. No current route mismatch was found. | Share a generated definition if worthwhile, or add one table of valid/invalid navigation URLs applied to both. Include decimal coordinate IDs, API paths and missing assets. Lower priority than functional failures. |
| C8 | Notification place-ID validation: accept | `web-api/src/notifications.ts:105` checks type/length only. The real validator accepts empty ID, `../settings` and `seoul?unexpected=1`. The ID is inserted into `/weather/${id}/hourly` at line 407, yielding malformed/misdirected internal navigation. Requests are installation-owned; same-origin worker handling limits the observed impact. | Accept catalog IDs or validated coordinate IDs consistent with `placeId`/`resolvePlace`, preferably consistent with submitted coordinates. Reject empty strings, slashes, query/hash markers and out-of-range coordinates. Do not label it cross-origin redirection without separate proof. |
| C9 | Precipitation period and missing snow: accept, with source-aware correction | `packages/weather-core/src/index.ts:276` chooses `rn1 ?? r06`, while line 277 tests only `rn1 !== undefined`. Probes produce `{null,6}` with no rain, `{3,1}` with `rn1:null,r06:3`, and `{null,6}` for snow-only. `web/src/Weather.tsx:337` appends the period even when amount is missing. The current v000903 KMA route instantiates `ControllerTown24h`, whose adjustment at lines 145–193 distributes `r06`/`s06` into three-hour rows. | Track the actual selected field and series/source interval; hide the interval when quantity/interval is unavailable. Handle snowfall explicitly with the correct units. Avoid replacing every 6 with 3: current observations, world hourly data and daily totals have different semantics. Cover zero, null/sentinel, mixed fields, snow-only and daily/hourly sources. |
| C10 | Development Origin mismatch: accept conditional failure | `scripts/web-dev.mjs:9` hard-codes `http://localhost:5173`; Vite binds `127.0.0.1` in `web/package.json`. The actual API handler with notifications enabled accepts localhost (200) and rejects numeric-loopback Origin (403 `ORIGIN_REJECTED`). Weather GETs do not exercise this mutation check. | Derive browser origin and dev host/port from one configuration and preserve intentional overrides. If allowing two origins, limit that exception to explicit development mode; keep production mutation checks strict. Test both intended launch URLs and a rejected unrelated origin. |

## Evidence and limits

- Read all remote comments, correction replies, exact head/base, and current check results. No reply, thread resolution or PR approval was posted.
- Downloaded the existing failed CI log/trace; [ci-failure.txt](ci-failure.txt) and the filtered trace retain the decisive events. This is inspection of an actual remote execution, not a new browser execution.
- Ran [probes.mts](probes.mts) with `node --import tsx reports/sdlc/pr-2562-comments/probes.mts`; [probes.json](probes.json) records actual adapter, validator, transaction and Origin outcomes. The sender and HTTP request/response objects are synthetic; no external push/provider call or listening server was used. The first Origin harness attempt omitted the required upstream config and failed setup; the corrected harness passed. That setup failure is not an application defect or red regression evidence.
- Independently invoked the three existing native version modules; each reproduced the ESM scope error. No dependencies, native build or collector were started.
- Cache/favorite behavior is source-supported; no new two-version browser or offline capability-race reproduction was claimed. No full suite rerun was necessary for this review-only task.
- Recommended order: C1/C2; then precipitation correctness and current-cache selection; then conditional notification/Origin/URL validation fixes; finally route-definition maintenance. Validate corrected implementation and CI before changing the integration verdict.
