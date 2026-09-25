# Intent: Air summary without a current AirKorea observation — issue 2578

Revision 1, 2026-09-25. Owner: main agent for AK. Source: AK bug report (Seoul app screenshot, 22:13 KST) and issue [#2578](https://github.com/WizardFactory/TodayWeather/issues/2578).

## Problem

The app's second summary line says `대기상태가 좋아요` ("air quality is good") when no current AirKorea observation exists. The live Seoul v000903 coordinate response returned `current.arpltn: null` and `summaryAir: "Air quality is good"`. `makeSummaryAir` falls back to `current` and reads weather/life-index grades (`wsdGrade`, `decpsnGrade`) as air grades. The AirKorea eight-hour freshness check also widens by eight hours for each additional station. Affected: every KMA-route client that shows `summaryAir` or `summary` (app, web PWA, widgets reading the same response).

## Desired outcome and acceptance criteria

- AC1: With `current.arpltn` `undefined`, `null` or `{}` and `wsdGrade: 1`, `decpsnGrade: 1` on `current`, `makeSummaryAir` returns `""`.
- AC2: With `current.arpltn = {pm10Grade: 1, pm25Grade: 1}` and `wsdGrade: 4`, it returns `LOC_AIR_QUALITY_IS_GOOD`; with `pm25Grade: 3`, it returns the PM2.5 text.
- AC3: `makeSummary` without `arpltn` leaves `current.aqiGrade` undefined.
- AC4: `_mergeArpltnList` with stations 10 h, 12 h and 20 h old returns `undefined`, and the request-time `Date` it receives is unchanged.
- AC5: The full v000903 coordinate route smoke returns `summaryAir === ""` for missing and empty air data, and `LOC_AIR_QUALITY_IS_GOOD` for fresh good air, on DB 1.0 and 2.0.
- AC6: `npm --prefix server run test:offline` and the RSS/daily response smokes pass on Node 16.20.2 and 22.22.2 (local and CI).
- AC7: After deployment, the Seoul coordinate response has `summaryAir === ""` whenever `current.arpltn` is absent. This workflow does not deploy; AC7 is a human-owned post-deployment check recorded in the handoff.

## Scope

In scope: `makeSummaryAir` and `makeSummary` air handling, `_checkDateTime` window, offline regression test and route smoke, RSS offline workflow registration, `mobile-api.md` and offline README.

Out of scope: the weather `undefined` text (#2576 / PR #2577); AirKorea `dataTime` timezone parsing (effective ~17 h window on a UTC host); the cause of missing Seoul AirKorea data; `getKeco` error-path dereference; client, widget and web changes; DB migration; production deploy.

## Constraints

Node 16.20.2 service runtime; `DB_DATA_VERSION` 1.0 and 2.0 compatibility; no provider/DB access in tests; follow AGENTS.md verification and documentation rules.

## Authority and endpoint

Endpoint pre-merge (AK, 2026-09-25). Covered: implementation, tests, smoke, commits, branch push to `ak-ongyeol/TodayWeather` (remote `ak-fork`), PR creation/updates against `WizardFactory/TodayWeather` `master`, CI reading, corrections, independent verification by a fresh subagent context. Excluded: merge, auto-merge, merge queue, production deploy, permission changes, credential transfer, new accounts. AK decision: skip the other-provider PR reviewer because none is available; the review gate stays incomplete and is reported, not claimed.

## Risks and open questions

- Hiding the air line more often: with the window fixed, stale collection leads to an empty `summaryAir` instead of old values. This is the intended behavior.
- Merge-order overlap with PR #2577 in `run.js`, `mobile-api.md`, `controllerTown.js` (different hunks).
- Open: whether to fix the `dataTime` timezone window (AK decision, separate issue).

## Consumers

Spec, plan, builder, independent verifier, PR description, completion.
