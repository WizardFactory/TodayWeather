# Intent: Webapp Review Fixes (#3114, #3115, #3116)

- **Date**: 2026-11-22 (Revised after Claude Opus 5.5 plan review)
- **Authority**: User-requested webapp review followed by explicit approval to create issues, assess breakdown/sub-issues, plan, review the plan with Claude Opus 5.5, reconcile review feedback, and implement through `pre-merge` (`merge_authorized: false`).
- **Issues**:
  - [#3114](https://github.com/WizardFactory/TodayWeather/issues/3114): `web: fix hourly and daily chart layout, spacing, interaction, and data bugs` (Order 1 of 3)
  - [#3115](https://github.com/WizardFactory/TodayWeather/issues/3115): `web: fix weather page initial scroll hiding hero, past-only precipitation list, and tab behavior` (Order 2 of 3)
  - [#3116](https://github.com/WizardFactory/TodayWeather/issues/3116): `web: clean up weather detail/air card layouts, sidebar active state, air bar labels, and -0° formatting` (Order 3 of 3)
- **Endpoint**: `pre-merge` for each PR (`merge_authorized: false`). Merge and production deployment remain excluded.

## Scope & Exclusions
- **In scope**: `packages/weather-core/src/{charts.ts,index.ts}`, `web/src/{Charts.tsx,Weather.tsx,App.tsx,format.ts,style.css}`, unit/E2E tests in `packages/weather-core/test/`, `web/test/`, `web/e2e/`, and synchronized contract docs (`specs/design-system.md`, `docs/architecture/web-client.md`, `docs/webapp/user-manual.json`).
- **Preserved Cordova parity rules (out of scope to reverse)**: Hourly column 0 blank icon/precipitation (`specs/design-system.md:294`) and daily truthy rainProbability (`specs/design-system.md:361`) remain unchanged to preserve native/Cordova parity.
- **Out of scope**: Backend API changes (`server/`, `server2/`), native iOS/Android/Cordova changes, production S3/CloudFront deployment, GitHub PR merge.

## Observable Acceptance Criteria
- **AC-1 (#3114 Hourly spacing & wind)**: Hourly chart renders mixed 1h/3h and off-hour `current.at` with bounded chronological spacing (`hourlyXPositions`) and line breaks across >3h missing gaps; zero overlapping hour/value/wind labels at 320/390/1440 px and 130% text scale including expanded wind/humidity; `.chart-scroll` icons/arrows keep natural sizes without vertical clipping.
- **AC-2 (#3114 Hourly data & usability)**: Hourly Y-axis ticks remain visible in an external overlay while scrolled; merging on-hour or off-hour `current` preserves forecast `rainProbability`; current marker uses an outline `.now` ring with legible temperature inside the blue dot (including `forced-colors`); clicking/hovering hourly SVG hit rects updates cursor; toggling wind/humidity or resizing preserves the visible anchor time; `useMetrics` attaches ResizeObserver after empty→populated mount.
- **AC-3 (#3114 Daily chart)**: Daily chart uses compact 2-line date headers while measuring AM/PM pair width, clamps initial scroll so Today is never clipped at 390 px across `ko` and `fr` (100% & 130% scale), and updates cursor/readout on clicking or mouse-hovering SVG column hit rects.
- **AC-4 (#3115 Hero visibility, focus & tabs)**: Direct load or city selection to `/weather/:id/hourly` (and `/overview` and `/loc?view=hourly`) keeps header, tabs, and Hero visible at top; hourly error → Retry recovers focus to `#main-content` with `preventScroll: true`; `/daily` and explicit `일별` selection scroll to and focus `.daily-chart`; contract docs (`web-client.md`, `design-system.md`, `user-manual.json`) are updated in lockstep.
- **AC-5 (#3115 Upcoming precipitation)**: "강수·눈 예보" displays current/upcoming slots via `upcomingPrecipitation()` using `wallTime()` (`>= current.at` for hourly, `>= today` for daily, keeping accumulating `partial` slots, fallback to latest 8 if all past), preserving D45 labels and offline snapshots.
- **AC-6 (#3116 Layout & minor fixes)**: `.detail-grid` / `.precip-grid` ("강수·눈 예보", "날씨 자세히") and desktop `.air-summary` have balanced, clearly separated layouts in light/dark desktop/mobile; `.live-dot` removed; sidebar has exactly one `[aria-current="page"]` on `/start`, `/weather/:id/hourly`, `/weather/:id/daily`, `/air/:id`; `formatValue` normalizes `-0` to `"0"` across locales; air hourly bar chart preserves 24 slots with single-line labels and scrolls initially so the observed bar is visible.
- **AC-7 (Verification & policy)**: `npm run typecheck`, `npm test`, `npm run test:design`, `npm run build`, `npm run test:e2e`, `python3 scripts/check-artifact-policy.py --staged`, CI checks, and independent PR review pass for each PR.
