# Independent verification: issue 2560

**Current result: PASS (iteration 3).** All Must Fix findings are closed. The iteration 1 and 2 records below are retained as historical evidence. This local independent-verification PASS is not cross-provider PR review or live recovery.

## Scope and identity

Iteration 1, executed 2026-09-24 at approximately 08:45–08:50 UTC. Verdict: **CHANGES_REQUIRED**. This is an independent, same-provider local verification context, not cross-provider PR review. Base: `01eb787b10cc2694ea52642b8b24ad8c5426503e`; candidate: uncommitted worktree diff plus new policy/tests. No production host, application startup, actual HTTP, DB connection, collector timer, credentials, remote write or commit was used.

Read repository instructions, the shared SDLC policy and installed verification contract, architecture index/collection path, and this task's intent/spec/plan/investigation. Inspected parser dispatch, both persistence paths/schema/projection, service merge/formatter/date logic, v000903 middleware ordering and RSS retirement.

Candidate SHA-256 at verification:

| File | SHA-256 |
| --- | --- |
| `server/lib/midForecastPolicy.js` | `23a34a792ea3bef32b9597e73ff92ccc5016d3f403a619d2dedbc86a0129d50a` |
| `server/controllers/controllerTown.js` | `84d62c8330df80ed970550c652d12ee6f8c11b898e759e0506e64d4986f6c2a9` |
| `server/lib/collectTownForecast.js` | `dde9f078fc34bc01fc2594048ddaecb705e4e208c25ec2c043ffdfeda8ccd0a1` |
| `server/controllers/kma/kma.town.mid.controller.js` | `176ac3249916445f350d1f55e96320f381eca914b50c9762b09b64c2f4899c68` |
| `server/lib/midRssKmaRequester.js` | `56f8fbad2030fb9112470a303f9507cd4762f9447286fcd3a4efe69d9e6bf011` |

## Executed checks

Runtime: Node `v22.22.2`; isolated dependencies resolved using `NODE_PATH=/tmp/issue-2560-offline/node_modules`: Mongoose `5.1.2`, async `2.6.4`, sprintf `0.1.5`, xml2js `0.4.23`, Mocha `2.5.3`.

| Command/scenario | Actual result |
| --- | --- |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test server/test/offline/daily-forecast.test.js server/test/offline/rss-wind.test.js` | Exit 0, 60 tests passed (17 daily, 43 existing RSS/wind regressions). |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/run.js` | Exit 0, 103 Mocha checks passed plus synthetic gather/storage smoke. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test /tmp/issue-2560-independent-checks.js` | Exit 1, IV-1 and IV-2 failed as described below; IV-3 and IV-4 passed. |
| IV-3: actual `getMid`, no textual forecast in stub DB, fresh complete day-4 land/temp | One completion callback; `20260928` available. Missing text does not block usable primary data. |
| IV-4: actual `getMid -> getMidRss -> convertMidKorStrToSkyInfo -> mergeMidWithShort`, both primary datasets absent | All callbacks complete; valid today's short output remains, daily health false. |

An initial broad `node --test server/test/offline/*.test.js` invocation exited 1 because `gather-code-drift.test.js` uses Mocha's `describe`; its other 60 tests passed. This was a verifier command-selection error, not a product failure. The correct separate commands above subsequently passed.

The checked suite exercises captured day 4–10 values, legacy day 3, malformed envelopes, absent measurements, both real Mongoose schema casts with persistence stubbed, Manager handoff, both service projections, 06/18 KST identity, year/month boundaries, target-date joining, publication age, future/identity mismatch, seven-day history, honest day-3 gap, stale land/current temp/obsolete RSS, retired RSS on empty/populated lists, HTTP 401/error redaction and HTML/malformed XML rejection. The parser success and DB round-trip assertions are separate executed checks; no live provider contract is inferred. RSS publication precedence is uniformly disabled rather than replaced with an unverified URL.

## Must Fix findings

### IV-1 — Entirely unrecognized land weather is emitted as valid collection data

**Severity:** MEDIUM (requirement violation, Must Fix). **Category:** validation. **Location:** `server/lib/midForecastPolicy.js:21`, `parse` usable counter. **Confidence:** high. **Disposition:** open.

`weather()` checks only that text is nonempty. With a synthetic success envelope containing only `{regId:['11B00000'], wf4Am:['not weather']}` and options `{date:'20260924',time:'0600'}`, real `organizeLandData` emits `recvData` carrying this unrecognized string. No `recvFail` occurs. The consumer later rejects the same value, so an entirely unusable publication can be persisted as a successful collection and block retries until the next publication.

Requirement A says invalid data must fail in a controlled way and entirely empty/invalid forecasts must not emit success. The spec describes usable weather. Count recognized supported weather toward usability (preserving legitimate partial horizons) and add an unknown-only regression; an unrecognized-only response must fail without exposing provider text or keys.

Reproduction uses the real collector via the existing offline harness:

```js
const c = h.prepare(h.collector());
c.on('recvData', () => events.push('recvData'));
c.on('recvFail', () => events.push('recvFail'));
c.organizeLandData(0, h.response([
  {regId:['11B00000'], wf4Am:['not weather']}
]), {date:'20260924', time:'0600'});
// Expected ['recvFail']; observed ['recvData'].
```

### IV-2 — Partial invalid short weather overwrites valid mid weather and fabricates zero quantities

**Severity:** HIGH. **Category:** service merge/data validity. **Location:** `server/controllers/controllerTown.js:2889` (`mergeMidWithShort`, `_getDaySummaryListByShort`, `_mergeList`). **Confidence:** high. **Disposition:** open.

The added summary filter checks only temperature completeness and aggregate sky. `_mergeList` then copies every summary property. Start with a valid mid day `20260928`, `taMin:14`, `taMax:24`, `wfAm/wfPm:'맑음'`, sky/AM/PM sky `1` and pty/AM/PM pty `0`. Supply two synthetic short slots for that date at `0900` and `1500`, each with valid `tmn:10`, `tmx:24`, `t3h:20`, `reh:50`, `sky:1`, but `pty/pop/r06/s06/wsd/lgt:-1`. Run real `mergeMidWithShort`.

Observed daily row has `wfAm/wfPm:'구름적고 '`, `pty/ptyAm/ptyPm:-1` and fabricated `r06:0`, `s06:0`, `lgtAm:0`, `lgtPm:0`. The earlier mid formatter cannot protect this because it executes before the short overlay. The result retains a daily record whose valid weather has been replaced by an unrecognized phrase and whose missing quantities became zero.

Requirements A/B prohibit missing fields becoming default weather/zero precipitation, and the task spec explicitly says invalid/sentinel short fields cannot erase a valid mid row. Validate source fields before aggregation or overlay, with explicit missing-data handling; do not derive validity solely from aggregated values. Verify both overlap and short-only cases, including otherwise valid sky/temperature with missing precipitation/lightning. IV-2 currently fails on the first corrupted weather assertion; direct inspection also established the fabricated zero quantities.

## Limits and next gate

The successful checks do not establish live recovery, nationwide coverage, provider schema guarantees, production credentials, actual Mongo persistence, native builds, or deployed revision. Main owns the actual route smoke, final documentation/diagram verification and deployment/rollback checklist; they were still in progress during iteration 1. The candidate needs both Must Fix findings resolved, matching regressions and smoke rerun, followed by renewed independent verification before PASS.

## Iteration 2: corrections and extended challenge

Executed 2026-09-24 at approximately 08:51–08:54 UTC. Verdict: **CHANGES_REQUIRED**, with the original IV-1 and IV-2 findings **closed** and one newly isolated missing-value case, IV-5, open. Same local scope and dependency/runtime versions apply.

The weather validator now matches supported formatter strings, preventing unknown-only collection success. Short overlays require recognized AM/PM weather, remove unavailable sum/lightning values, gate source publication at 24 hours, and cap targets at publication day +4. The v2 mid read explicitly sorts descending publication; inspected temperature schemas omit former sentinel defaults.

Reexecuted:

- `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test server/test/offline/daily-forecast.test.js server/test/offline/rss-wind.test.js`: exit 0, **62/62 passed** (19 daily and 43 existing RSS/wind tests).
- `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js`: exit 0, **16/16 scenarios passed**. Inspected its imported harness: actual Express middleware runs in memory without an HTTP socket; provider/model/timer boundaries are replaced before module evaluation. Both DB versions and Celsius/Fahrenheit responses cover captured, stale, missing-text and missing-temperature paths; correct date gap, current short data and seven-day observation history persist.
- Updated the independent IV-2 and IV-4 requests with `shortPubDate:'202609241400'`, so the new freshness guard does not simply bypass the behavior under test. `/tmp/issue-2560-independent-checks.js` initially passed IV-1 through IV-4. After adding IV-5, the same command exited 1 with **4 passed, 1 failed**.

### IV-5 — Missing short source temperatures become a plausible daily mean

**Severity:** MEDIUM (requirement violation, Must Fix). **Category:** missing temperature/response validity. **Location:** `controllerTown.js`, short-summary numeric cleanup and `_getDaySummaryListByShort`. **Confidence:** high. **Disposition:** open.

Synthetic reproduction: fresh `shortPubDate:'202609241400'`, empty mid daily list, two slots dated `20260925` at `0900`/`1500`; both have `tmn:10`, `tmx:24`, `t3h:-50`, `reh:50`, `sky:1`, `pty:0`, and `pop/r06/s06/wsd/lgt:-1`. Actual `mergeMidWithShort` returns a otherwise usable daily row with `t1d:-1`. Legacy `_average` returns `-1` after all sentinel source temperatures are removed. The new cleanup intentionally permits negative `t1d` and therefore exposes that fallback as a plausible temperature reading.

Issue A's missing-data contract prohibits sentinel-as-real temperature values. Omit `t1d` when there is no valid source temperature for the date, or compute it only from validated temperatures; preserve legitimate negative temperatures, including a real mean of -1. The IV-5 check asserts absent mean for sentinel-only input and preserves real -1 in its second fixture. It currently fails at the first assertion (`-1 !== undefined`). This is distinct from, and does not reopen, the repaired weather/precipitation overwrite reproduction in IV-2.

## Iteration 3: final independent result

Executed 2026-09-24 at approximately 08:54–08:56 UTC. Verdict: **PASS** for the scoped local independent verification. **IV-1, IV-2 and IV-5 are closed; no unresolved Must Fix finding remains.**

Inspected the latest short-source normalization: invalid temperature fields become the existing internal -50 sentinel before summary; optional numeric fields are validated before aggregation; the daily mean is omitted unless that date actually has a valid temperature input. This closes IV-5 without discarding a legitimate negative mean. The builder's regression also exercises -999, NaN, null and undefined. Missing, stale and future short publications preserve allowed history while preventing new forecast rows.

Final executed checks, all exit 0:

| Command | Actual result |
| --- | --- |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test /tmp/issue-2560-independent-checks.js` | **5/5** independent checks passed. IV-5 verified both absent sentinel-only mean and real -1 mean. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/run.js` | **103** Mocha checks, gather functional smoke, **22** daily tests and **43** RSS/wind tests passed. The updated runner explicitly includes both Node test files. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js` | **16/16** complete v000903 middleware scenarios passed, covering both DB versions, both temperature units and captured/stale/missing-source cases. |

Reviewed the completed daily contract, affected architecture prose and deployment/rollback checklist against the source. They document the gap, missing-row compatibility, 36-hour primary/24-hour short policies, explicit retired RSS disposition, separate credential work and operator-only recovery verification. No guessed replacement feed, live deployment or credential modification is claimed. Main owns final Archify artifact/browser/visual receipts and state validation; this report does not claim to have independently performed perceptual diagram review.

Final candidate source SHA-256 (same base `01eb787b10cc2694ea52642b8b24ad8c5426503e`):

| File | SHA-256 |
| --- | --- |
| `server/lib/midForecastPolicy.js` | `4bb35ebaaa220b4924fd08559c8a079accbedc963034d2380ec199c57625ce29` |
| `server/controllers/controllerTown.js` | `7f19ea0bbf5d7358bcde966ebd68e808b8a7b377f41d7007356bcd7d27df13d3` |
| `server/lib/collectTownForecast.js` | `dde9f078fc34bc01fc2594048ddaecb705e4e208c25ec2c043ffdfeda8ccd0a1` |
| `server/controllers/controllerManager.js` | `7ca4184e95e1cbf9ab9ae6860d59506613d4383a4103e632be6b07d092dc2804` |
| `server/controllers/kma/kma.town.mid.controller.js` | `5b9c06658411e8eadac2302d6f1bc9b883eba30f3c0b6eee5e9938d28708fe87` |
| `server/controllers/kma/kma.town.mid.rss.controller.js` | `dc5e0243731d252bd21d628c4d7ee499da4bd4ab0ee47ea0f2fc94ba0ab0585a` |
| `server/lib/midRssKmaRequester.js` | `e1027e7b3b076b0e42c9129be472fe5cce040fe68e432fce290e3b40943b5f79` |
| `server/models/modelMidLand.js` | `11374af9372afe5ac755c89b4b3ad01b795f8feccbb488a46c1af00de1eabb81` |
| `server/models/modelMidTemp.js` | `3c98f2c1f29c209641d58f28e47d725f23ecf1c590257220a06a57706dc4d324` |
| `server/models/kma/kma.town.mid.land.model.js` | `ae86961387e498dde9dcbd7cb86573b0fd8e91a4ef1871e96a782df14a648f85` |
| `server/models/kma/kma.town.mid.temp.model.js` | `70580e4f38d34dc7fb342e6b38bcd22788c4f4c83405d80b075a7662c079809a` |

All earlier production, actual DB, provider contract, native build and cross-provider-review limitations remain. The successful local evidence supports implementation acceptance; it does not establish operational recovery.

### Final safeguard refresh within iteration 3

Before handing off this iteration, the builder added failed-write cleanup protection, sanitized low-level RSS parse errors and integer validation for short sky/pty/lightning fields. Inspected these edits and reran all three final commands above on the final digests: 103 Mocha + gather smoke + 22 daily + 43 RSS/wind checks, 16 response scenarios and all five independent checks passed. The digest table and counts above refer to that refreshed final candidate.

An additional inline isolated Node probe exercised real `saveMid` with a stub update failure under **both overwrite=true and overwrite=false**: each called back once with the failure and performed **zero prune calls**. The same probe passed malformed RSS XML containing a synthetic marker and confirmed the returned error and captured logs did not contain the marker. It exited 0. Source inspection confirms categorical noninteger short values are normalized to unavailable before aggregation. No new mandatory finding was identified.

### Final evidence reconciliation (08:57 UTC)

The sole subsequent production edit removes one trailing space from the sanitized RSS XML-error return. Independently reconstructed the previous bytes by reinserting that one space and obtained the previously tested SHA-256 `63961e8c0b2fe6a8f8190266443b73cacbdf289d4f0b8c943a7cbdd41f9040e8`, proving no semantic source change. The final table now records `e1027e7b3b076b0e42c9129be472fe5cce040fe68e432fce290e3b40943b5f79`. `git diff --check` passed. Reuse of the unchanged behavioral checks is justified.

Inspected the separate original RSS response smoke fixture correction: the `older` RSS case now uses short publication `202609240900` instead of `202609241100` at the fixture's 09:10 KST clock. It remains newer than the 08:00 RSS publication and no longer incorrectly exercises future-short rejection. The daily-response smoke uses the `newer` case, so its 16 scenarios are unaffected. Inspected the builder's `original-route-smoke.log`, which records **36 passing scenarios** and the matching production controller digest. This is reviewed builder evidence, not an independently rerun 36-scenario execution. No finding or verdict change: **PASS**.
