package net.wizardfactory.todayweather.core.domain.forecast

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.domain.ForecastText
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.UpdateTime
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics

/** The two pages of ForecastCtrl: S03 (`"short"`, /tab/forecast) and S04 (`"mid"`, /tab/dailyforecast). */
enum class ForecastType { SHORT, MID }

/**
 * The scope of ForecastCtrl (controller.forecastctrl.js) for one visit of a weather page: `init` when the page opens,
 * then `applyWeatherData` for each place the visit shows, in order. The pages are not cached (`cache: false`), so a
 * visit starts afresh. A Kotlin null stands for an unset value (undefined) and [JsonNull] for null, as in [Js].
 *
 * Values an apply does not reach keep what an earlier place set, as on the Cordova page: `applyWeatherData` returns
 * early for a place without a daily chart, stops at the first error (a place without current weather keeps the
 * previous summary and lists), and assigns `source` only when the place has one. [ForecastPage] renders the scope.
 */
class ForecastScope(
    val type: ForecastType,
    val metrics: ChartMetrics,
    private val fahrenheit: Boolean,
    private val photoTheme: Boolean,
    private val yesterday: YesterdayText,
    expandShortChart: Boolean?,
) {
    /** `expand`: the hourly chart's detail rows (`expandShortChart`, default false). */
    var expand: Boolean = expandShortChart ?: false

    /** `cityCount`: the enabled places when the page opened (the arrows show above one). */
    var cityCount: Int? = null; private set
    var hasPush: Boolean? = null; private set
    var currentPosition: JsonElement? = null; private set
    var address: JsonElement? = null; private set
    var source: JsonElement? = null; private set
    var photo: JsonElement? = null; private set
    var timeWidth: Double? = null; private set
    var dayWidth: Double? = null; private set
    var currentWeather: JsonElement? = null; private set
    var hourlyAqiForecast: JsonArray? = null; private set
    var dailyAqiForecast: JsonElement? = null; private set
    var airForecastPubdate: JsonElement? = null; private set
    var airForecastSource: JsonElement? = null; private set
    var updateTime: String? = null; private set
    var chartShortHeight: Double? = null; private set
    var chartShortDetailHeight: Double? = null; private set
    var chartMidHeight: Double? = null; private set
    var showDetailWeather: Boolean = false; private set
    var summary: JsonElement? = null; private set

    /** Null when deleted: `delete $scope.summaryAir` for a place without one. */
    var summaryAir: JsonElement? = null; private set
    var diffTempStr: String? = null; private set
    var timeTable: JsonElement? = null; private set
    var timeChart: JsonElement? = null; private set
    var dayChart: JsonElement? = null; private set

    /**
     * The place the charts draw: the chart arrays with the current weather of the apply that assigned them, since the
     * chart directives redraw when their arrays change.
     */
    var chartPlace: JsonObject? = null; private set

    /** `init`: false when no place is enabled (Cordova opens the start popup instead). */
    fun open(city: JsonObject?, enabledCount: Int, hasPush: Boolean): Boolean {
        if (enabledCount == 0) return false
        cityCount = enabledCount
        apply(city, hasPush)
        return true
    }

    /** `applyWeatherData` for the selected place's record ([city] null: no place at the selected index). */
    fun apply(city: JsonObject?, hasPush: Boolean) {
        if (city == null || city["address"] == JsonNull) return
        val dayCharts = city["dayChart"] as? JsonArray ?: return
        val firstDay = dayCharts.firstOrNull()
        if (firstDay == null || firstDay == JsonNull) return

        this.hasPush = hasPush
        currentPosition = city["currentPosition"]
        val name = city["name"]
        address = if (Js.truthy(name)) name else JsonPrimitive(AddressFormat.shorten((city["address"] as? JsonPrimitive)?.takeIf { it.isString }?.content))
        if (Js.truthy(city["source"])) source = city["source"]
        if (photoTheme) photo = city["photo"]

        val c = metrics.columnWidth
        timeWidth = c * (length(city["timeTable"]) ?: return)
        val dayTable = (firstDay as? JsonObject)?.get("values")
        val days = length(dayTable) ?: return
        dayWidth = if (c * days < metrics.bodyWidth) metrics.bodyWidth else c * days

        currentWeather = city["currentWeather"]
        hourlyAqiForecast = null
        dailyAqiForecast = null
        airForecastPubdate = null
        airForecastSource = null
        val airInfoList = city["airInfoList"]
        val airInfo = if (Js.truthy(airInfoList)) (airInfoList as? JsonArray)?.firstOrNull() else null
        val pollutants = (airInfo as? JsonObject)?.get("pollutants")
        val aqi = (pollutants as? JsonObject)?.get("aqi")
        if (Js.truthy(airInfo) && Js.truthy(pollutants) && Js.truthy(aqi)) {
            airInfo as JsonObject
            airForecastPubdate = airInfo["forecastPubDate"]
            airForecastSource = airInfo["forecastSource"]
            val latest = airInfo["last"].takeIf { Js.truthy(it) }
                ?: if (isObject(currentWeather)) (currentWeather as? JsonObject)?.get("arpltn") else return
            val hourly = (aqi as? JsonObject)?.get("hourly")
            if (Js.truthy(hourly)) {
                val rows = hourly as? JsonArray ?: return
                val kept = ArrayList<JsonElement>()
                for (row in rows) {
                    if (row == JsonNull) return
                    if (!isObject(latest)) return
                    val dataTime = (latest as? JsonObject)?.get("dataTime")
                    if (Js.greaterOrEqual((row as? JsonObject)?.get("date"), dataTime)) kept += row
                }
                hourlyAqiForecast = JsonArray(kept.take(4))
            }
            val daily = (aqi as? JsonObject)?.get("daily")
            if (Js.truthy(daily)) {
                dailyAqiForecast = if (metrics.bodyWidth < 360) JsonArray((daily as? JsonArray ?: return).take(4)) else daily
            }
        }
        updateTime = UpdateTime.of(currentWeather)

        if (type == ForecastType.SHORT) {
            val timeChart = city["timeChart"]
            if (!isObject(timeChart)) return
            val today = (timeChart as? JsonArray)?.getOrNull(1)
            if (!isObject(today)) return
            chartShortHeight = metrics.hourlyChartHeight(Js.number((today as? JsonObject)?.get("displayItemCount")))
            chartShortDetailHeight = metrics.detailChartHeight
        }
        if (type == ForecastType.MID) {
            chartMidHeight = metrics.dailyChartHeight(Js.number((firstDay as? JsonObject)?.get("displayItemCount")))
        }

        showDetailWeather = true
        if (!isObject(currentWeather)) return
        val cw = currentWeather as? JsonObject
        summary = if (Js.truthy(cw?.get("summaryWeather"))) cw?.get("summaryWeather") else cw?.get("summary")
        summaryAir = cw?.get("summaryAir")?.takeIf { Js.truthy(it) }
        diffTempStr = ForecastText.diffTodayYesterday(cw?.get("t1h"),
            cw?.get("yesterday")?.takeIf { Js.truthy(it) }?.let { it as? JsonObject ?: JsonObject(emptyMap()) }, fahrenheit, yesterday)
        if (type == ForecastType.SHORT) {
            timeTable = city["timeTable"]
            timeChart = city["timeChart"]
        }
        if (type == ForecastType.MID) dayChart = city["dayChart"]
        chartPlace = JsonObject(buildMap {
            timeTable?.let { put("timeTable", it) }
            timeChart?.let { put("timeChart", it) }
            dayChart?.let { put("dayChart", it) }
            cw?.let { put("currentWeather", it) }
        })
    }

    /** `getTemp(temp)`: "" without a value, rounded in °F, otherwise the value as it came. */
    fun temp(value: JsonElement?): String = when {
        value == null || value == JsonNull -> ""
        fahrenheit -> Js.numberToString(Js.round(Js.number(value)))
        else -> Js.display(value)
    }

    /** `showHourlyAqiForecast()`: more than one row. */
    fun showHourlyAqiForecast(): Boolean = (hourlyAqiForecast?.size ?: 0) > 1

    /** `hasDustForecast()` (S04): the daily AQI list, else today's row has a dust forecast. False where it throws. */
    fun hasDustForecast(): Boolean {
        if (Js.truthy(dailyAqiForecast)) return true
        val values = dayValues() ?: return false
        for (i in values.indices.reversed()) {
            val day = values[i]
            if (day == JsonNull) return false
            if (day is JsonObject && Js.looseEquals(day["fromToday"], 0.0)) return "dustForecast" in day
        }
        return false
    }

    /** `checkDailyDetailWeather(day)` (S04): yesterday, today and tomorrow. */
    fun checkDailyDetailWeather(day: JsonElement?): Boolean {
        val fromToday = (day as? JsonObject)?.get("fromToday")
        return Js.looseEquals(fromToday, -1.0) || Js.looseEquals(fromToday, 0.0) || Js.looseEquals(fromToday, 1.0)
    }

    /**
     * `hasPropertyInThreeDays(names)` (S04): any of [names] truthy in today's daily row (`currentWeather.today.index`)
     * or its neighbors. False where the Cordova expression throws.
     */
    fun hasPropertyInThreeDays(names: List<String>): Boolean {
        val today = ((currentWeather as? JsonObject)?.get("today") as? JsonObject) ?: return false
        if (!Js.truthy(currentWeather) || !Js.truthy(today)) return false
        val index = today["index"]
        if (!Js.present(index)) return false
        val charts = dayChart as? JsonArray ?: return false
        val first = charts.firstOrNull()
        if (first == null || first == JsonNull) return false
        val table = (first as? JsonObject)?.get("values")
        if (!Js.truthy(table)) return false
        val rows = table as? JsonArray ?: return false
        fun has(row: JsonElement?): Boolean? = when (row) {
            null, JsonNull -> null // obj[name] of undefined throws
            is JsonObject -> names.any { Js.truthy(row[it]) }
            else -> false
        }
        val i = Js.number(index)
        has(rows.at(i))?.let { if (it) return true } ?: return false
        if (i > 0) has(rows.at(i - 1))?.let { if (it) return true } ?: return false
        if (i < rows.size - 1) {
            // A string index concatenates ("7" + 1 is "71"), which finds no row.
            val next = if ((index as? JsonPrimitive)?.isString == true) null else rows.at(i + 1)
            has(next)?.let { if (it) return true } ?: return false
        }
        return false
    }

    private fun dayValues(): JsonArray? {
        val first = (dayChart as? JsonArray)?.firstOrNull() ?: return null
        if (first == JsonNull) return null
        return (first as? JsonObject)?.get("values") as? JsonArray
    }

    private fun JsonArray.at(i: Double): JsonElement? = if (i == kotlin.math.floor(i) && i >= 0 && i < size) this[i.toInt()] else null

    companion object {
        /** `x.length`: arrays and strings; null where reading it throws (undefined or null). */
        private fun length(value: JsonElement?): Double? = when (value) {
            null, JsonNull -> null
            is JsonArray -> value.size.toDouble()
            is JsonPrimitive -> if (value.isString) value.content.length.toDouble() else Double.NaN
            else -> Double.NaN
        }

        /** Whether reading a property of [value] works (anything but undefined and null). */
        private fun isObject(value: JsonElement?): Boolean = value != null && value != JsonNull
    }
}
