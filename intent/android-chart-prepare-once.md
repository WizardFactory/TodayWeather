# Intent: prepare Android chart text and paths once

- Task: `android-chart-prepare-once` (issue #3232, sub-issue of #2877). Mode: implementation. Change kind: behavior (performance, no visible output change). Endpoint: **pre-merge** (no merge, release, store or Remote Config action).
- Source and authority: 2026-11-27 Android performance review (phone Perfetto/gfxinfo and Compose review finding F1 on Galaxy S21+, master `d5d4cd05e`).

## Problem

Every Android tab switch still produces one slow UI-thread frame (44-47 ms entering Hourly, 33-47 ms entering Air, 26-33 ms entering Daily on Galaxy S21+ R8 release with baseline profile). `HourlyChartView`, `DailyChartView`, `SvgDrawing` and `AirChartView` call `TextMeasurer.measure(...)` inside `Canvas` / `DrawScope` with `rememberTextMeasurer()`'s default 8-entry cache, so almost every label misses and re-runs text layout on every draw, and each draw also allocates `AnnotatedString`, `Path`, `listOf`, `filter` and `parseColor` objects. Because tab pages compose fresh on every visit, per-page remembered measurers die on every switch. `AirChartView` also uses `BoxWithConstraints` solely to pass `maxWidth` to `AirChart.build`, triggering subcomposition on every Air visit.

## Outcome

Draw-ready chart data (laid-out `TextLayoutResult`s with positions, polyline `Path`s, resolved colors and precomputed draw geometry) is built once per chart and retained across tab visits at activity scope, so `onDraw` only issues draw calls and `AirChartView` no longer subcomposes via `BoxWithConstraints`, with zero visible output change at both font scale 1.0 and 1.3 (`Zoomed`).

## Scope and exclusions

In scope: `android/app` chart preparation and drawing (`ui/chart/`, `ui/air/AirChartView.kt`, `MainActivity.kt` activity-scoped provider), removing unused measurer parameters from `HourlyLayout` and `DailyLayout`, updating `ChartArtworkTest`, and adding JVM tests for `Zoomed` font scale 1.3 parity and activity-scoped cache reuse/invalidation.
Out of scope: keeping tab pages composed across switches, changing `core-domain` chart geometry or `ChartStyle` text metrics, raising `tolerances.json`, iOS, server, and releasing. Emulator device smoke, baseline profile regeneration and Galaxy S21+ before/after measurement are run by the coordinator after this pre-merge implementation.

## Acceptance criteria

- **AC1** No `TextMeasurer.measure` (or `measurer.measure`) call remains inside a `Canvas`/`DrawScope` block in `ui/chart/` and `ui/air/AirChartView.kt`, and `AirChartView.kt` no longer uses `BoxWithConstraints`.
- **AC2** `./gradlew assembleDebug test` passes with unchanged screenshot tolerances, including `ChartScreenshotTest`, `ForecastScreenshotTest`, `AirScreenshotTest`, `ChartArtworkTest` and `ForecastChartsTest`.
- **AC3** A new JVM test renders charts inside `Zoomed` at font scale 1.3 and matches the pre-change render, and JVM tests verify activity-scoped reuse across visits, bounded capacity (at most one hourly, one daily, one air entry), and invalidation on chart, color, density, font scale, layout direction, font family resolver, expanded state and Air width changes.
- **AC4** `tools/chart-reference/device-smoke.sh` passes on an arm64 API 36 emulator, baseline profile is regenerated, and Galaxy S21+ scripted journey shows a lower worst frame for Hourly and Daily entry and lower or equal p90 against master (executed by the coordinator).
