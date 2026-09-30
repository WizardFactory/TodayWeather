# TodayWeather design system adoption plan
Shared creation: [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651). Production PWA adoption: [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649). Life-index data: [#2650](https://github.com/WizardFactory/TodayWeather/issues/2650).

Inputs:
- [intent](../intent/design-system.md), with the typography-first and core-charts amendments
- [spec](../specs/design-system.md)
- [token pipeline diagram](../docs/design-system/diagrams/token-pipeline.html)
- base 481aa49d

This plan authorizes nothing by itself. Each phase is a separate implementation task, branch and PR, started only on AK's request. AK's priorities set the order: typography (phase 1) and the Cordova hourly/daily charts (phase 2) come before everything else.

## Authorized local steps 1–2 (2026-10-01)

AK requested documentation reconciliation and device-specific typography verification. This is a local reference task preceding the adoption phases below, not permission to execute the whole plan.

1. Preserve existing intent/spec/plan and diagram; reconcile D1–D8, #2651 ownership and TodayAir retirement. Add the documentation/planning deliverables guide and source-of-truth rules.
2. Add a standalone HTML/CSS/JS typography specimen under `docs/design-system/references/`, using a pinned, locally licensed Pretendard font. Fixed ko/de sample data demonstrates all type roles, hourly today/yesterday dots, daily shared-axis bars and enlarged text. It is not a production chart/data adapter.
3. Add a reusable browser verifier under `scripts/verification/`, serving references only on loopback. Assert three tiers and their boundaries, .9/1/1.15/1.3 settings, 200% root text, 320px and desktop half-width reflow, no document overflow, chart-text bounds, and pairwise label collisions. Run Chromium and WebKit, save raw runs under ignored reports, inspect selected screenshots, and retain dated essential evidence.
4. Obtain independent verification and document physical-device D3 as not run. No server/provider calls, product source, token package, native output, deployment or GitHub mutation.

Risk: a reference passing does not prove production app behavior. Distinguish demo geometry, font metrics and browser measurements from native/system scaling. Rollback: remove only task-owned reference files and revert scoped document edits; preserve prior user content. Rejected alternative: implementing production typography before token-package creation and without a measured reference.

Commands and detailed matrix are maintained in the typography guide. Documentation links and fixture values must match the normative spec. Existing token pipeline structure is unchanged; preserve generated Archify HTML and do not patch it manually.

After AK's `git pull origin master` request, current base is `6ec6c68c`. Apply [repository retention](../docs/development/artifact-retention.md), keep location-bound diagram receipts under ignored reports while preserving bytes, stage only maintained sources/selected evidence, and run `python3 scripts/check-artifact-policy.py --staged`. Do not install hooks or infer CI enforcement. Correct Chromium capture-induced touch-media changes before accepting screenshots; freeze only the reference render during capture, restore input emulation, and assert captured role/tier consistency. Historical investigation base remains unchanged.

## Phase 0: token package and generator (foundation)
**Add**
- `packages/design-tokens/` (workspace `@todayweather/design-tokens`):
  - `tokens/primitive.tokens.json`
  - `tokens/color.light.tokens.json`, `tokens/color.dark.tokens.json`
  - `tokens/type.tokens.json` (mobile/tablet/desktop plus modifiers)
  - `tokens/layout.tokens.json`
  - `tokens/weather.tokens.json` (air, precipitation, UV, wind, sky, chart)
  - `src/build.mjs`: a zero-dependency DTCG subset reader that writes `web/src/generated/tokens.css`, `tokens.ts` and `contrast-report.json`
  - `test/tokens.test.ts`

**Change**
- Root `package.json`:
  - Add the workspace.
  - Add `predev`, `pretypecheck`, `pretest` and `prebuild` scripts that run the generator.
- `web/package.json`: add `predev`/`prebuild`.
- `.gitignore`: add `/web/src/generated/`.
- Confirm that `scripts/web-dev.mjs` works on a clean checkout. The root `predev` covers it.

**Tests (Red first)** — they fail until the token files exist:
- contrast for every token × allowed surface in both appearances (spec §4.2, §5.1, §6)
- all three tiers present for every type role
- the 12 px and 13 px floors
- deterministic output

**Proof**
- On a fresh clone: `npm ci && npm run typecheck && npm test && npm run build`.
- Two generator runs produce byte-identical output.

## Phase 1: responsive typography (priority 1)
**Change**
- `web/src/style.css`:
  - Import the generated tokens.
  - Replace all 146 `font-size` declarations (23 distinct values), the ad-hoc line heights and the weights with the role variables and classes, following the spec §4.3 mapping.
  - Replace the 680/900/1190/1600 breakpoints with the width-only layout breakpoints plus the pointer-based type tiers (§3.2).
- `web/src/App.tsx:143,153`: the `matchMedia` mirrors use the tier queries exported from `tokens.ts`.
- Hero: implement the §3.3 hero rules.
- Add the `:lang()` rules.
- D1 (decided): add Pretendard Variable dynamic-subset woff2 files and the OFL license under `web/src/fonts/`, with `@font-face` rules using `unicode-range` and `font-display: swap`.
  - Import them from CSS so Vite emits hashed `assets/`. They then deploy through the existing S3 + CloudFront uploader with immutable caching, under the existing `font-src 'self'` CSP.
  - Precache only the Latin and common-Hangul subsets (`scripts/web-precache.mjs`).
  - Record the size added to the first load.
- D2: add the text-size setting (90/100/115/130%) in `tw.web.v1.display`.
- D3: capture the PWA and Cordova side by side at font scale 1.0 and 1.3 on iOS and Android. Enable Dynamic Type or Android font scale only if the charts show no overlap. Record the result in the PR.

**Extend `scripts/web-layout-check.mjs`**
- `--text-scale 1,1.5,2` and `--appearance`
- Tier assertions:

  | Size | Pointer | Expected `body` |
  | --- | --- | --- |
  | 402×874 | touch | 17 px |
  | 820×1180 | touch | 18 px |
  | 1180×629 | touch | 18 px |
  | 874×402 | touch | 17 px (mobile values) |
  | 1440×900 | fine | 16 px |
  | 800×465 | fine | 16 px |

- A floor assertion: no rendered text below 12 px, and no non-chart text below 13 px at text scale 1.

**Visual baselines**
- Before changing anything, capture Playwright `toHaveScreenshot` baselines of the current base: weather, air and settings views at 402×874, 820×1180 and 1440×900, in ko and de. Chromium only, tracked under `web/e2e/__screenshots__/`.
- This phase's PR updates the baselines on purpose.

**Lint test**
- Fails on px `font-size`/`fontSize` in `web/src/**/*.{css,tsx}` outside `generated/`. The allowlist must be empty by the end of the phase.

**Proof**
- The layout matrix passes at three text scales, in Chromium and WebKit, for seven languages.
- AK reviews the screenshots.
- One real iPad check of pointer detection, if a device is available.

## Phase 2: Cordova hourly and daily charts (priority 2, core content)
**Data**
- `packages/weather-core/src/index.ts`: map `vec` (and `wdd`) for hourly rows.
- Expose the past days the service returns, with `fromToday` or an equivalent, for the daily chart.
- Unit tests against the fixtures in `docs/rewrite/examples/`: today/yesterday alignment by time, current index, the shared y domain (including the current temperature, padded to whole degrees), past-day flags, and the precipitation amount order `rn1`→`s06`→`r06`.

**Hourly chart** (`web/src/components.tsx` `TemperatureChart` becomes `HourlyChart`)
- Lift the 16-point cap.
- Build the column grid from the rows in spec §5.1: day title, hour label, icon, precipitation, then the plot with value dots.
- Add the overlap rule, the now marker and the legend in the card header.
- Add the persisted details expander (stored in `tw.web.v1.display`, default collapsed).
- Add keyboard cursor, tooltip, table alternative and forced-colors styles.
- Apply the tier column widths and plot heights.

**Daily chart** (new `DailyChart` in `web/src/Weather.tsx`)
- Replaces the `.daily-row` list (`Weather.tsx:625-670`) as the default view. The list is kept as the table alternative.
- Follows the spec §5.2 anatomy: columns including past days, AM/PM icons, precipitation, min–max bars on one shared scale, current dot, today column highlight.
- The bars use the D8 vertical gradient `#9bcdf0` (min) → `#f0c77f` (max), with the light-mode edge outline and 55% opacity for past days.
- Uses the Cordova initial-scroll rules.

**Placement**
- Mobile order: hero → hourly → daily → air → details.
- Tablet and desktop placement per spec §5.3.
- The bottom-nav and rail items scroll to and focus the charts.

**Tests**
- Unit tests for the derivations above.
- e2e checks: keyboard navigation announces values; the table alternatives match the plotted values; the legend does not intersect any dot; no value labels overlap at 402×874 or 320×694; initial scroll positions; the daily chart fills the card at 1440×900.

**Proof**
- Screenshots side by side with `docs/rewrite/screenshots/native-ios-hourly.png`, `native-ios-daily.png` and `tw-ipad-hourly.png` for AK's review.
- An additional local smoke run against the static preview with live-shaped fixture data.

## Phase 3: color, appearance and contrast
**Change**
- `style.css`: replace every hex literal with the semantic variables (§4.3), delete the dead `--good/--moderate/--poor/--bad`, and switch the air grade classes to fill/text/tint tokens.
- Chart strokes use the `chart.*` tokens.
- `App.tsx:104-108`, `web/src/state.ts:103` and `web/public/theme.js`:
  - Add the `appearance` and `heroStyle` preferences under the separate `tw.web.v1.display` key.
  - Map the legacy theme values.
  - **Dual-write the legacy `theme`.**
  - Resolve `system` before first paint.
- Update the manifest `theme_color` and the focus ring.

**Tests**
- The mapping and dual-write round-trip, including a simulated old-build rebuild of `settings`.
- The updated theme-before-paint e2e tests (`audit-fixes.spec.ts:92`, `audit-fixes-2.spec.ts:217`).
- `@axe-core/playwright` (a new pinned dev dependency): zero serious or critical findings on the three views, in light and dark.

**Proof**
- The contrast report passes.
- AK reviews dark-mode screenshots.

## Phase 4: space, radius, elevation, motion and layers
- Replace the spacing, radius, shadow and z-index literals with tokens.
- Apply the tier grid and margins.
- **Proof:** screenshot diffs reviewed, and the matrix passes.

## Phase 5: components and reference patterns
In order:
1. Tabs and segmented-control semantics.
2. A table alternative for the air bar chart.
3. A Sheet/Dialog to replace `window.confirm` (`App.tsx:1316,1349`).
4. Skeletons.
5. HighlightsCard.
6. DetailTile plain-language lines.
7. WarningBanner levels.
8. Bottom nav and rail per tier.
9. Delete the dead CSS (`.weekday-picker`, `.alarm-times`, `.toggle-label`, `.form-actions`, `.neutral`, `.danger`, `.text-button`).

MetricSwitcher is not adopted (D7). LifeIndex (D5) shows only available index data; the missing life-index data is tracked in #2650. Each item needs derivation unit tests, semantics e2e and screenshots.

## Phase 6: sky surfaces and motion
- Add the `iconKind` fog and dust kinds (§6.3).
- Sky gradients, an optional edge tint and a photo scrim.
- Opt-in CSS ambient motion that respects reduced motion.
- **Tests:**
  - token-level contrast of the gradient stops
  - e2e sampling of rendered-text contrast in photo mode
  - no layout shift
  - animation paused while hidden

## Phase 7 (optional; needs separate authorization): native alignment
- Generate ObjC color constants, or asset-catalog colorsets, for the TodayWeather `tw.ios` widget air grades and fonts. Align the colors in `TodayWeatherShowMore.m:398-437`. Retired TodayAir `ta.ios` is historical reference only.
- Requires an iOS build and a device check, outside web CI.
- The WatchKit 1 app (`applewatch/`) has no brand colors today. It stays out of scope until its product status is decided.
- Android widgets live in external plugins (`client/tw.package.json:52-53`) and are out of scope.

## Maintained documentation
- `docs/design-system/README.md` indexes the spec, plan, documentation guide, reference and evidence. The spec remains the normative behavior/value reference until token JSON becomes authoritative for values; the index does not duplicate all normative sections. Follow the documentation guide for dated supersession when rules move.
- Update `docs/webapp/specification.md` (breakpoints, daily view) and the theme section of `docs/webapp/technical-design.md` in the phases that change them.
- Regenerate the diagram through Archify whenever the pipeline changes.

## Rollback and blast radius
**Blast radius.**
- The web PWA and `packages/weather-core` (additive fields) until phase 7.
- No server, API or server-storage changes; only additive browser storage (`tw.web.v1.display`). Native apps are untouched.

**Rollback.**
- Revert the phase PR. Generated tokens are build-time only, and fonts are additive.
- The current `loadState` (`web/src/state.ts:95-115`) rebuilds `settings` and **erases unknown keys**. The plan therefore works as follows:
  - New display preferences (text scale, chart expander, appearance, heroStyle) are stored under a separate localStorage key, `tw.web.v1.display`. An older build does not touch that key.
  - The legacy `settings.theme` is dual-written.
  - After a rollback, the old build uses the dual-written theme. `system` resolves to the old build's light/dark choice. On re-upgrade, the separate key restores the new values.
  - A test simulates this round trip.
- The service-worker precache changes with each build, so returning clients receive the reverted assets.

## Risks and proof
- **What could break.**
  - de/fr wrapping at larger type.
  - Tier misdetection on an iPad with a trackpad.
  - Theme migration.
  - The chart re-implementation changing data semantics: today/yesterday alignment, current index, past days, 24-hour labels.
- **Riskiest part.** Phase 2, because it re-implements the product's most important content. Mitigation:
  - fixture-based derivation tests before the UI work
  - Cordova screenshots as the visual oracle
  - a keyboard and table-alternative parity check
  - separate PRs for the hourly and daily charts if the diff grows large
- **Rejected alternatives** (spec §12):
  - a utility-framework rewrite
  - fluid type on every role
  - width-only type tiers
  - an iOS-style daily list as the default
  - Style Dictionary now
- **Proof of correctness.** Token tests, the layout matrix across three text scales and two engines, screenshot baselines, axe scans, and chart derivation tests. Also AK's visual review per phase, an independent verifier, and a PR review by a different provider under the SDLC policy.

## Decisions (AK, 2026-10-01)
Recorded in spec §14.
- D1: Pretendard, self-hosted on S3 + CloudFront.
- D2: text-size setting.
- D3: compare with Cordova, then adjust.
- D4: keep the legacy hues.
- D5: LifeIndex only from available data, with a separate data issue.
- D6: Galaxy S26.
- D7: no MetricSwitcher.
- D8: PWA temperature gradient on the Cordova daily bars.
