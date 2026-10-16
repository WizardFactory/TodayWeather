# Plan: stored forecast fallback

Owner: Codex /root. Inputs: [intent](../intent/issue-2770.md), [spec](../specs/issue-2770.md). Base: c48b29aa. One branch/worktree/PR, endpoint pre-merge.

## Paths and order
1. Add controller regression `server/test/offline/air-forecast-fallback.test.js` and its isolated harness. Record intended failure before production edit.
2. Modify `server/controllers/controllerTown24h.js`: select KAQ/AirKorea before insertion; reuse strict KST parser and finite nonnegative numeric pollutant values; keep explicit AirKorea path unchanged, observations intact and no combined source timelines. Normalize insertion window and retain the first forecast without pollutant observations.
3. Extend existing `server/test/offline/rss-response-smoke.js` only for selectable stored forecast fixtures; add `server/test/offline/air-forecast-fallback-smoke.js` driving real router and actual shared app chart code. Register regression in `server/test/offline/run.js`, document commands in its README.
4. Update `docs/architecture/mobile-api.md`, diagram JSON/HTML `docs/architecture/diagrams/air-forecast-selection.*`, architecture index, and selected verification evidence under `docs/evidence/tasks/issue-2770/`. Maintain intent/spec/plan in their existing directories. Generated state/logs stay ignored under reports and .planning. No other implementation paths, no server2 files.
5. Run focused red/green/post-refactor and separate functional smoke, relevant regressions and artifact checks. Commit/push, create PR, observe CI and separate required reviewer; attempt optional Grok/Gemini reviews. Resolve findings and recheck current head/base before merge-ready receipt. Merge/deployment excluded.

## User scenarios and proof
- S1 / AC1: installed app user opens air detail with valid future KAQ. Stored station observation and KAQ available. Request kaq → select KAQ → chart preserves source and values, no AirKorea read. Invalid/expired/current-only rows must not establish availability.
- S2 / AC1, AC2: installed app requests kaq with unavailable KAQ and valid stored AirKorea. Query same station → select AirKorea → return actual source/pubDate → shared app chart has future PM/AQI slots. Observations remain identical; explicit AirKorea gives the same forecast fields.
- S3 / AC3: neither source has usable forecasts or KAQ query errors. Request → try allowed stored fallback → preserve observations, omit unavailable forecasts safely; store errors log and middleware completes.

Controller tests cover current/last/+24h boundaries, 24:00, host timezone, zero and invalid values/codes, partial pollutants, missing observation series, query errors, no data and source identity. Full v000903 route smoke covers both DB formats and actual client chart-data slicing. No external providers/startup.

Riskiest part: a source can have rows but none visible in the existing display window. Share availability with timestamp rules, test upper bound and observations explicitly. Reject client default change (installed apps still send kaq) and partial-source mixing (ambiguous publication/source). No schema/config migration. Rollback: revert this scoped change, restoring prior selection without touching stored forecasts. Docs/manual assessment: compatibility bug fix, no new UI/feature; architecture/API notes and diagram required, PDF manual not applicable.
