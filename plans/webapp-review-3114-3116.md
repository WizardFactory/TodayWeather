# Implementation Plan: Webapp Review Fixes (#3114, #3115, #3116)

- **Intent**: [intent/webapp-review-3114-3116.md](../intent/webapp-review-3114-3116.md)
- **Spec**: [specs/webapp-review-3114-3116.md](../specs/webapp-review-3114-3116.md)
- **Plan Review**: `reports/sdlc/webapp-review-3114-3116/plan-review-opus55.md` + `plan-review-disposition.md` (Claude Opus 5.5, all 19 findings reconciled)
- **User Scenarios**: `reports/sdlc/webapp-review-3114-3116/user-scenarios.json`
- **Execution Notebook**: `.planning/2026-11-22-webapp-fixes-3114-3116/`
- **Archify Decision**: Excluded — frontend chart geometry, CSS scoping, scroll/focus behavior, and value formatting; no service architecture, API route, collector, or storage contract changes.

## Breakdown Assessment (Sub-issue Decision)

| Issue | Sub-issues Needed? | PR Boundary & Base | Owned Write Scope |
| --- | --- | --- | --- |
| **#3114** (Charts) | **No** — shared `.chart-scroll` CSS & `useMetrics` tie hourly and daily together; single atomic PR. | **PR 1**: `fix/3114-web-charts` (base: `master`) | `packages/weather-core/src/charts.ts`, `packages/weather-core/test/charts.test.ts`, `web/src/Charts.tsx`, `web/src/style.css` (chart rules only), `web/e2e/pwa-design.spec.ts` (chart tests), `intent/specs/plans/webapp-review-3114-3116.md`, `specs/design-system.md` (§5.1 delta), `docs/architecture/web-client.md` (line 77 delta) |
| **#3115** (Weather nav/precip) | **No** — coherent route/focus & precipitation filter change in `Weather.tsx`/`App.tsx`/`format.ts`. | **PR 2**: `fix/3115-web-weather-nav` (base: **`master`** — independent of PR 1!) | `web/src/format.ts`, `web/src/Weather.tsx`, `web/src/App.tsx` (line 262 regex), `web/test/display.test.ts`, `web/e2e/pwa-design.spec.ts` (lines 150-168 + new tests), `docs/architecture/web-client.md` (line 89), `specs/design-system.md` (line 384), `docs/webapp/user-manual.json` (line 29) |
| **#3116** (UI/CSS cleanup & minor fixes) | **No** — bounded secondary UI/formatting polish pass. | **PR 3**: `fix/3116-web-ui-cleanup` (base: `fix/3115-web-weather-nav`) | `packages/weather-core/src/index.ts`, `packages/weather-core/test/weather.test.ts`, `web/src/App.tsx` (sidebar links), `web/src/Weather.tsx` (`.live-dot`, `.precip-grid`, `.bar-chart` scroll), `web/src/style.css` (AC-6 selectors only), `web/e2e/` (new assertions) |

**Branching Strategy (revised per PLAN-14)**:
- PR 1 (#3114) and PR 2 (#3115) branch **independently from `master`** so fixes to PR 1 during review never force rebasing PR 2.
- PR 3 (#3116) branches from PR 2 (`fix/3115-web-weather-nav`) because it styles the precipitation JSX block updated in PR 2, while avoiding all chart selectors owned by PR 1.

## Ordered Task Graph

### PR 1 — Issue #3114 (`fix/3114-web-charts`, base: `master`)
- **T1.1 (TDD — core `charts.ts`)**:
  - Add failing unit tests in `packages/weather-core/test/charts.test.ts` for:
    - `hourlyChart` on-hour merge preserving `rainProbability` (and precip/snow atomic groups) when `current` has `null`.
    - `hourlyChart` off-hour inserted `current` borrowing `rainProbability` from enclosing slot within 3h.
    - `hourlyXPositions` for 15m off-hour row, 1h/3h mixed rows, 12h gap, and 45-row total width upper bound.
    - `linePath` optional `breakBefore` breaking paths across `> 3h` gaps.
  - Implement in `packages/weather-core/src/charts.ts` and export `hourlyXPositions` from `packages/weather-core/src/index.ts`.
- **T1.2 (Chart CSS in `web/src/style.css`)**:
  - Remove legacy `.chart-scroll svg { width: 100%; max-height: 245px; }` and `.chart-scroll { margin: 0 -6px; }`.
  - Add `.chart-plot-wrap`, `.chart-y-axis`, `.chart-hit`, `.chart-day-primary`/`.chart-day-date`, and `.hourly-chart .now` (`fill: none`, including `@media (forced-colors: active)`).
- **T1.3 (HourlyChart in `web/src/Charts.tsx`)**:
  - Update `useMetrics(ref, active)` with `measured` flag and `active` dep.
  - Use `hourlyXPositions` and `linePath(..., breakBefore)` for `> 3h` gaps.
  - Measure wind direction + arrow (`rem * 1.5`) when expanded.
  - Move Y-axis ticks to external `.chart-y-axis` overlay with clearance in `pad`/scroll/`useCursor`.
  - Render current temp inside blue dot + `.now` outer ring; improve yesterday clearance without collisions.
  - Add midpoint-to-midpoint `.chart-hit` rects (`onClick` + `pointerType === "mouse"` `onPointerEnter`).
  - Preserve `anchorTimeRef` across expand/resize/refetch; reset only on `(location.id, unitKey, lang)`.
  - Preserve Cordova `i > 0` column 0 rule.
- **T1.4 (DailyChart in `web/src/Charts.tsx`)**:
  - Switch header to compact 2-line layout (keeping AM/PM pair width in `column` measurement).
  - Clamp initial `scrollLeft` so Today is always fully inside viewport (`Math.min(todayIndex * cell, Math.max(startIndex * cell, (todayIndex + 1) * cell - viewport))`) and preserve anchor across resize.
  - Add full-column `.chart-hit` rects with `onClick` + `pointerType === "mouse"` `onPointerEnter`.
  - Render `.chart-period` row only when any day has split AM/PM icons.
  - Preserve Cordova truthy rainProbability rule.
- **T1.5 (Docs, E2E & Pre-merge)**:
  - Update `specs/design-system.md` §5.1 and `docs/architecture/web-client.md` line 77 for bounded hourly spacing; commit canonical `intent/specs/plans/webapp-review-3114-3116.md`.
  - Add E2E tests in `web/e2e/pwa-design.spec.ts`: bounded width on mixed 1h/3h & off-hour `current.at`, sticky Y-axis visible when scrolled, visible row preserved after expand, `ko` & `fr` 390px (100% & 130%) Today unclipped, daily SVG bar click updates cursor.
  - Run full verification (`typecheck`, `test`, `test:design`, `build`, `test:e2e`), Ego Lite visual smoke on local static preview, artifact-policy check, push, PR, CI, Claude Opus 5.5 PR review (+ optional Grok), resolve to PASS.

### PR 2 — Issue #3115 (`fix/3115-web-weather-nav`, base: `master`)
- **T2.1 (TDD — `upcomingPrecipitation`)**:
  - Add unit tests in `web/test/display.test.ts` for `upcomingPrecipitation` (hourly `>= current.at` using `wallTime()`, partial accumulating slot retained, daily `>= today`, all-past fallback to last 8).
  - Implement `upcomingPrecipitation` in `web/src/format.ts` and wire in `web/src/Weather.tsx`.
- **T2.2 (Scroll/Focus & `/loc` Preview)**:
  - Narrow `App.tsx:262` regex to `/^\/weather\/[^/]+\/daily$/`.
  - Update `Weather.tsx` so `pendingContentFocus` owns `daily`, hourly Retry success restores focus to `#main-content` with `preventScroll: true` (keeping Hero visible), and `/loc` preview switching from `daily` → `hourly` scrolls to top.
- **T2.3 (Exact Test & Doc Updates + Pre-merge)**:
  - **Modified tests**: `web/e2e/pwa-design.spec.ts:150-168` (hourly direct load & goBack keep Hero visible and focus `#main-content` on Back rather than scrolling Hero off-screen); add new E2E tests for Hero in viewport on `/weather/seoul/hourly`, hourly Retry focus recovery, `/loc` preview `daily → hourly` top scroll, and "강수·눈 예보" excluding past `그제` rows when future rows exist.
  - **Unchanged tests (verified passing as-is)**: `web/e2e/audit-fixes-2.spec.ts:71,81`, `web/e2e/precipitation-metadata.spec.ts`, `web/e2e/precipitation-time-errors.spec.ts`, `web/e2e/forecast-air.spec.ts`, `web/e2e/solar-terms.spec.ts`, `web/e2e/deeplink.spec.ts`.
  - **Updated docs**: `docs/architecture/web-client.md` (line 89), `specs/design-system.md` (line 384), `docs/webapp/user-manual.json` (line 29).
  - Run full verification + Ego Lite smoke + artifact check + PR + CI + independent PR review to PASS.

### PR 3 — Issue #3116 (`fix/3116-web-ui-cleanup`, base: `fix/3115-web-weather-nav`)
- **T3.1 (TDD — `-0` normalization)**:
  - Add unit tests in `packages/weather-core/test/weather.test.ts`: `formatValue(-0, 0) === "0"`, `formatValue(-0.04, 0) === "0"`, `formatValue(-0.5, 0) === "-1"`, and German locale `formatValue(-0.04, 0) === "0"`.
  - Implement in `packages/weather-core/src/index.ts`.
- **T3.2 (Sidebar active state & `.live-dot`)**:
  - Update `web/src/App.tsx`: plain `<Link>` for `미세먼지` when `!selected`; active `날씨` for `/weather/:id/*` and (`!selected` on `/` or `/start`).
  - Remove `<span className="live-dot" />` from `web/src/Weather.tsx` and `.live-dot` from `web/src/style.css`.
- **T3.3 (Cards & Air bar labels — AC-6 selectors only)**:
  - Style `.detail-grid` (keeping class on `.details-panel` for `review.spec.ts:73`), `.precip-grid`, desktop `.air-summary`, and `.bar-chart` single-line labels (`white-space: nowrap`, `min-width`) + initial `scrollLeft` to observed bar (index 12) while keeping all 24 slots and `title`s intact (`docs-gap.spec.ts:98-102`).
- **T3.4 (Verification & Pre-merge)**:
  - Add E2E assertions for single `[aria-current="page"]` across `/start`, `/weather/seoul/hourly`, `/weather/seoul/daily`, `/air/seoul`; no `.live-dot`; single-line `.bar-chart` labels; observed bar visible on mobile.
  - Run full verification + Ego Lite visual smoke (desktop/mobile, light/dark) + artifact check + PR + CI + independent PR review to PASS.

## Verification Commands
```sh
npm run typecheck && npm test && npm run test:design && npm run build && npm run test:e2e
python3 scripts/check-artifact-policy.py --staged
```
Plus local static preview (`npm run preview:static`) browser/visual checks in Ego Lite (`ego-browser`). Manual PDF screenshots (`docs/webapp/`) are flagged in the final handoff for optional visual refresh after all 3 PRs merge.
