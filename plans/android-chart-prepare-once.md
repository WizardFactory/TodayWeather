# Plan: Android chart prepare once

Consumes [intent](../intent/android-chart-prepare-once.md) and [spec](../specs/android-chart-prepare-once.md).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Capture pre-change `Zoomed` (font scale 1.3) reference renders for Hourly (expanded), Daily and Air before any production edit, and add failing/baseline TDD tests for zoomed parity, cache reuse/invalidation and bounds | `app/src/test/.../ui/chart/ChartPreparedTest.kt`, `app/src/test/resources/chart-zoomed-reference/*.png` | Baseline test runs before production edits (`reports/sdlc/android-chart-prepare-once/logs/tdd-before.log`) |
| 2 | Add `PreparedSvg` / `prepareSvg` / `drawSvg(PreparedSvg)` and activity-scoped `PreparedChartCache` (`LocalPreparedCharts`), bounded to 1 hourly, 1 daily, 1 air entry | `ui/chart/SvgDrawing.kt`, `ui/chart/PreparedCharts.kt`, `MainActivity.kt` | Unit tests verify 1-entry bound, reuse across visits, invalidation on every key axis, and zero `measure` calls in `DrawScope` |
| 3 | Switch `HourlyChartView` (and `Legend`), `DailyChartView` and `AirChartView` to prepared drawing; remove unused measurer parameters from `HourlyLayout` and `DailyLayout`; replace `BoxWithConstraints` in `AirChartView` with `drawWithCache` | `ui/chart/HourlyChartView.kt`, `ui/chart/DailyChartView.kt`, `ui/air/AirChartView.kt`, `app/src/test/.../ui/chart/ChartArtworkTest.kt` | `rg` confirms zero `measure` calls in `Canvas`/`DrawScope` in `ui/chart/` and `ui/air/AirChartView.kt` and zero `BoxWithConstraints` in `AirChartView.kt`; full `./gradlew assembleDebug test` passes with unchanged tolerances |
| 4 | Coordinator-owned device checks: emulator `device-smoke.sh`, baseline profile regeneration and Galaxy S21+ before/after `gfxinfo` | `app/src/main/generated/baselineProfiles/*`, PR evidence | Executed by coordinator after this pre-merge change |

Rejected: static/process-wide cache (risks stale density/colors across activity recreation); `onSizeChanged` + `mutableStateOf` for `AirChartView` (triggers an extra recomposition pass and risks a blank first frame on tab entry); caching only a shared `TextMeasurer(512)` while keeping per-draw `AnnotatedString`/`Path`/`parseColor`/list allocations.

Rollback: revert the commit; prepared drawing is self-contained inside `android/app`.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Reader switching between Hourly, Daily and Air tabs | Switch Hourly -> Daily -> Air -> Hourly with the same place and settings | Each chart prepares text layouts, paths and colors once and reuses them across visits; draw pass only draws | Repeated `TextMeasurer.measure` or subcomposition on revisit |
| S2 | Reader with large font (font scale 1.3) | Open Hourly (expanded), Daily and Air tabs | Charts zoom via `Zoomed` with exact pre-change pixels and layout | Stale non-zoomed density or shifted text |
| S3 | Reader toggling Hourly details, changing theme, or switching places | Tap `chart-expander`, switch theme/place | Cache invalidates and redraws accurately while retaining at most 1 hourly, 1 daily and 1 air entry | Stale chart, missing detail rows, or unbounded cache growth |
