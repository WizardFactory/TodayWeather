package net.wizardfactory.todayweather.ui.air

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.air.AirChart
import net.wizardfactory.todayweather.core.domain.air.AirSeries
import net.wizardfactory.todayweather.ui.chart.chartTextStyle

/**
 * S05's hourly chart (ngAirChart) across the card, [height] dp high (`chartAirHeight`): the scene [AirChart.build]
 * makes for the card's width, drawn as the WebView draws its SVG. The Cordova chart kept the width it was first drawn
 * at; this one follows the card when the window changes.
 */
@Composable
internal fun AirChartView(series: AirSeries, standard: AirStandard?, hour: String, colors: AirColors, height: Double = 100.0, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier.fillMaxWidth().height(height.dp).testTag(AirTags.CHART)) {
        val width = maxWidth.value.toDouble()
        val chart = remember(series, standard, hour, width, height) { AirChart.build(series, standard, hour, width, height) }
        Canvas(Modifier.fillMaxSize()) { drawAirChart(chart, colors, measurer) }
    }
}

/**
 * The chart's SVG in document order: each tick's 1 dp line (the current hour's 2 dp line reaching the top) and its
 * 13 sp label centered on it, `dy` 0.71 em under y 9 with the date 1.065 em under that; the axis line; then the bars,
 * which cover the axis. Lines are crisp (`shape-rendering: crispEdges`): whole device pixels, no smoothing.
 */
internal fun DrawScope.drawAirChart(chart: AirChart, colors: AirColors, measurer: TextMeasurer) {
    val d = density
    val bottom = chart.bottom
    val style = chartTextStyle(colors.axisText, 13.sp)
    val em = 13.sp.toPx() / d
    // A crisp line [w] dp wide centered on [at] dp: its whole device pixels.
    fun crisp(at: Double, w: Double): Pair<Float, Float> {
        val from = (at * d - w * d / 2).roundToInt().toFloat()
        return from to (w * d).roundToInt().toFloat()
    }
    for (tick in chart.ticks) {
        val (x, w) = crisp(tick.x, if (tick.current) 2.0 else 1.0)
        val top = if (tick.current) 0.0 else bottom
        drawRect(colors.axis, Offset(x, (top * d).roundToInt().toFloat()), Size(w, ((bottom + 6 - top) * d).roundToInt().toFloat()))
        fun label(text: String, baseline: Double) {
            if (text.isEmpty()) return
            val layout = measurer.measure(text, style, softWrap = false, maxLines = 1)
            drawText(layout, topLeft = Offset((tick.x * d).toFloat() - layout.size.width / 2f, (baseline * d).toFloat() - layout.firstBaseline))
        }
        val baseline = bottom + 9 + 0.71 * em
        label(tick.label, baseline)
        tick.date?.let { label(it, baseline + 1.065 * em) }
    }
    val start = chart.domainStart
    val end = chart.domainEnd
    if (start != null && end != null) {
        val (y, h) = crisp(bottom, 1.0)
        drawRect(colors.axis, Offset((start * d).roundToInt().toFloat(), y), Size(((end - start) * d).roundToInt().toFloat(), h))
    }
    for (bar in chart.bars) {
        if (listOf(bar.x, bar.y, bar.width, bar.height).any { it.isNaN() } || bar.height <= 0) continue
        val fill = bar.fill?.let { Color(android.graphics.Color.parseColor(it)) } ?: colors.bar
        drawRect(fill, Offset((bar.x * d).toFloat(), (bar.y * d).toFloat()), Size((bar.width * d).toFloat(), (bar.height * d).toFloat()),
            alpha = if (bar.current) 1f else colors.blurry)
    }
}
