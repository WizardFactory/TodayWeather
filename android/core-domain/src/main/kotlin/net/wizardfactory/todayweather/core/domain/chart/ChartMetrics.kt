package net.wizardfactory.todayweather.core.domain.chart

import kotlin.math.min

/**
 * Chart sizes from the screen size in dp, as the Cordova forecast screen computes them (`initSize` in
 * controller.tabctrl.js, `init`, `getShortTableHeight`, `getMidTableHeight` and `applyWeatherData` in
 * controller.forecastctrl.js; Android, not iOS). [bodyWidth] and [bodyHeight] are `screen.width` and
 * `screen.height`: the display size in dp.
 */
class ChartMetrics(val bodyWidth: Double, val bodyHeight: Double) {
    /** `colWidth`: a seventh of the body, at most 60. */
    val columnWidth: Double = min(bodyWidth / 7, 60.0)

    /** `smallImageSize`: icons in both charts. */
    val iconSize: Double = columnWidth - columnWidth * 0.2 * 2

    /** `headerHeight`: the minimum height of the weather pages' header block, bar included. */
    val headerHeight: Double

    /** `bigFontSize`: the header's temperature; the chart heights grow with it. */
    val bigFontSize: Double

    /** `bigImageSize`: the header's sky image. */
    val bigImageSize: Double get() = bigFontSize * 0.9

    init {
        val headerRatio = when {
            bodyHeight < 600 -> 2.0 / 5
            bodyHeight < 840 -> 3.0 / 8
            else -> 5.0 / 12
        }
        headerHeight = if (bodyHeight * headerRatio < 192) 192.0 else bodyHeight * headerRatio
        val contentWidth = bodyWidth * 0.8
        val contentHeight = headerHeight - 44 - 5 - 24 * 3
        val big = if (contentWidth / 4 < contentHeight * 0.9) contentWidth / 4 else contentHeight * 0.9
        bigFontSize = if (big < 142.1) big else 142.1
    }

    /** Rows above the hourly lines for [displayItemCount] (0 or undefined: 3). */
    fun shortTableHeight(displayItemCount: Double): Double {
        val count = if (displayItemCount.isNaN() || displayItemCount == 0.0) 3.0 else displayItemCount
        var value = 0.0
        if (count >= 1) value += iconSize
        if (count >= 2) value += 15
        if (count >= 3) value += 13
        return value
    }

    /** Rows above the daily bars for the [displayItemCount] bit set (0 or undefined: 7). */
    fun midTableHeight(displayItemCount: Double): Double {
        val count = if (displayItemCount.isNaN() || displayItemCount == 0.0) 7 else displayItemCount.toInt()
        var value = 17.0 + iconSize
        value += if (count and 4 != 0) iconSize else iconSize / 2
        if (count and 2 != 0) value += 15
        if (count and 1 != 0) value += 13
        return value
    }

    fun hourlyChartHeight(displayItemCount: Double): Double =
        (shortTableHeight(displayItemCount) + bigFontSize * 2).let { if (it < 300) it else 300.0 }

    /** Margin, icon, text, icon, text, margin. */
    val detailChartHeight: Double get() = 12.0 * 2 + iconSize * 2 + 15 * 2

    fun dailyChartHeight(displayItemCount: Double): Double =
        (midTableHeight(displayItemCount) + bigFontSize * 1.5).let { if (it < 300) it else 300.0 }
}
