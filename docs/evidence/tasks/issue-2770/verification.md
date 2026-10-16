# KAQ stored forecast fallback verification

Date: 2026-10-16 UTC. Source: [#2770](https://github.com/WizardFactory/TodayWeather/issues/2770).
Base: c48b29aa900d35ab50da0ca5ccc5392345817cc5. Candidate sources are the scoped PR diff; final head, CI and independent review are retained in the PR. Intent/spec/plan are maintained separately; raw runs/state stay ignored.

- Red: 27 controller cases, 2 passed / 25 intended behavior failures before production edits. The initial harness missing `manager` was fixed before retaining the intended Red.
- Green and post-refactor: all 27 controller cases passed with Node 22.23.3 in Asia/Seoul, UTC and America/Los_Angeles. Finite zero, old publication with valid future data, invalid timestamp/value/code, now/observation/+24h boundaries, 24:00, partial pollutant availability, missing observation series, both sources unavailable and query errors covered.
- Separate functional smoke: real v000903 route and JSON serialization with isolated stored-data collaborators, followed by the exact app `controller.air.js` chart assembly. Ten scenarios (DB 1.0/2.0 × KAQ retained, fallback, neither, KAQ error, explicit AirKorea) passed. Fallback fills 24 future rows each for PM10/PM2.5/AQI and 11 future slots in the app's 24-slot chart; values/publications and observations verified.
- Relevant air freshness, route and summary regressions passed. No provider/database integration, mobile build or production deployment claimed.
- Archify sequence: validated, delivered, strict artifact/provenance check and actual Chromium browser checks passed. Initial missing-browser discovery resolved using installed Playwright Chromium. Light 1440×900 and dark 2048×1320 captures inspected: labels, arrows and theme contrast readable; no clipping/overlap in the diagram. Working recovery/provenance metadata retained locally under ignored reports.

Reproduce from a clean checkout with Node 22 and isolated dependencies:

```sh
npm install --prefix /tmp/kaq-fallback-deps --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 xml2js@0.4.23 sprintf@0.1.5
NODE_PATH=/tmp/kaq-fallback-deps/node_modules TZ=Asia/Seoul node server/test/offline/air-forecast-fallback.test.js
NODE_PATH=/tmp/kaq-fallback-deps/node_modules TZ=UTC node server/test/offline/air-forecast-fallback-smoke.js
NODE_PATH=/tmp/kaq-fallback-deps/node_modules TZ=UTC node --test server/test/offline/air-freshness.test.js server/test/offline/air-freshness-route.test.js server/test/offline/air-summary.test.js
```

This restores existing client behavior. No new UI/feature/manual PDF, configuration, schema or collection change. Human deployment remains outside scope. Roll back by reverting the scoped commit; stored data is untouched. Actual production availability is unverified by these synthetic runs.
