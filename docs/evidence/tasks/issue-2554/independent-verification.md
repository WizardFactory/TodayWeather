# Independent verification: issue #2554

Verdict: PASS for the scoped local wind repair. No unresolved mandatory findings in the changed production logic. This is independent agent verification, not cross-provider PR review, live HTTP testing, or production validation.

Builder context: `/root`. Verifier context: `/root/response_smoke`. Candidate: `sha256:41685a6ea7dc84e3b5ba82802e131dba864d97097fa6c209e278622703d8ffca`; base `ff7acf3996ccb66c912d2ed4710cf300197d6966`. Exact consumed source, test, specification and documentation SHA-256 values are in `final-output/evidence.json`.

## Scope and independent assessment

Read canonical intent/spec/plan, both changed controllers, actual v000903 KMA router and ControllerTown24h response pipeline, offline regression suite, and changed architecture paragraphs. Independently checked KMA's primary RSS format document, pp. 1–2 (https://www.kma.go.kr/w/resources/pdf/dongnaeforecast_rss.pdf). Numeric `wd` is 0..7 clockwise from north, independently of label codes 1..8. The candidate correctly maps numeric sectors to degrees; north zero is retained and invalid sector 8 is rejected. `wdEn` now consumes its actual upstream label while weather `wfEn` remains unchanged.

The generic merge helper validates the source before touching the target, with appropriate separate temperature/nonnegative/vector-component sentinels. The newer/equal/older policy remains intact. Optional fields absent from RSS projection preserve their base values. The first-future-slot loop correction and tmx self-validation are justified fixes in the same merge block, with regression coverage. No component derivation, schema migration, new startup side effect or live provider call was introduced.

## Executed checks

1. `TZ=UTC node server/test/offline/rss-wind.test.js`: 43/43 passed, exit 0. Evidence: `unit-result.tap`. This independently reran the builder's regression suite covering all direction sectors, label codes, invalid/missing values, publication policy and first/midnight boundaries.
2. `TZ=UTC TW_SMOKE_CONTEXT=/root/response_smoke TW_SMOKE_OUTPUT_DIR=/tmp/issue-2554-response-smoke/final-output node /tmp/issue-2554-response-smoke/smoke.js`: 36/36 scenarios passed, exit 0. Evidence: `smoke-result.json`, `final-output/evidence.json`, and one final serialized response in `final-output/latest-response.json`.
3. `node /tmp/issue-2554-response-smoke/timezone-probe.js`: existing calculateTime behavior reproduced identically in baseline and candidate for UTC/Berlin/Los Angeles; details below. Evidence: `timezone-evidence.json`.

The independent smoke crosses synthetic upstream XML -> real xml2js -> real `parseShortRss` -> synthetic Mongo documents -> real DB 1.0/2.0 projection/read -> actual Express 4.13 v000903 coordinate router -> all 38 configured middleware functions -> real result builder/sendResult -> captured res.json JSON serialization. No middleware is replaced. Each case parses seven RSS rows including next-day midnight. Matrix: Seoul (60,127), Busan (98,76), Jeju (53,38); both DB formats; newer/equal/older publication; Celsius/m/s and Fahrenheit/km/h. Each response contains 41 short slots and 18 daily slots.

Assertions verify the actual RSS database query matches each intended grid, wind mapping and speed conversion (1.3 m/s -> 4.7 km/h), zero-degree north and 225/315-degree sectors, preserved absent wave/components, publication policy, midnight's 00:00 -> previous-day 24:00 presentation, location rounding, yesterday, sky icon/wind descriptions, and separate RSS/current/shortest publication timestamps. Actual downstream shortest merge overrides 12:00 temperature; 15:00 RSS wind survives the rest of the response path. Current observations retain their own wind. Missing/sentinel wind coverage is in the 43 regression suite, not a separate full-response scenario.

## Mock and runtime boundaries

Real: collector parser; DB projection/read functions for all primary town/medium products; actual controller constructors and merge/composition helpers; kmaTimeLib; unitConverter; life-index calculations; weather descriptions; pure station weather update and air conversion code; Express route matching/order; response building. Manager time/leading-zero helpers execute their real source with a fixed clock (2026-09-24 09:10 KST).

Synthetic or stubbed: Mongo find/query results (no database); geocoding request response and KR area predicate; region/zone lookup; station hourly/minute retrieval; air retrieval; medium RSS, sunrise/sunset and warning retrieval. Optional area/health/air fixtures are empty, yielding expected missing-auxiliary warnings. Translation returns localization keys, so translation wording is not verified. Clock/config/log sinks are isolated. dnscache is disabled. Mongo writes/persistence are not executed: the parsed RSS rows are wrapped in each documented storage format at the mocked boundary.

Runtime: Node 22.22.2; temporary async 2.5.0, Express 4.13.4, sprintf 0.1.5, xml2js 0.4.23 installed outside the repository. No app.js startup, middleware outside the KMA router, listening socket, HTTP transport, provider request, actual Mongo, mobile client, origin/CDN, deployment/restart or cross-provider execution was performed. The temporary harness supports TW_REPO, NODE_PATH, and TW_SMOKE_OUTPUT_DIR for retention elsewhere.

## Finding outside the scoped repair

MEDIUM | Existing timezone defect | `server/controllers/kma/kma.town.short.rss.controller.js:162` | `calculateTime` parses a timezone-less timestamp as local time and then applies the host timezone offset again | Input `202609240000`, hour offset 15 returns `202609241500` with TZ=UTC, `202609241300` in Europe/Berlin and `202609242200` in America/Los_Angeles | Non-UTC collector processes may store shifted forecast slots and prevent matching | `timezone-probe.js` compares baseline HEAD with candidate; helper SHA-256 is identical (`a32bafb69730a1cc13c20998838d8726c05a87e3f8c88e2db63c4365b1771387`) | AC4/AC5 scope limitation | High confidence | Deferred as an unchanged defect outside the two-field repair; builder agrees and added architecture documentation. Verify UTC process timezone before any separately approved deployment or fix this as a separate task.

An initial XML-connected smoke on the host's Berlin timezone exposed this limitation. Final full XML-to-response validation intentionally requires UTC and fails early on non-UTC hosts. The separate regression suite's timezone runs do not establish collector forecast-date invariance. This does not establish nationwide/live data correctness or diagnose Jeju's unrelated HTTP 500.
