package net.wizardfactory.todayweather.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import kotlin.math.floor
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart

/**
 * Vertical layout of the hourly chart in dp, from the Cordova template and styles: day labels in a 14 dp row,
 * hour labels in a row 5 dp up from that row's margin (`.row + .row`), with 2 dp padding and the height of
 * their text (`line-height: normal`); the chart; separators; detail rows; the 24 dp expander row, which ends
 * 10 dp below the wrapper (`margin-bottom: -10px`).
 */
internal class HourlyLayout(chart: HourlyChart, expanded: Boolean, measurer: TextMeasurer, density: Density) {
    val hourRowTop = 14.0
    val hourRowHeight = 4 + with(density) {
        chart.hourLabels.maxOfOrNull { measurer.measure(it, chartTextStyle(ChartStyle.label, ChartStyle.title)).size.height.toDp().value.toDouble() } ?: 0.0
    }
    val chartTop = hourRowTop + hourRowHeight
    val firstSeparator = chartTop + chart.chart.height
    val detailTop = firstSeparator + 1
    val secondSeparator = detailTop + if (expanded) chart.detail.height else 0.0
    val expanderTop = secondSeparator + 1
    val contentHeight = expanderTop + 24
    val wrapperHeight = contentHeight - 10
}

/** Test tag of the expander, which shows or hides the detail rows. */
const val EXPANDER_TAG = "chart-expander"

/** Scroll offset in px for an offset in dp, snapped down to a device pixel as the WebView does. */
internal fun scrollPixels(offset: Double, density: Float): Int = floor(offset * density).toInt()

/** A scroll state at the chart's opening offset, new for new chart data (the Cordova app scrolls on every apply). */
@Composable
internal fun rememberOpeningScroll(chart: Any, offset: Double): ScrollState {
    val density = LocalDensity.current.density
    return remember(chart, density) { ScrollState(scrollPixels(offset, density)) }
}

/**
 * The hourly forecast chart of the forecast tab (gate G2, #2884): scrolls horizontally from [scrollState]
 * (by default the opening offset: one column before the current hour); the legend and the expander stay
 * in place. The detail rows show when [expanded]; the expander row calls [onToggleExpanded].
 */
@Composable
fun HourlyChartView(
    chart: HourlyChart,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberOpeningScroll(chart, chart.openingOffset),
) {
    val measurer = rememberTextMeasurer()
    val images = rememberChartImages()
    val density = LocalDensity.current
    val layout = remember(chart, expanded, measurer, density) { HourlyLayout(chart, expanded, measurer, density) }
    Box(modifier.fillMaxWidth().height(layout.wrapperHeight.dp).clipToBounds().background(ChartStyle.background)) {
        Box(Modifier.horizontalScroll(scrollState)) {
            Canvas(Modifier.size(chart.width.dp, layout.contentHeight.dp)) {
                for (label in chart.dayLabels) {
                    drawText(measurer.measure(label.text, chartTextStyle(ChartStyle.label, ChartStyle.dayTitle), softWrap = false),
                        topLeft = Offset((label.left * density.density).toFloat(), 0f))
                }
                chart.hourLabels.forEachIndexed { i, text ->
                    val result = measurer.measure(text, chartTextStyle(ChartStyle.label, ChartStyle.title), softWrap = false)
                    val center = (i + 0.5) * chart.columnWidth
                    drawText(result, topLeft = Offset((center * density.density).toFloat() - result.size.width / 2f,
                        ((layout.hourRowTop + 2) * density.density).toFloat()))
                }
                drawSvg(chart.chart, layout.chartTop, images, measurer)
                drawSeparator(layout.firstSeparator)
                if (expanded) drawSvg(chart.detail, layout.detailTop, images, measurer)
                drawSeparator(layout.secondSeparator)
            }
        }
        Legend(chart, Modifier.align(Alignment.TopEnd).offset(x = (-10).dp, y = (chart.chart.height - 10).dp), measurer)
        // The whole 24 dp row is the expander, as the Cordova `ng-click` element; the icon is centered.
        Box(Modifier.offset(y = layout.expanderTop.dp).fillMaxWidth().height(24.dp).clickable(onClick = onToggleExpanded)
            .testTag(EXPANDER_TAG)) {
            Icon(
                if (expanded) ChartIcons.expandLess else ChartIcons.expandMore,
                contentDescription = null,
                tint = ChartStyle.text,
                modifier = Modifier.align(Alignment.Center).size(24.dp),
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSeparator(top: Double) {
    drawRect(ChartStyle.guide, Offset(0f, (top * density).toFloat()), Size(size.width, 1 * density), alpha = 0.3f)
}

/**
 * `.chart-label`: two rows (5 dp margins, a 13 dp color bar, 5 dp padding, the text) on a translucent box with
 * 5 % rounded corners, 10 dp from the right and at the chart height minus 10 dp from the top.
 */
@Composable
private fun Legend(chart: HourlyChart, modifier: Modifier, measurer: TextMeasurer) {
    val density = LocalDensity.current
    val rows = listOf(chart.legendToday to ChartStyle.today, chart.legendYesterday to ChartStyle.yesterday)
        .map { (text, color) -> measurer.measure(text, chartTextStyle(ChartStyle.label, ChartStyle.legend), softWrap = false) to color }
    val textWidth = with(density) { rows.maxOf { it.first.size.width }.toDp() }
    val width = textWidth + 28.dp
    Canvas(modifier.size(width, 41.dp)) {
        val px = density.density
        drawRoundRect(ChartStyle.legendBox, cornerRadius = CornerRadius(size.width * 0.05f, size.height * 0.05f))
        rows.forEachIndexed { i, (text, color) ->
            val top = (5 + i * 18) * px
            drawRect(color, Offset(5 * px, top), Size(13 * px, 13 * px))
            drawText(text, topLeft = Offset(23 * px, top))
        }
    }
}
