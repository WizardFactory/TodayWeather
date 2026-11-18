package net.wizardfactory.todayweather.ui.forecast

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart

/** The shell retains the last prepared chart of each kind across forecast visits. */
internal class ForecastCharts {
    private data class Inputs(
        val weather: JsonObject,
        val width: Double,
        val height: Double,
        val texts: ChartTexts,
        val precipitationUnit: String,
        val windUnit: String? = null,
    )

    private var hourly: Pair<Inputs, HourlyChart>? = null
    private var daily: Pair<Inputs, DailyChart>? = null

    fun hourly(
        weather: JsonObject?, metrics: ChartMetrics, texts: ChartTexts, precipitationUnit: String, windUnit: String,
    ): HourlyChart? {
        if (weather == null || ((weather["timeChart"] as? JsonArray)?.size ?: 0) < 2) return null
        val inputs = Inputs(weather, metrics.bodyWidth, metrics.bodyHeight, texts, precipitationUnit, windUnit)
        hourly?.let { (previous, chart) -> if (inputs == previous) return chart }
        val chart = HourlyChart.build(weather, metrics, texts, precipitationUnit, windUnit)
        hourly = inputs to chart
        return chart
    }

    fun daily(weather: JsonObject?, metrics: ChartMetrics, texts: ChartTexts, precipitationUnit: String): DailyChart? {
        if (weather == null || (weather["dayChart"] as? JsonArray)?.isNotEmpty() != true) return null
        val inputs = Inputs(weather, metrics.bodyWidth, metrics.bodyHeight, texts, precipitationUnit)
        daily?.let { (previous, chart) -> if (inputs == previous) return chart }
        val chart = DailyChart.build(weather, metrics, texts, precipitationUnit)
        daily = inputs to chart
        return chart
    }
}
