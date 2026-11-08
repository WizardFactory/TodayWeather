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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.core.domain.chart.DailyChart

/**
 * Vertical layout of the daily chart in dp: weekday and date rows with 2 dp padding and the height of their
 * text (`line-height: normal`), the second row 5 dp up (`.row + .row`), then the chart.
 */
internal class DailyLayout(chart: DailyChart, private val measurer: TextMeasurer, private val density: Density) {
    private fun rowHeight(texts: List<String>, size: androidx.compose.ui.unit.TextUnit) = 4 + with(density) {
        texts.maxOfOrNull { measurer.measure(it, chartTextStyle(ChartStyle.label, size)).size.height.toDp().value.toDouble() } ?: 0.0
    }
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
) {
    val measurer = rememberTextMeasurer()
    val images = rememberChartImages()
    val density = LocalDensity.current
    val layout = remember(chart, measurer, density) { DailyLayout(chart, measurer, density) }
    Box(modifier.fillMaxWidth().height(layout.contentHeight.dp).background(ChartStyle.background).horizontalScroll(scrollState)) {
        Canvas(Modifier.size(chart.width.dp, layout.contentHeight.dp)) {
            fun row(texts: List<String>, size: androidx.compose.ui.unit.TextUnit, top: Double) = texts.forEachIndexed { i, text ->
                val result = measurer.measure(text, chartTextStyle(ChartStyle.label, size), softWrap = false)
                val center = (i + 0.5) * chart.columnWidth
                drawText(result, topLeft = Offset((center * density.density).toFloat() - result.size.width / 2f, ((top + 2) * density.density).toFloat()))
            }
            row(chart.dayNames, ChartStyle.smallTitle, 0.0)
            row(chart.dates, ChartStyle.title, layout.dateRowTop)
            drawSvg(chart.chart, layout.chartTop, images, measurer)
        }
    }
}
