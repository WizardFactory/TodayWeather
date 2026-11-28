package net.wizardfactory.todayweather.ui.air

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.air.AirChart
import net.wizardfactory.todayweather.core.domain.air.AirSeries
import net.wizardfactory.todayweather.ui.chart.PreparedRect
import net.wizardfactory.todayweather.ui.chart.PreparedText
import net.wizardfactory.todayweather.ui.chart.chartTextStyle
import net.wizardfactory.todayweather.ui.chart.rememberPreparedChartCache

/** One tick of a prepared Air chart in document order: its crisp line and optional hour/date labels. */
internal class PreparedAirTick(
    val line: PreparedRect,
    val label: PreparedText?,
    val date: PreparedText?,
)

/** Draw-ready S05 hourly chart: crisp tick/axis/bar geometry, resolved colors and laid-out labels (#3232). */
internal class PreparedAirChart(
    val ticks: List<PreparedAirTick>,
    val axis: PreparedRect?,
    val bars: List<PreparedRect>,
)

/**
 * S05's hourly chart (ngAirChart) across the card, [height] dp high (`chartAirHeight`): the scene [AirChart.build]
 * makes for the card's width, drawn as the WebView draws its SVG. The Cordova chart kept the width it was first drawn
 * at; this one follows the card when the window changes without subcomposing (#3232).
 */
@Composable
internal fun AirChartView(series: AirSeries, standard: AirStandard?, hour: String, colors: AirColors, height: Double = 100.0, modifier: Modifier = Modifier) {
    val preparedCache = rememberPreparedChartCache()
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val fontFamilyResolver = LocalFontFamilyResolver.current
    Spacer(
        modifier
            .fillMaxWidth()
            .height(height.dp)
            .testTag(AirTags.CHART)
            .drawWithCache {
                val width = (size.width / this.density).toDouble()
                val prepared = preparedCache.air(
                    series = series,
                    standard = standard,
                    hour = hour,
                    width = width,
                    height = height,
                    colors = colors,
                    density = density,
                    layoutDirection = layoutDirection,
                    fontFamilyResolver = fontFamilyResolver,
                )
                onDrawBehind { drawPreparedAirChart(prepared) }
            }
    )
}

/**
 * Prepares the chart's SVG in document order outside [DrawScope]: each tick's crisp 1 dp line (the current hour's
 * 2 dp line reaching the top) and its 13 sp label centered on it, `dy` 0.71 em under y 9 with the date 1.065 em under
 * that; the axis line; then the bars, which cover the axis. Lines are crisp (`shape-rendering: crispEdges`): whole
 * device pixels, no smoothing.
 */
internal fun prepareAirChart(chart: AirChart, colors: AirColors, density: Density, measurer: TextMeasurer): PreparedAirChart {
    val d = density.density
    val bottom = chart.bottom
    val style = chartTextStyle(colors.axisText, 13.sp)
    val em = with(density) { 13.sp.toPx() } / d

    // A crisp line [w] dp wide centered on [at] dp: its whole device pixels.
    fun crispFrom(at: Double, w: Double): Float = (at * d - w * d / 2).roundToInt().toFloat()
    fun crispSize(w: Double): Float = (w * d).roundToInt().toFloat()

    val ticks = ArrayList<PreparedAirTick>(chart.ticks.size)
    for (tick in chart.ticks) {
        val lineW = if (tick.current) 2.0 else 1.0
        val x = crispFrom(tick.x, lineW)
        val w = crispSize(lineW)
        val top = if (tick.current) 0.0 else bottom
        val line = PreparedRect(colors.axis, Offset(x, (top * d).roundToInt().toFloat()), Size(w, ((bottom + 6 - top) * d).roundToInt().toFloat()))

        fun prepareLabel(text: String?, baseline: Double): PreparedText? {
            if (text.isNullOrEmpty()) return null
            val layout = measurer.measure(text, style, softWrap = false, maxLines = 1)
            return PreparedText(layout, Offset((tick.x * d).toFloat() - layout.size.width / 2f, (baseline * d).toFloat() - layout.firstBaseline))
        }

        val baseline = bottom + 9 + 0.71 * em
        ticks += PreparedAirTick(line, prepareLabel(tick.label, baseline), prepareLabel(tick.date, baseline + 1.065 * em))
    }

    val start = chart.domainStart
    val end = chart.domainEnd
    val axis = if (start != null && end != null) {
        PreparedRect(colors.axis, Offset((start * d).roundToInt().toFloat(), crispFrom(bottom, 1.0)), Size(((end - start) * d).roundToInt().toFloat(), crispSize(1.0)))
    } else {
        null
    }

    val bars = ArrayList<PreparedRect>(chart.bars.size)
    for (bar in chart.bars) {
        if (bar.x.isNaN() || bar.y.isNaN() || bar.width.isNaN() || bar.height.isNaN() || bar.height <= 0) continue
        val fill = bar.fill?.let { Color(android.graphics.Color.parseColor(it)) } ?: colors.bar
        bars += PreparedRect(
            color = fill,
            topLeft = Offset((bar.x * d).toFloat(), (bar.y * d).toFloat()),
            size = Size((bar.width * d).toFloat(), (bar.height * d).toFloat()),
            alpha = if (bar.current) 1f else colors.blurry,
        )
    }

    return PreparedAirChart(ticks, axis, bars)
}

/** Draws a [PreparedAirChart] in document order without measuring text or allocating geometry. */
internal fun DrawScope.drawPreparedAirChart(prepared: PreparedAirChart) {
    for (tick in prepared.ticks) {
        val line = tick.line
        drawRect(line.color, line.topLeft, line.size, alpha = line.alpha)
        tick.label?.let { drawText(it.layout, topLeft = it.topLeft) }
        tick.date?.let { drawText(it.layout, topLeft = it.topLeft) }
    }
    prepared.axis?.let { drawRect(it.color, it.topLeft, it.size, alpha = it.alpha) }
    for (bar in prepared.bars) {
        drawRect(bar.color, bar.topLeft, bar.size, alpha = bar.alpha)
    }
}
