# Spec: Air summary without a current AirKorea observation — issue 2578

Revision 1, 2026-09-25. Consumes [intent](../intent/issue-2578.md) revision 1 and `reports/sdlc/issue-2578/investigation.md`. No source changes at this stage.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | `ControllerTown24h.makeSummaryAir(current, units, res)` reads grades only from `current.arpltn`. If `current.arpltn` is falsy it returns `""` and logs a warning. Existing behavior for a present `arpltn` is unchanged: `Grade24` keys skipped; max grade ≤0 → `""`; 1 → `LOC_AIR_QUALITY_IS_GOOD`; 2 → `LOC_AIR_QUALITY_IS_MODERATE`; ≥3 → highest-index pollutant text. | AC1, AC2 |
| R2 | `ControllerTown.makeSummary` uses `current.arpltn \|\| {}` for its PM2.5/PM10/AQI item, so no air field is read from or written to `current`. | AC3 |
| R3 | `kecoController._checkDateTime(arpltn, dateTime)` computes `dateTime − 8 h` on a copy and never mutates the argument. Each station in `_mergeArpltnList` uses the same threshold. | AC4 |
| R4 | The v000903 coordinate response keeps its shape: `current.summaryAir` is a string (possibly empty), `current.arpltn` is unchanged by the summary. | AC5 |

## Interfaces and data

No route, middleware order, query, storage, `DB_DATA_VERSION` or client contract changes. `summaryAir` semantics narrow: empty string means "no current air observation or no grades". Clients already hide an empty value (`ng-if`, web `airSummary` optional).

## Normal and failure behavior

- `arpltn` present with grades → unchanged strings.
- `arpltn` `undefined`/`null` → `""`; `{}` or grades ≤0 → `""` (existing path).
- All stations older than 8 h (host-parsed `dataTime`) → `getKeco` leaves `arpltn` undefined → `""`.
- Fresh station after stale ones → merged from the fresh station.

## Security, UX, observability

No data or auth change. UX: the air line disappears instead of claiming good air. Observability: `log.warn("airInfo is empty!")` when `arpltn` is missing (service log only).

## Compatibility and migration

World weather: `_makeArpltn` always sets `arpltn`, so behavior is unchanged. Native widgets read `summaryAir` from shared storage; an empty string already occurs for world weather. Rollback: revert the commit; no data migration.

## Verification strategy

- Unit (isolated VM, production modules, stubbed collaborators): R1–R3, including the live grade set, request-time immutability and a fresh-after-stale merge. Run under TZ UTC, Asia/Seoul, America/Los_Angeles and Node 16.20.2/22.22.2.
- Integration smoke: full v000903 coordinate middleware via `rss-response-smoke.js` harness, DB 1.0/2.0, with missing, empty and fresh air (R4, AC5); run on base to show the defect.
- Regression: `test:offline`, RSS wind/response, daily response, history/runtime suites; CI RSS/Gather offline workflows.

## Alternatives

- Whitelist pollutant grade keys while keeping the `current` fallback: rejected; the fallback itself is the defect and no caller passes an air object as `current`.
- Show "대기정보 없음" instead of hiding: rejected; needs locale keys and client/widget changes, and the app already hides empty values.
- Fix `dataTime` timezone now: deferred; changes air values on every screen and depends on host timezone (AK decision).

## Risks

Air line hidden more often when collection is stale (intended). Overlapping files with PR #2577 in different hunks.

## Amendment 1 — 2026-09-25

R4 (revised): `getSummaryAfterUnitConverter` (KMA) and `ControllerWWUnits.makeSummary` (world) delete `current.summaryAir` when the built summary is empty. A non-empty value is unchanged. Consumers checked: the app views and push test truthiness; the app share text (`controller.tabctrl.js`, also `ta.ios/www`) tests property presence and now gets no blank line; the TodayAir widget renders nil and `""` the same way; web `weather-core` ignores a missing value. `makeSummaryAir` logs a missing `arpltn` at debug level.
