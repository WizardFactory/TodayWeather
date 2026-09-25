# Plan — issue-2576

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2576 / plan / main (Claude Opus 5.5) |
| Date / revision | 2026-09-25 r1 |
| Consumed inputs | intent/issue-2576.md, specs/issue-2576.md, triage/investigation reports; design excluded (see artifacts.json) |
| Status / decision | complete / PROCEED |

## File operations
| File | Change | Req |
|---|---|---|
| server/controllers/controller.weather.desc.js | Add `normalizeKmaWeatherStr`; switch on the normalized string; add `구름적음`; remove the first revision's enumerated cases; guard `getWeatherStr` | R1, R2 |
| server/controllers/controllerKmaStnWeather.js | Treat `weatherType < 0` as unknown in `updateWeather` | R3 |
| server/controllers/controllerTown.js | Add `_hasWeatherText`; use it in `makeSummary` | R4 |
| server/controllers/controllerTown24h.js | Use `_hasWeatherText` in `makeSummaryWeather`; drop the warn log | R4 |
| server/test/offline/weather-desc.test.js (renamed from test.weather.desc.js), run.js | Unit/controller regression; register in `test:offline` | R5 |
| server/test/offline/rss-response-smoke.js | Optional `fixture.stnWeather`, applied like `getStnHourlyAndMinRns` l.1210 (`makeWeatherType` on `weather`) | R5 |
| server/test/offline/weather-desc-response-smoke.js (new) | v000903 route smoke for the weather text and summaries | R5 |
| .github/workflows/rss-offline.yml | Run the new smoke with the existing isolated dependencies | R5 |
| docs/architecture/mobile-api.md, docs/operations/weather-summary-undefined-fix-2026-09-25.md | Contract and deployment-state documentation | R6 |

Boundaries kept: middleware order, units, DB formats, native widgets, collectors.

## Order
1. Source changes (already in 3f35bd35).
2. Regression test (already in 3f35bd35). Red against the base source in a detached worktree.
3. Smoke hook, new smoke, CI step.
4. Green, post-refactor (`test:offline`), smoke, existing RSS/daily smokes with `TZ=UTC`.
5. Pre-commit validation → commit → push → CI → independent verification → readiness.

## Rollback and blast radius
Revert the PR commits. There is no data migration. Blast radius: every KMA current response (weather text/summary) and world `desc`. The host hot patch has its own backup (see the operations note).

## Risk analysis
- What could break: a string that used to map could change type. Mitigation: the normalization only rewrites anchored Korean forms that previously returned `-1`, except bare `이슬비`, `진눈깨비` and `소나기`. Legacy forms still map to their original types (the test covers them).
- Riskiest part: the pty ≥ 1 branch now maps `-1` to `0` and then to pty text (rain/sleet/snow). This is intended per the spec, and previously the text was lost.
- Rejected alternative: collector-side normalization (see spec).
- Proof: Red → Green on the regression, the route smoke over both DB formats, and CI.
