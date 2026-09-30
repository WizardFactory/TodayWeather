# Independent verification — issue-2636, iteration 1/10, endpoint pre-merge

- Reviewer: paseo-claude (Anthropic), Claude Opus 5.5. Effective model/effort/mode: see `configuration.json`.
- Author: paseo-codex (OpenAI Codex), context human-falcon/root.
- Date: 2026-09-29. Scope: read-only snapshot `/tmp/issue2636-review/candidate`. Outputs were written only to `/tmp/issue2636-review/output`.
- No network, provider APIs, secrets, production config, git operations, PR messages, delegation or permission changes were used. No subagents were used.

## Verdict: **CHANGES_REQUIRED**

One confirmed Medium correctness defect needs fixing (F1). It breaks the user's explicit amendment that nation fallback use the exact domestic global-air flow. The other findings are Medium/Low operational or specification gaps. They can be dispositioned by fix or documented acceptance. Everything else passed my checks: the supported collection client, strict parsing, KST handling, bounded transport, acknowledgement, bounded parallelism, secrecy and nation partial-failure behaviour.

## Candidate identity

| Item | Value | Verified |
| --- | --- | --- |
| Candidate | `source-sha256:3cab1ce96695a7f651bbecd9a15af32e3a6b3bd523c137ea3681730c8cec4e8c` | Reproduced as `sha256(json.dumps(candidate.json.files, sort_keys=True))` |
| Base | `39a3336fb2730dfbe9920c62165a2b632874af1e` | Declared only; the snapshot has no git history |
| 13 per-file hashes in `candidate.json` | all match `shasum -a 256` of the snapshot files | yes |
| PR #2643 / commit `650f3fb2738e4e5c1a280bb0f706c896000f09ae`, "15 CI checks passed" | Reported by the author after the review started | **Not verified**: no network or git access. The later PR review is a separate duty. |

Consumed input hashes (sha256):

```
7a562fe5936ec043a8f721b7e6b8a33ba2bc49c65f3176888531428f0d7eebf4  AGENTS.md
d8b28d78e96f5ce28472d3519e7114486b592b53d0eda4839ab3b8e0572cea7a  intent/issue-2636.md
2d2cda33097a2e211f4d67f6b172a59cc926d2c54e44b1d1bb5c2a5886aecd14  specs/issue-2636.md
c931781b5d56cb45f1d1d1bbf15600318685e91e9df7996e887ef90cfba70a02  plans/issue-2636.md
f59317887930ea1453e04ef8c0f31e44d1a71e778130d77245f96b54ef67153e  reports/sdlc/issue-2636/artifacts.json
709eae4ff3541492d72c42143c61bd97c92b938ee25e4d4c8adf6fade233acb8  reports/sdlc/issue-2636/amendments.md
b48b6a502bc25885a64d494beaacaf4877568de6f7db3ff532238544de671279  reports/sdlc/issue-2636/candidate.json
3ebf6550de58a3eabf2ef6ac80da5497d4881eefde79871b0ff94ab6f1916dea  reports/sdlc/issue-2636/source.diff
1419f39af52191300238668548079b09243ca7e2475fac0bdf179d27904d99ec  reports/sdlc/issue-2636/build.md
a59556fdfb79edd833ca55bf98da6ae69aa0670cc97e398f05b1a9e55a0c5063  reports/sdlc/issue-2636/self-verification.md
e08cba0b7230434f699048d9f9d0ecb9aeee32e7a7fa6e7b92ef8f5c844df444  reports/sdlc/issue-2636/test-results.json
31c908a959fb04a7e3d8f731ed7ecccb9f2f45d8aa13c16f619c797d1f97c05b  reports/sdlc/issue-2636/operations.md
```

Reviewer artifacts: `adversarial.test.js` (sha256 `f2256ef0…0811c`) and `boundary-probe.test.js` (sha256 `d3ce797d…e60811c`), plus logs in this directory.

## Executed commands and outcomes

All commands ran on the host: macOS darwin 25.6.0, Node v24.19.0, cwd `candidate/server`, `NODE_PATH=/tmp/issue2636-deps/node_modules`.

| # | Command | Outcome | Log |
| --- | --- | --- | --- |
| 1 | `TZ={UTC,Asia/Seoul,America/Los_Angeles,Pacific/Kiritimati} node test/offline/airkorea-collection.test.js` and `… nation-air.test.js` | exit 0 in all 4 zones; 16/16 and 10/10 passed | `focused.log`, `focused-detail.log` |
| 2 | `MONGOMS_DOWNLOAD_DIR=/tmp/issue2636-mongodb TZ=UTC node test/offline/airkorea-nation-smoke.js` (real loopback HTTP, MongoDB 7.0.14 local, mongoose 5.13.23, synthetic providers) | exit 0. Result: `stationRows:3, provinceRows:1, nationRows:17, weatherRows:15, globalRequests:16, maxGlobalConcurrency:4, clientAirKoreaRequests:0, cacheRows:16` | `smoke.log` |
| 3 | `node test/offline/run.js` (full explicit offline runner) | **exit 1**. All suites before `vc-weather.test.js` passed, including the new ones (16 and 10). `vc-weather` T11 failed with ENOENT because the review snapshot lacks `tw.ios/`. The runner stops at the first failure. | `offline-runner.log` |
| 4 | The 8 runner suites after `vc-weather`, run individually | 7 passed. `overseas-uv` had 1 failure, again ENOENT on missing `ta.ios/` in the snapshot. Both failures are environmental, outside the diff, and unrelated. | `offline-remaining.log`, `rest-*.log` |
| 5 | `TZ=America/Los_Angeles node /tmp/issue2636-review/output/adversarial.test.js` | exit 0, 25/25. The first run had 3 failures, all caused by my own test setup: the harness has an empty `_sidoList`, and one B5 page fixture was internally inconsistent. I fixed the tests; the candidate was unchanged. | `adversarial.log` |
| 6 | `node /tmp/issue2636-review/output/boundary-probe.test.js` | exit 0, 3/3. Confirms F1 (see below). | `boundary-probe.log` |

## Acceptance criteria assessment (offline scope only)

| AC | Assessment |
| --- | --- |
| AC1 supported station/sido, success/error fixtures, no invalid writes | **Pass (offline).** The client uses HTTPS `B552584` `ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` (ver 1.3) and `ArpltnStatsSvc/getCtprvnMesureSidoLIst` (HOUR) with `returnType=json`. Raw and encoded keys produce identical URLs (B1). These are rejected before any write: auth failures in JSON, XML and plain forms, redirect/401/429, provider codes, malformed envelopes, pagination inconsistencies, empty input, null rows, foreign sidoName and blank identity (A3, B3–B6, C1: zero writes across 17 provinces). |
| AC2 bounded collection, sanitized timestamps, KST/storage stability | **Pass (offline)**, with F3 and F5 noted. Each attempt has a whole-attempt deadline (a slow-drip body is cut at about 40 ms in B7). There is a byte cap, no redirects, one transient retry per request, no retry once the budget is spent (B8), and no outer retry multiplication. The KST parser handles leap days, 24:00 and year rollover, and rejects malformed times in 4 host zones (A1). Numbers and grades are strict (A2). Keys do not appear in logs, console output or errors (C1). Station and aggregate writes are both acknowledged before success (C2, C3). The overlap guard exists but has no stale-run release (F3). |
| AC3 station-derived province aggregate, nation values/grades, coordinate contract | **Pass (offline).** The aggregate uses the latest urban (`도시대기`) time and averages only finite non-negative values. The real Mongo readback returns 17 rows in the smoke test. Grades are recalculated by `recalculateValue` for both AirKorea and fallback rows. The coordinate fallback order is unchanged (the nation service is additive and `airFallback` is unmodified). |
| AC4 controlled deployment/rollback, explicit remaining live evidence | **Pass as documentation.** `operations.md` has a stop condition for key renewal, readback, the 17-label check, device checks, rollback and honest limits. Gaps: F2 (budget impact not quantified) and F5 (which key is used is not stated). No live, device or entitlement evidence exists; this is correctly declared pending. |
| AC5 nation fallback via the shared global-air chain: provenance, budgets/cache, bounded, weather retained | **Partially fails. F1 violates "EXACT existing domestic global-air flow".** Otherwise verified: it calls the same `airFallback.getArpltn` used by `controllerTown24h`. It makes no request-time AirKorea calls (smoke: 0). Concurrency is at most 4 (C5, D3, smoke). One deadline covers both the DB read and fallback; no new calls start after it (D6). Late or double callbacks cannot mutate a returned result (D1). Fallback rows cannot forge `province-average` or sidoName (D4). Invalid, future, negative or string PM is never zero-filled (D2). Weather is retained. Status gap: F4. |

## Findings

### F1: Nation re-applies a stricter freshness check than the shared global flow and drops observations the shared flow accepted
- **Severity:** Medium
- **Category:** correctness / spec-conformance
- **Location:** `server/lib/air/nationAir.js:18-23` (`usable`) and `:60` (applied to the `airFallback` result); compare `server/lib/air/observation.js:119-130` (`evaluate`).
- **Evidence:** `evaluate` rejects an observation only when `age > 8h`. `nationAir.usable` then requires `age < 8h`, and it computes that age from the minute-truncated KST `dataTime` produced by `kstDataTime`, not from `observedAt`. Probe results (real `observation.evaluate` feeding real `nationAir`, request time `2026-09-29T14:00:00Z`):
  - `observedAt 06:00:00Z` (exactly 8h): `{sharedAccepted:true, nationAccepted:0, reasons:["fallback-unavailable"]}`. This matches the author's report.
  - `observedAt 06:00:30Z` (7h59m30s): also `nationAccepted:0`. Truncating to `15:00 KST` makes the age exactly 8h.
  - `observedAt 06:01:00Z`: all 17 accepted.
- **Impact:** The divergence window is up to about 1 minute per observation, not only one exact instant. During it, an observation that domestic weather displays for the same cell is dropped from the nation map. The province's status then reads `fallback-unavailable`, which is misleading because it hides a known stale-boundary case. Per-occurrence impact is small, but it directly contradicts the user's amendment requiring the exact same flow, and the double evaluation hides the reason.
- **Repro:** `node /tmp/issue2636-review/output/boundary-probe.test.js`
- **Requirement:** amendments.md ("same global-air flow as domestic weather"); spec §Nation response.
- **Confidence:** High (executed).
- **Disposition:** **Must fix.** Accept the shared flow's verdict for fallback rows: apply only the structural PM/number check, or reuse `observation.evaluate`'s window. Keep the strict `usable()` for stored AirKorea rows only. Add a boundary regression test at exactly 8h and at 8h minus 30s.

### F2: Nation fanout can exhaust the shared Google free-tier budget used by domestic and overseas air
- **Severity:** Medium
- **Category:** operational / budget
- **Location:** `server/lib/air/nationAir.js` (17 fixed cells), `server/config/air.js` (`googleMonthlyCap` 10000, `RESERVE` 0.05, `CACHE_TTL_MS` 30 min, `FAILURE_CACHE_TTL_MS` 2 min), `operations.md`.
- **Evidence:** The operating AirKorea key is expired (amendments.md). As a result, every nation request falls back for all 17 provinces. With `FREE_ORDER` starting at google and a 30-minute success TTL, sustained nation traffic re-fetches up to 17 cells every 30 minutes: 17 × 48 × 30 ≈ 24,480 calls per month. The usable Google cap is about 9,500 per month.
- **Impact:** Budget caps prevent overspend, which is correct. However, the shared Google allowance could run out about 12 days into a month. Domestic town and overseas requests would then fall back to lower-priority providers. The spec lists "increased bounded per-nation call fanout" as a risk, but `operations.md` does not quantify it or give a decision point.
- **Repro:** Arithmetic from the checked-in policy constants. No live traffic data was used.
- **Requirement:** spec "No new quota/provider logic"; intent risk list; AC5 "budgets/cache".
- **Confidence:** Medium. It depends on actual nation request frequency and on overlap with domestic cells.
- **Disposition:** At minimum, document the expected consumption and a monitoring/stop threshold in `operations.md` before rollout. Operator decision on whether nation should get a separate or lower budget share. Not code-blocking for pre-merge if the operator accepts it.

### F3: The scheduled-run overlap guard has no stale-run release
- **Severity:** Low
- **Category:** reliability
- **Location:** `server/lib/kecoRequester.js` `cbKecoProcess` / `cbKecoSidoProcess` (`_collectionRunning`).
- **Evidence:** Transport is bounded, but storage acknowledgement is not. Adversarial test C4 uses a write that never acknowledges; the first run never completes and every later run returns `ALREADY_RUNNING` indefinitely. Mongoose 5.1.2, used in production, buffers operations while disconnected and has no buffer timeout.
- **Impact:** A hung DB acknowledgement silently halts station or sido collection until the process restarts. It would only show up as repeated `ALREADY_RUNNING` errors on `/gather/keco` (logged by `routeGather`).
- **Repro:** adversarial C4.
- **Requirement:** spec "Bound overlapping scheduled runs per process".
- **Confidence:** High for the mechanism; low-to-medium likelihood in practice.
- **Disposition:** Recommended: add a max-age release (for example 2× the expected run bound) or a per-province write timeout, plus a test. Alternatively, document it in the runbook as a known stop signal.

### F4: `airStatus` does not distinguish stale stored AirKorea rows from invalid ones
- **Severity:** Low
- **Category:** spec-conformance / observability
- **Location:** `server/lib/air/nationAir.js:87`
- **Evidence:** A stale row (13.5h old) and a row with negative PM both produce `airkorea: 'unusable'` (adversarial D5).
- **Impact:** The operator runbook asks to attribute coverage gaps. "Stale" (collection stopped) and "invalid" (provider data problem) have different causes.
- **Requirement:** spec "distinguishing missing, stale, DB read errors and fallback failure/deadline".
- **Confidence:** High.
- **Disposition:** Recommended fix: report `stale`, `future` and `invalid` separately. Small change.

### F5: Collection uses the last configured key, but the runbook does not say which key is used
- **Severity:** Low
- **Category:** operational / documentation
- **Location:** `server/lib/kecoRequester.js` `getCtprvn` (`_svcKeys.length-1`) vs `getUrlCtprvn` (`_svcKeys[0]`); `operations.md` step 2.
- **Evidence:** In adversarial C6, keys `['old-expired','renewed']` lead collection to use `renewed`, while `getUrlCtprvn` builds its URL with `old-expired`.
- **Impact:** The key is being renewed separately. If the operator puts the new key first while keeping the old one, collection keeps using the expired key and every province fails with `PROVIDER_30/31`.
- **Confidence:** High.
- **Disposition:** Document it in `operations.md` ("the last array element is used; keep exactly one valid key"), or use one consistent index.

### F6: The nation air deadline runs before the weather step
- **Severity:** Low
- **Category:** performance
- **Location:** `server/routes/v000803/route.nation.js:152` (`[checkQueryValidation, getSidoArpltn, getWeather]`).
- **Evidence:** The air service waits up to `AIR_RESPONSE_DEADLINE_MS` (default 4000 ms) before the 15-city weather fan-out starts. Previously this step was a quick DB read.
- **Impact:** Cold cache, or the failure cache expiring every 2 minutes while providers are failing, adds up to 4 s to nation responses on routes v000803/v000901/v000902/v000903. Correctness is unaffected.
- **Confidence:** High (source).
- **Disposition:** Optional. Run air and weather concurrently, or accept and document the latency.

### F7: Strict item `sidoName` equality can reject a whole province if provider labels differ
- **Severity:** Info
- **Category:** live-compatibility risk
- **Location:** `server/lib/airkoreaObservation.js:63`
- **Evidence:** Any item whose `sidoName` differs from the requested short name causes `INVALID_OBSERVATION` for the whole batch (A3). This is intended strictness. However, 강원 and 전북 were renamed to 특별자치도 in 2023 and 2024, and I could not verify offline which labels the live API returns in items.
- **Confidence:** Low.
- **Disposition:** Add to the live readback checklist: confirm all 17 provinces, including 강원 and 전북, succeed after key renewal.

### F8: The duplicate guard is per station and time only
- **Severity:** Info
- **Category:** data-quality
- **Location:** `server/lib/airkoreaObservation.js:66`
- **Evidence:** One batch containing the same station at two hours yields two rows (A4). The upsert key is (stationName, date), so there is no corruption. The aggregate uses only the latest urban time.
- **Disposition:** No change needed.

## Other challenged areas that held

- `https.get(url, options, cb)` is available on Node ≥10.9. The product code is ES5, so it is compatible with the Node 10.15.3 host observation (2026-09-20) and the Node 16.20.2 CI. Actual Node 10 execution of the new modules was **not** exercised: not locally, and the new CI job uses 16.20.2.
- Legacy forecast/metadata paths still use the old URL builders, which is out of scope per spec. The shared `_jsonRequest` URL debug logging and the `setServiceKeys` key logging were removed. `routeGather` logs only `PARTIAL_COLLECTION` codes and province names.
- `getSidoArpltn` has one caller (nationAir); the added third argument is backward compatible.
- The aggregate row keeps `cityName: ""` and `date` equal to the KST instant as UTC. The DB version is unchanged.

## Limitations

- No live AirKorea or global provider calls were made. Key renewal, entitlement, scheduled production collection, production Mongo readback (mongoose 5.1.2 wire), the 17-label live response and physical iOS/Android checks all remain unverified. These are separately authorized per the intent.
- The smoke test used isolated mongoose 5.13.23 and MongoDB 7.0.14, not the production driver.
- The full offline runner could not complete in this snapshot because the `tw.ios/` and `ta.ios/` trees are absent. The affected suites are unrelated to the diff, and their other cases passed.
- PR #2643, commit `650f3fb`, and its CI results were not checked (no network or git). My identity check covers the frozen snapshot hash only.
- Base `39a3336` could not be diffed independently; I relied on the provided `source.diff`, and the hashes of the changed files match.
- Architecture docs and Archify diagrams were not re-validated (not in `candidate.json` file scope).
