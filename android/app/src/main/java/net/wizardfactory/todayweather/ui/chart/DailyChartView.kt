package net.wizardfactory.todayweather.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.ui.text.CssMetrics

/**
 * Vertical layout of the daily chart in dp: weekday and date rows with 2 dp padding and the height of their
 * text (`line-height: normal`), the second row 5 dp up (`.row + .row`), then the chart.
 */
internal class DailyLayout(chart: DailyChart, private val density: Density) {
    // `line-height: normal` as the WebView rounds it (CssMetrics).
    private fun rowHeight(texts: List<String>, size: androidx.compose.ui.unit.TextUnit) =
        4 + (texts.maxOfOrNull { CssMetrics.heightDp(it, chartTextStyle(Color.Black, size), density) } ?: 0.0)
    val nameRowHeight = rowHeight(chart.dayNames, ChartStyle.smallTitle)
    val dateRowTop = nameRowHeight - 5
    val dateRowHeight = rowHeight(chart.dates, ChartStyle.title)
    val chartTop = dateRowTop + dateRowHeight
    val contentHeight = chartTop + chart.chart.height
}

/**
 * The daily forecast chart of the daily tab (gate G2, #2884): scrolls horizontally from [scrollState] (by
 * default the opening offset: today in the third column).
 */
@Composable
fun DailyChartView(
    chart: DailyChart,
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberOpeningScroll(chart, chart.openingOffset),
    colors: ChartColors = ChartColors.LIGHT,
) {
    val imageCache = rememberForecastChartImages()
    val preparedCache = rememberPreparedChartCache()
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val fontFamilyResolver = LocalFontFamilyResolver.current
    val prepared = preparedCache.daily(chart, colors, density, layoutDirection, fontFamilyResolver, imageCache)
    val layout = prepared.layout
    Box(modifier.fillMaxWidth().height(layout.contentHeight.dp).background(colors.background).horizontalScroll(scrollState)) {
        Canvas(Modifier.size(chart.width.dp, layout.contentHeight.dp)) {
            for (label in prepared.labels) drawText(label.layout, topLeft = label.topLeft)
            drawSvg(prepared.chartSvg)
        }
    }
}
