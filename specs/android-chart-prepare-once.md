# Spec: Android chart prepare once

Consumes [intent](../intent/android-chart-prepare-once.md) and the 2026-11-27 Android performance review (issue #3232).

## Activity-scoped prepared chart cache

1. `PreparedChartCache` is created once per activity in `AppContent` (`MainActivity.kt`) alongside `ForecastCharts` and `ForecastChartImages`, and provided around the shell via `LocalPreparedCharts`. It is never static or process-wide, so activity recreation (rotation, fold/unfold, theme/configuration change) discards and rebuilds it. Standalone callers without a provider fall back to a locally remembered cache.
2. The cache holds at most one prepared hourly chart, one prepared daily chart and one prepared air chart.
3. Each entry is keyed on every input that changes drawn pixels:
   - Hourly: chart instance (`===`), `ChartColors`, zoomed `Density` (including `density` and `fontScale`), `LayoutDirection`, `FontFamily.Resolver`, `ForecastChartImages` instance (`===`), and `expanded`. When only `expanded` changes for the same chart and environment, shared header/main-chart/legend layouts may be reused while dropping `detailSvg` when collapsed so collapsed memory stays bounded.
   - Daily: chart instance (`===`), `ChartColors`, zoomed `Density` (`density`, `fontScale`), `LayoutDirection`, `FontFamily.Resolver`, and `ForecastChartImages` instance (`===`).
   - Air: `AirSeries` data and `maxValue`, `AirStandard?`, `hour` string, chart `width` and `height`, `AirColors`, zoomed `Density` (`density`, `fontScale`), `LayoutDirection`, and `FontFamily.Resolver`.

## Prepare-once drawing

4. `prepareSvg` flattens `Svg` nodes in exact document order outside `DrawScope`, skipping NaN elements without allocating temporary lists, pre-building polyline `Path`s and `Stroke`s, resolving colors and measuring every `SvgText` (`AnnotatedString` with `tspan` styling) using `chartTextStyle` (`includeFontPadding = false`, no font family) and the zoomed `Density`. `DrawScope.drawSvg(PreparedSvg)` only issues `drawRect`, `drawLine`, `drawImage`, `drawText`, `drawPath` and `drawCircle`.
5. `HourlyChartView` prepares day labels, hour labels, main chart SVG, optional detail SVG, separator positions and `Legend` rows (`PreparedLegend`, with precomputed width and positions) once in `PreparedChartCache`. `HourlyLayout` drops its unused `TextMeasurer` parameter.
6. `DailyChartView` prepares weekday labels, date labels and chart SVG once in `PreparedChartCache`. `DailyLayout` drops its unused `TextMeasurer` parameter.
7. `AirChartView` removes `BoxWithConstraints`, sizing itself with `Modifier.fillMaxWidth().height(height.dp).testTag(AirTags.CHART)` and computing width inside `Modifier.drawWithCache` (`(size.width / density).toDouble()`). `PreparedChartCache.air` builds `AirChart`, parses bar hex colors once, computes crisp tick/axis/bar geometry and measures tick/date labels once outside `DrawScope`; `onDrawBehind` only calls `drawRect` and `drawText`.

## Preserved contracts

8. `Zoomed` (`Density(density * fontScale, 1f)`), `chartTextStyle`, baselines/positions, `EXPANDER_TAG` (`chart-expander`), `forecast-block-1`, `AirTags.CHART`, chart card height (#3212), and `ForecastCharts` `assertSame` reuse remain unchanged.

## Non-goals

Changing `core-domain` chart geometry or fonts, raising `tolerances.json`, or keeping tab pages composed across switches.
