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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import kotlin.math.floor
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.ui.text.CssMetrics

/**
 * Vertical layout of the hourly chart in dp, from the Cordova template and styles: day labels in a 14 dp row,
 * hour labels in a row 5 dp up from that row's margin (`.row + .row`), with 2 dp padding and the height of
 * their text (`line-height: normal`); the chart; separators; detail rows; the 24 dp expander row, which ends
 * 10 dp below the wrapper (`margin-bottom: -10px`).
 */
internal class HourlyLayout(chart: HourlyChart, expanded: Boolean, density: Density) {
    val hourRowTop = 14.0
    // `line-height: normal` as the WebView rounds it (CssMetrics): 24.5 dp for "24시", 20 dp for "24h".
    val hourRowHeight = 4 + (chart.hourLabels.maxOfOrNull { CssMetrics.heightDp(it, chartTextStyle(Color.Black, ChartStyle.title), density) } ?: 0.0)
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

/**
 * A scroll state at the chart's opening offset, new for new chart data and for each complete apply ([applies]), as the
 * Cordova app sets `scrollLeft` after every apply, the same data too.
 */
@Composable
internal fun rememberOpeningScroll(chart: Any, offset: Double, applies: Int = 0): ScrollState {
    val density = LocalDensity.current.density
    return remember(chart, density, applies) { ScrollState(scrollPixels(offset, density)) }
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
    colors: ChartColors = ChartColors.LIGHT,
) {
    val imageCache = rememberForecastChartImages()
    val preparedCache = rememberPreparedChartCache()
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val fontFamilyResolver = LocalFontFamilyResolver.current
    val prepared = preparedCache.hourly(chart, expanded, colors, density, layoutDirection, fontFamilyResolver, imageCache)
    val layout = prepared.layout
    Box(modifier.fillMaxWidth().height(layout.wrapperHeight.dp).clipToBounds().background(colors.background)) {
        Box(Modifier.horizontalScroll(scrollState)) {
            Canvas(Modifier.size(chart.width.dp, layout.contentHeight.dp)) {
                for (label in prepared.dayLabels) drawText(label.layout, topLeft = label.topLeft)
                for (label in prepared.hourLabels) drawText(label.layout, topLeft = label.topLeft)
                drawSvg(prepared.chartSvg)
                drawRect(prepared.separatorColor, Offset(0f, prepared.firstSeparatorY), Size(size.width, prepared.separatorHeight), alpha = 0.3f)
                prepared.detailSvg?.let { drawSvg(it) }
                drawRect(prepared.separatorColor, Offset(0f, prepared.secondSeparatorY), Size(size.width, prepared.separatorHeight), alpha = 0.3f)
            }
        }
        Legend(prepared.legend, Modifier.align(Alignment.TopEnd).offset(x = (-10).dp, y = (chart.chart.height - 10).dp))
        // The whole 24 dp row is the expander, as the Cordova `ng-click` element; the icon is centered.
        Box(Modifier.offset(y = layout.expanderTop.dp).fillMaxWidth().height(24.dp).clickable(onClick = onToggleExpanded)
            .testTag(EXPANDER_TAG)) {
            Icon(
                if (expanded) ChartIcons.expandLess else ChartIcons.expandMore,
                contentDescription = null,
                tint = colors.expander,
                modifier = Modifier.align(Alignment.Center).size(24.dp),
            )
        }
    }
}

/**
 * `.chart-label`: two rows (5 dp margins, a 13 dp color bar, 5 dp padding, the text) on a translucent box with
 * 5 % rounded corners, 10 dp from the right and at the chart height minus 10 dp from the top.
 */
@Composable
private fun Legend(legend: PreparedLegend, modifier: Modifier) {
    Canvas(modifier.size(legend.width, 41.dp)) {
        drawRoundRect(legend.boxColor, cornerRadius = CornerRadius(size.width * 0.05f, size.height * 0.05f))
        drawRect(legend.todayColor, legend.todayBarTopLeft, legend.barSize)
        drawText(legend.todayText, topLeft = legend.todayTextTopLeft)
        drawRect(legend.yesterdayColor, legend.yesterdayBarTopLeft, legend.barSize)
        drawText(legend.yesterdayText, topLeft = legend.yesterdayTextTopLeft)
    }
}
