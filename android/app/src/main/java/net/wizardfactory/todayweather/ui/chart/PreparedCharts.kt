package net.wizardfactory.todayweather.ui.chart

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonElement
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.air.AirChart
import net.wizardfactory.todayweather.core.domain.air.AirSeries
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.ui.air.AirColors
import net.wizardfactory.todayweather.ui.air.PreparedAirChart
import net.wizardfactory.todayweather.ui.air.prepareAirChart

internal val LocalPreparedCharts = staticCompositionLocalOf<PreparedChartCache?> { null }

/** Draw-ready `.chart-label` legend for the hourly chart (#3232). */
internal class PreparedLegend(
    val width: Dp,
    val boxColor: Color,
    val todayColor: Color,
    val yesterdayColor: Color,
    val todayText: TextLayoutResult,
    val yesterdayText: TextLayoutResult,
    val barSize: Size,
    val todayBarTopLeft: Offset,
    val yesterdayBarTopLeft: Offset,
    val todayTextTopLeft: Offset,
    val yesterdayTextTopLeft: Offset,
)

/** Draw-ready hourly chart: layout, header labels, main/detail SVGs, separators and legend. */
internal class PreparedHourlyChart(
    val layout: HourlyLayout,
    val dayLabels: List<PreparedText>,
    val hourLabels: List<PreparedText>,
    val chartSvg: PreparedSvg,
    val detailSvg: PreparedSvg?,
    val firstSeparatorY: Float,
    val secondSeparatorY: Float,
    val separatorHeight: Float,
    val separatorColor: Color,
    val legend: PreparedLegend,
)

/** Draw-ready daily chart: layout, weekday/date labels and chart SVG. */
internal class PreparedDailyChart(
    val layout: DailyLayout,
    val labels: List<PreparedText>,
    val chartSvg: PreparedSvg,
)

/**
 * Activity-scoped cache of draw-ready chart data (#3232), bounded to at most one hourly, one daily and one air entry.
 * Lives for the activity (like [ForecastCharts] and [ForecastChartImages]) so tab visits reuse prepared layouts and
 * paths while activity recreation rebuilds them for the new configuration.
 */
internal class PreparedChartCache {
    private class HourlyBaseKey(
        val chart: HourlyChart,
        val colors: ChartColors,
        val density: Density,
        val densityValue: Float,
        val fontScale: Float,
        val layoutDirection: LayoutDirection,
        val fontFamilyResolver: FontFamily.Resolver,
        val images: ForecastChartImages,
    ) {
        override fun equals(other: Any?): Boolean = other is HourlyBaseKey &&
            chart === other.chart &&
            colors == other.colors &&
            density == other.density &&
            densityValue == other.densityValue &&
            fontScale == other.fontScale &&
            layoutDirection == other.layoutDirection &&
            fontFamilyResolver == other.fontFamilyResolver &&
            images === other.images

        override fun hashCode(): Int = System.identityHashCode(chart)
    }

    private class HourlyEntry(val base: HourlyBaseKey, val expanded: Boolean, val prepared: PreparedHourlyChart)

    private class DailyKey(
        val chart: DailyChart,
        val colors: ChartColors,
        val density: Density,
        val densityValue: Float,
        val fontScale: Float,
        val layoutDirection: LayoutDirection,
        val fontFamilyResolver: FontFamily.Resolver,
        val images: ForecastChartImages,
    ) {
        override fun equals(other: Any?): Boolean = other is DailyKey &&
            chart === other.chart &&
            colors == other.colors &&
            density == other.density &&
            densityValue == other.densityValue &&
            fontScale == other.fontScale &&
            layoutDirection == other.layoutDirection &&
            fontFamilyResolver == other.fontFamilyResolver &&
            images === other.images

        override fun hashCode(): Int = System.identityHashCode(chart)
    }

    private data class AirKey(
        val data: List<JsonElement?>,
        val maxValueBits: Long?,
        val standard: AirStandard?,
        val hour: String,
        val widthBits: Long,
        val heightBits: Long,
        val colors: AirColors,
        val density: Density,
        val densityValue: Float,
        val fontScale: Float,
        val layoutDirection: LayoutDirection,
        val fontFamilyResolver: FontFamily.Resolver,
    )

    private var hourly: HourlyEntry? = null
    private var daily: Pair<DailyKey, PreparedDailyChart>? = null
    private var air: Pair<AirKey, PreparedAirChart>? = null

    internal var hourlyPrepares: Int = 0
        private set
    internal var hourlyDetailPrepares: Int = 0
        private set
    internal var dailyPrepares: Int = 0
        private set
    internal var airPrepares: Int = 0
        private set

    fun hourly(
        chart: HourlyChart,
        expanded: Boolean,
        colors: ChartColors,
        density: Density,
        layoutDirection: LayoutDirection,
        fontFamilyResolver: FontFamily.Resolver,
        images: ForecastChartImages,
    ): PreparedHourlyChart {
        val base = HourlyBaseKey(chart, colors, density, density.density, density.fontScale, layoutDirection, fontFamilyResolver, images)
        val previous = hourly
        if (previous != null && previous.base == base) {
            if (previous.expanded == expanded) return previous.prepared
            val layout = HourlyLayout(chart, expanded, density)
            val d = density.density
            val detailSvg = if (expanded) {
                hourlyDetailPrepares++
                val measurer = TextMeasurer(fontFamilyResolver, density, layoutDirection, cacheSize = PREPARE_MEASURER_CACHE)
                val detailImages = images.prepare(colors, chart.detail)
                prepareSvg(chart.detail, layout.detailTop, detailImages, colors, density, measurer)
            } else {
                null
            }
            val updated = PreparedHourlyChart(
                layout = layout,
                dayLabels = previous.prepared.dayLabels,
                hourLabels = previous.prepared.hourLabels,
                chartSvg = previous.prepared.chartSvg,
                detailSvg = detailSvg,
                firstSeparatorY = (layout.firstSeparator * d).toFloat(),
                secondSeparatorY = (layout.secondSeparator * d).toFloat(),
                separatorHeight = 1 * d,
                separatorColor = colors.separator,
                legend = previous.prepared.legend,
            )
            hourly = HourlyEntry(base, expanded, updated)
            return updated
        }

        hourlyPrepares++
        if (expanded) hourlyDetailPrepares++
        val layout = HourlyLayout(chart, expanded, density)
        val d = density.density
        val measurer = TextMeasurer(fontFamilyResolver, density, layoutDirection, cacheSize = PREPARE_MEASURER_CACHE)
        val preparedImages = if (expanded) images.prepare(colors, chart.chart, chart.detail) else images.prepare(colors, chart.chart)

        val dayStyle = chartTextStyle(colors.label, ChartStyle.dayTitle)
        val dayLabels = chart.dayLabels.map { label ->
            PreparedText(
                layout = measurer.measure(label.text, dayStyle, softWrap = false),
                topLeft = Offset((label.left * d).toFloat(), 0f),
            )
        }
        val hourStyle = chartTextStyle(colors.label, ChartStyle.title)
        val hourTop = ((layout.hourRowTop + 2) * d).toFloat()
        val hourLabels = chart.hourLabels.mapIndexed { i, text ->
            val result = measurer.measure(text, hourStyle, softWrap = false)
            val center = (i + 0.5) * chart.columnWidth
            PreparedText(result, Offset((center * d).toFloat() - result.size.width / 2f, hourTop))
        }
        val chartSvg = prepareSvg(chart.chart, layout.chartTop, preparedImages, colors, density, measurer)
        val detailSvg = if (expanded) prepareSvg(chart.detail, layout.detailTop, preparedImages, colors, density, measurer) else null

        val legendStyle = chartTextStyle(colors.label, ChartStyle.legend)
        val todayText = measurer.measure(chart.legendToday, legendStyle, softWrap = false)
        val yesterdayText = measurer.measure(chart.legendYesterday, legendStyle, softWrap = false)
        val textWidth = with(density) { maxOf(todayText.size.width, yesterdayText.size.width).toDp() }
        val legend = PreparedLegend(
            width = textWidth + 28.dp,
            boxColor = colors.legendBox,
            todayColor = colors.legendToday,
            yesterdayColor = colors.legendYesterday,
            todayText = todayText,
            yesterdayText = yesterdayText,
            barSize = Size(13 * d, 13 * d),
            todayBarTopLeft = Offset(5 * d, 5 * d),
            yesterdayBarTopLeft = Offset(5 * d, 23 * d),
            todayTextTopLeft = Offset(23 * d, 5 * d),
            yesterdayTextTopLeft = Offset(23 * d, 23 * d),
        )

        val prepared = PreparedHourlyChart(
            layout = layout,
            dayLabels = dayLabels,
            hourLabels = hourLabels,
            chartSvg = chartSvg,
            detailSvg = detailSvg,
            firstSeparatorY = (layout.firstSeparator * d).toFloat(),
            secondSeparatorY = (layout.secondSeparator * d).toFloat(),
            separatorHeight = 1 * d,
            separatorColor = colors.separator,
            legend = legend,
        )
        hourly = HourlyEntry(base, expanded, prepared)
        return prepared
    }

    fun daily(
        chart: DailyChart,
        colors: ChartColors,
        density: Density,
        layoutDirection: LayoutDirection,
        fontFamilyResolver: FontFamily.Resolver,
        images: ForecastChartImages,
    ): PreparedDailyChart {
        val key = DailyKey(chart, colors, density, density.density, density.fontScale, layoutDirection, fontFamilyResolver, images)
        daily?.let { (previous, prepared) -> if (previous == key) return prepared }

        dailyPrepares++
        val layout = DailyLayout(chart, density)
        val d = density.density
        val measurer = TextMeasurer(fontFamilyResolver, density, layoutDirection, cacheSize = PREPARE_MEASURER_CACHE)
        val preparedImages = images.prepare(colors, chart.chart)
        val labels = ArrayList<PreparedText>(chart.dayNames.size + chart.dates.size)
        fun addRow(texts: List<String>, size: androidx.compose.ui.unit.TextUnit, top: Double) {
            val style = chartTextStyle(colors.label, size)
            val y = ((top + 2) * d).toFloat()
            texts.forEachIndexed { i, text ->
                val result = measurer.measure(text, style, softWrap = false)
                val center = (i + 0.5) * chart.columnWidth
                labels += PreparedText(result, Offset((center * d).toFloat() - result.size.width / 2f, y))
            }
        }
        addRow(chart.dayNames, ChartStyle.smallTitle, 0.0)
        addRow(chart.dates, ChartStyle.title, layout.dateRowTop)
        val chartSvg = prepareSvg(chart.chart, layout.chartTop, preparedImages, colors, density, measurer)
        val prepared = PreparedDailyChart(layout, labels, chartSvg)
        daily = key to prepared
        return prepared
    }

    fun air(
        series: AirSeries,
        standard: AirStandard?,
        hour: String,
        width: Double,
        height: Double,
        colors: AirColors,
        density: Density,
        layoutDirection: LayoutDirection,
        fontFamilyResolver: FontFamily.Resolver,
    ): PreparedAirChart {
        val key = AirKey(
            data = series.data,
            maxValueBits = series.maxValue?.toBits(),
            standard = standard,
            hour = hour,
            widthBits = width.toBits(),
            heightBits = height.toBits(),
            colors = colors,
            density = density,
            densityValue = density.density,
            fontScale = density.fontScale,
            layoutDirection = layoutDirection,
            fontFamilyResolver = fontFamilyResolver,
        )
        air?.let { (previous, prepared) -> if (previous == key) return prepared }

        airPrepares++
        val chart = AirChart.build(series, standard, hour, width, height)
        val measurer = TextMeasurer(fontFamilyResolver, density, layoutDirection, cacheSize = PREPARE_MEASURER_CACHE)
        val prepared = prepareAirChart(chart, colors, density, measurer)
        air = key to prepared
        return prepared
    }

    companion object {
        // Temporary measurer cache used only within a single prepare call so repeated labels (e.g. "0%", "%") coalesce.
        private const val PREPARE_MEASURER_CACHE = 64
    }
}

@Composable
internal fun rememberPreparedChartCache(): PreparedChartCache =
    LocalPreparedCharts.current ?: remember { PreparedChartCache() }
