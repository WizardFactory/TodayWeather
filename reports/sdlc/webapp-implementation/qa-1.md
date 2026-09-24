# QA-1 independent verification

Verdict: **CHANGES_REQUIRED**. Proposed HOTL decision: **BLOCKED** for acceptance of this candidate; main may correct under existing authority and request the next bounded iteration. Full mobile parity is not complete.

Candidate: `sha256:48ebadaa40e872234a599e41d2ec3c749374eae72a0a1e8ca81a2bd654c872a0`; base `87b8855f308611a07897cd3a39c45fefb3088d77`. All 60 candidate file hashes match. The changed non-report file set agrees with the manifest: True. Source files were read-only throughout this assignment.

Context: `/root/webapp_qa`, a fresh non-builder OpenAI context under `collaboration.spawn_agent`; builder `/root`. Exact inherited model ID and reasoning effort were not exposed. This is independent local verification, not an alternate-provider PR review. Inputs were acknowledged to main; exact consumed-input digests are in `qa-1.json`.

## Mandatory findings

### QA1-F1 — MEDIUM — Search correctness

- Location: `web/src/App.tsx:580`
- Finding: Submitting edited search before the 300 ms debounce selects the previous query result.
- Impact: Entering Busan and pressing Enter immediately selects Seoul and persists the wrong favorite.
- Reproduction: Fresh browser at /; wait for initial catalog, fill 지역 검색 with 부산, press Enter immediately. Observed /weather/seoul/hourly and heading 서울.
- Evidence: `reports/sdlc/webapp-implementation/qa-1-browser.log`
- Requirement: AC2; specification primary search journey and stable selection
- Confidence: high; actual Chromium with actual demo BFF
- Disposition: Must Fix: bind submission to the submitted search value, or defer until matching query results exist.

### QA1-F2 — HIGH — Persistence and async state race

- Location: `web/src/App.tsx:161`
- Finding: A delayed geolocation callback invokes select with stale captured state and overwrites subsequently added favorites.
- Impact: User favorites are silently lost; the stale whole-state replacement can also restore older preferences.
- Reproduction: Fresh browser; hold getCurrentPosition callback; click 현재 위치; select 부산; then return Seoul coordinates. After the React persistence effect, places changes from [busan] to [seoul]. Locations page contains only Seoul.
- Evidence: `reports/sdlc/webapp-implementation/qa-1-location-race-confirm.log`
- Requirement: AC2/AC3; async ownership and stable favorites in product specification and technical design
- Confidence: high; actual Chromium, controlled geolocation callback, real reverse lookup to local demo BFF
- Disposition: Must Fix: update against current state and reject/cancel obsolete location/search completions as appropriate.

### QA1-F3 — MEDIUM — Offline persistence validation

- Location: `web/src/state.ts:215`
- Finding: Snapshot validation accepts absent/non-finite save timestamps and structurally malformed Weather objects.
- Impact: The documented 24-hour bound is bypassed and corrupted local cache can replace the entire application with the React Router error page.
- Reproduction: Populate Seoul snapshot; in isolated browser IndexedDB delete savedAt and set fetchedAt to 2020, then go offline and reload: weather still displays. Change weather.hourly to null and reload offline: Unexpected Application Error / Cannot read properties of null (reading filter).
- Evidence: `reports/sdlc/webapp-implementation/qa-1-snapshot-confirm.log`
- Requirement: AC5; specification storage-corruption recovery and technical design 24-hour offline expiry
- Confidence: high; actual Chromium IndexedDB, actual offline service-worker shell and demo BFF snapshot
- Disposition: Must Fix: validate finite bounded savedAt plus required nested weather shape; safely discard invalid records and keep the app usable.

## Actual checks and evidence

- `npm run typecheck`: exit 0.
- `npm test`: 25/25 passed after existing managed permission allowed isolated loopback listeners. The initial sandbox run had eight EPERM listener failures and 17 passing tests; it is retained as environment-blocked evidence, not an application regression.
- Independent Chromium (installed executable, Playwright 1.63, Node 22.22.2) against an isolated demo BFF on port 4187: explicit city choice, no 390px page overflow, Fahrenheit persistence, and offline snapshot notice passed with no pageerror events. Immediate search submission failed semantically despite script exit 0.
- Controlled delayed geolocation and isolated IndexedDB corruption probes reproduced findings F2/F3. They do not use real geolocation or remote providers. Initial inconclusive/setup attempts are retained separately from confirming logs.
- Source review covered the typed adapters, weather presentation, favorites, service worker, API allowlist/error behavior, notification ownership/CSRF/revisions/scheduler, and deployment recipe. Existing unit tests exercise controlled HTTP responses and injected push delivery.
- Existing main production bundle was reused; no independent rebuild or overwrite of main screenshots/reports occurred. Candidate file hashes were checked again when writing this report.

## Remaining boundaries

Main separately reported nationwide city-name collapse (`regionName || cityName`); source priority is visible, but QA-1 did not independently replay its live fixture. Include city identity in follow-up verification after correction. Snapshot pruning spans separate transactions; its concurrent boundary was inspected but no deterministic failure was reproduced, so this report makes no additional mandatory claim.

Declared release gates are distinct from the three local defects: conditional weather alerts; actual iOS/Android browser push receipt; international/provider/air freshness; commercial/native-widget decisions; supported-browser/device tests; hosting and operational approval. The current single-process optional reminder service is not forecast-condition alerts or proven device delivery. No remote network, legacy collector/server startup, real push, deployment, Docker/Compose, remote CI or alternate-provider PR review ran. Previous-worker upgrade/rollback was not dynamically verified here.

Fix the three mandatory findings, renew regression and integrated smoke evidence, freeze a new candidate and request QA follow-up. Keep the full parity issue open.
