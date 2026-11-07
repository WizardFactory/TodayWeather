package net.wizardfactory.todayweather.core.domain

import kotlin.math.min
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** Initial horizontal scroll of the charts (`getTodayPosition` in controller.forecastctrl.js). */
object ChartPosition {
    const val TABLET_WIDTH = 640.0

    /** Column width of both charts: a seventh of the body, at most 60 dp. */
    fun columnWidth(bodyWidth: Double) = min(bodyWidth / 7, 60.0)

    /**
     * Offset in dp for [chartType] "short" (hourly: one column before the current hour) or "mid"
     * (daily: today in the third column) for a converted place weather [city].
     */
    fun todayOffset(chartType: String, bodyWidth: Double, city: JsonObject): Double {
        val colWidth = columnWidth(bodyWidth)
        var index = 0.0
        if (chartType == "short") {
            val timeChart = city["timeChart"] as? JsonArray ?: return 0.0
            if (timeChart.size <= 1) return 0.0
            // The Cordova code compares timeChart[1].length (undefined for an object) with the tablet width,
            // which is never true, so it always continues here.
            index = Js.number((timeChart[1] as? JsonObject)?.get("currentIndex"))
            index = if (index >= 1) index - 1 else 0.0
            return colWidth * index
        }
        if (chartType == "mid") {
            if (bodyWidth >= TABLET_WIDTH) return 0.0
            val dayChart = city["dayChart"] as? JsonArray
            val values = (dayChart?.getOrNull(0) as? JsonObject)?.get("values") as? JsonArray ?: return 0.0
            val today = (city["currentWeather"] as? JsonObject)?.get("today") as? JsonObject
            val todayIndex = today?.get("index")
            if (todayIndex != null && Js.present(todayIndex)) {
                index = Js.number(todayIndex)
            } else {
                for (i in values.indices.reversed()) {
                    if (Js.looseEquals((values[i] as? JsonObject)?.get("fromToday"), 0.0)) { index = i.toDouble(); break }
                }
            }
            index = if (index >= 2) index - 2 else 0.0
            return colWidth * index
        }
        return colWidth * index
    }
}
