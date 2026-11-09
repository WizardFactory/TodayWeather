package net.wizardfactory.todayweather.core.domain.air

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics

/**
 * `airChart` of S05: the 24 slots of the selected pollutant's hourly series (12 before the current hour, the current
 * one, 11 after it; a slot the series lacks has only a date) and the standard's chart maximum for it (null when the
 * standard has none). A slot is a row of the series as it came; null is a slot the apply did not reach.
 */
class AirSeries(val data: List<JsonElement?>, val maxValue: Double?)

/**
 * The scope of AirCtrl (controller.air.js) for one visit of S05 (/tab/air, `cache: false`): [open] is `init` with the
 * pollutant of the link, [apply] `_applyWeatherData` for the selected place's record, [setCode] and [setStation] the
 * taps on a detail or station cell, and [applyEvent] TabCtrl's `applyEvent` (a swipe or a load), which returns to the
 * first station. [airUnit] is the air standard (TabCtrl's `setAirUnit`); [zone] the device's time zone, in which a
 * missing chart slot is dated (java.util time, available on API 24).
 *
 * `_applyWeatherData` runs in one `try`: at the first value it cannot read it stops, and everything it has not
 * reached keeps what an earlier place set, as on the Cordova page. A Kotlin null stands for an unset value
 * (undefined) and [JsonNull] for null, as in [Js].
 */
class AirScope(val metrics: ChartMetrics, val airUnit: String?, private val zone: TimeZone = TimeZone.getDefault()) {
    /** TabCtrl's `aqiStandard` and `aqiMaxValue`; null for an unknown standard. */
    val standard: AirStandard? = AirQuality.standard(airUnit)

    /** The selected pollutant (`aqiCode`); null when the fallback of a missing value found none. */
    var aqiCode: String? = null; private set
    var airCodeName: String? = null; private set
    var mainName: String? = null; private set
    var stnIndex: Int = 0; private set

    var address: JsonElement? = null; private set
    var currentPosition: JsonElement? = null; private set
    var hasPush: Boolean? = null; private set
    var cityCount: Int? = null; private set

    /** The shown observation (`airInfo`): the station's `last`, or the place's `currentWeather.arpltn`. */
    var airInfo: JsonElement? = null; private set
    var currentWeather: JsonElement? = null; private set
    var airCodeGrade: JsonElement? = null; private set
    var airCodeValue: JsonElement? = null; private set
    var airCodeStr: JsonElement? = null; private set
    var mainInfo: JsonElement? = null; private set
    var airCodeActionGuide: JsonElement? = null; private set
    var forecastPubdate: JsonElement? = null; private set
    var forecastSource: JsonElement? = null; private set

    /** The detail cells (`_getAQIList`). */
    var aqiList: JsonArray? = null; private set

    /** The station cells: each station's name, and its grade, value (`-` when falsy) and grade text for the pollutant. */
    var stnList: List<JsonObject>? = null; private set
    var dayForecast: JsonArray? = null; private set
    var airChart: AirSeries? = null; private set
    var hourlyChartTitle: String? = null; private set
    var chartAirHeight: Double? = null; private set

    /** `$ionicScrollDelegate.scrollTop()` calls: a cell tap brings the page to the top. */
    var scrolls: Int = 0; private set

    private class Place(val city: JsonObject?, val enabledCount: Int, val hasPush: Boolean)

    private var place: Place? = null

    /** `init`: the pollutant of the link (`?code=`), else the overall index; false when no place is enabled. */
    fun open(city: JsonObject?, code: String?, enabledCount: Int, hasPush: Boolean): Boolean {
        setMainAqiCode(if (code.isNullOrEmpty()) "aqi" else code)
        place = Place(city, enabledCount, hasPush)
        if (enabledCount == 0) return false
        applyWeatherData()
        return true
    }

    /** `_applyWeatherData` for the selected place's record ([city] null: no place at the selected index). */
    fun apply(city: JsonObject?, enabledCount: Int, hasPush: Boolean) {
        place = Place(city, enabledCount, hasPush)
        applyWeatherData()
    }

    /** `applyEvent`: back to the first station, then the apply. */
    fun applyEvent(city: JsonObject?, enabledCount: Int, hasPush: Boolean) {
        stnIndex = 0
        apply(city, enabledCount, hasPush)
    }

    /** `setMainAqiCode(code)`: a detail cell's pollutant, applied to the place last applied; the page goes to the top. */
    fun setCode(code: String?) {
        setMainAqiCode(code)
        applyWeatherData()
        scrolls++
    }

    /** `setStation(index)`: a station cell, applied to the place last applied; the page goes to the top. */
    fun setStation(index: Int) {
        stnIndex = index
        applyWeatherData()
        scrolls++
    }

    private fun setMainAqiCode(code: String?) {
        aqiCode = code
        airCodeName = AirQuality.codeName(code ?: "undefined")
        mainName = if (code == "aqi") "LOC_AIR_STATUS" else airCodeName
    }

    private fun applyWeatherData() {
        val p = place ?: return
        try {
            applyOrStop(p.city, p.enabledCount, p.hasPush)
        } catch (_: Stopped) {
            // `trackException`: the values not reached keep what an earlier apply set.
        }
    }

    private fun applyOrStop(city: JsonObject?, enabledCount: Int, hasPush: Boolean) {
        val cityData = city ?: stop()
        val name = cityData["name"]
        address = if (Js.truthy(name)) name else JsonPrimitive(AddressFormat.shorten((cityData["address"] as? JsonPrimitive)?.takeIf { it.isString }?.content))

        val list = cityData["airInfoList"]
        val station: JsonElement? = when {
            Js.truthy(list) -> member(list, stnIndex)
            Js.truthy(cityData["airInfo"]) -> cityData["airInfo"]
            else -> JsonObject(emptyMap())
        }
        val stationLast = prop(station, "last")
        val latest = if (Js.truthy(stationLast)) stationLast else prop(prop(cityData, "currentWeather"), "arpltn")
        val code = aqiCode
        if (hasOwn(latest, key(code, "Value")) && !Js.present(prop(latest, key(code, "Value"))) &&
            hasOwn(station, "pollutants") && !Js.present(prop(prop(station, "pollutants"), code ?: "undefined"))
        ) {
            // Skips a pollutant without a value: the first with one, the overall index last.
            setMainAqiCode(FALLBACK.firstOrNull { p ->
                Js.present(prop(latest, "${p}Value")) || Js.present(prop(prop(station, "pollutants"), code ?: "undefined"))
            })
        }
        val selected = aqiCode

        currentWeather = cityData["currentWeather"]
        this.hasPush = hasPush
        currentPosition = cityData["currentPosition"]
        airInfo = latest
        airCodeGrade = prop(latest, key(selected, "Grade"))
        val value = prop(latest, key(selected, "Value"))
        airCodeValue = if (Js.present(value)) value else JsonPrimitive("-")
        airCodeStr = prop(latest, key(selected, "Str"))
        if (selected == "aqi") {
            mainInfo = if (Js.truthy(airCodeStr)) airCodeStr else JsonPrimitive("-")
            airCodeStr = JsonPrimitive("")
        } else {
            mainInfo = airCodeValue
        }
        airCodeActionGuide = prop(latest, key(selected, "ActionGuide"))
        cityCount = enabledCount

        stnList = null
        dayForecast = null
        airChart = null

        if ("airInfo" in cityData || "airInfoList" in cityData) {
            forecastPubdate = prop(station, "forecastPubDate")
            forecastSource = prop(station, "forecastSource")
            aqiList = AirQuality.pollutantList(latest as? JsonObject ?: JsonObject(emptyMap()), prop(station, "pollutants") as? JsonObject)
            if (hasOwn(station, "pollutants")) {
                val pollutant = prop(prop(station, "pollutants"), selected ?: "undefined")
                if (Js.truthy(pollutant)) series(pollutant!!, latest, selected)
            }
            if ("airInfoList" in cityData) {
                val stations = cityData["airInfoList"] as? JsonArray ?: stop()
                stnList = stations.map { s ->
                    val last = prop(s, "last")
                    buildJsonObject {
                        prop(last, "stationName")?.let { put("stationName", it) }
                        prop(last, key(selected, "Grade"))?.let { put("grade", it) }
                        put("value", prop(last, key(selected, "Value")).takeIf { Js.truthy(it) } ?: JsonPrimitive("-"))
                        prop(last, key(selected, "Str"))?.let { put("str", it) }
                    }
                }
            }
        } else {
            aqiList = AirQuality.pollutantList(latest as? JsonObject ?: JsonObject(emptyMap()), null)
        }
        chartAirHeight = 100.0
    }

    /** The hourly series of the selected [pollutant], its title and its daily rows (cut to four below 360 dp). */
    private fun series(pollutant: JsonElement, latest: JsonElement?, code: String?) {
        val rows = prop(pollutant, "hourly") as? JsonArray ?: stop()
        var index = -1
        for ((i, row) in rows.withIndex()) {
            if (Js.greaterOrEqual(prop(row, "date"), prop(latest, "dataTime"))) {
                index = i
                break
            }
        }
        hourlyChartTitle = if (index == rows.size - 1) "LOC_HOURLY_AQI_INFORMATION" else "LOC_HOURLY_AQI_FORECAST"
        val std = standard ?: stop()
        val slots = MutableList<JsonElement?>(24) { null }
        airChart = AirSeries(slots, std.maxValue[code])
        for (i in 0 until 24) {
            val row = rows.getOrNull(index - 12 + i)
            slots[i] = if (Js.present(row)) row else {
                val date = prop(rows.getOrNull(index), "date") as? JsonPrimitive
                if (date == null || !date.isString) stop()
                buildJsonObject { put("date", JsonPrimitive(slotDate(date.content, i))) }
            }
        }
        val daily = prop(pollutant, "daily")
        if (daily is JsonArray) dayForecast = if (metrics.bodyWidth < 360) JsonArray(daily.take(4)) else daily
    }

    /**
     * `new Date(date.replace(/\s+/g, 'T'))` moved by `setHours(getHours() - 12 + i)` in the device's zone and printed
     * as `YYYY-MM-DD HH:mm`: V8's date reading ([Warnings.jsDate]) and local wall-clock arithmetic, a time a
     * daylight-saving change skips moving forward.
     */
    private fun slotDate(date: String, i: Int): String {
        val millis = Warnings.jsDate(JsonPrimitive(date.replace(WHITE_SPACE, "T")), zone) ?: return "NaN-aN-aN aN:aN"
        val t = Calendar.getInstance(zone).apply {
            isLenient = true
            timeInMillis = millis
            set(Calendar.HOUR_OF_DAY, get(Calendar.HOUR_OF_DAY) - 12 + i)
        }
        fun pad(n: Int) = "0$n".takeLast(2)
        return "${t.get(Calendar.YEAR)}-${pad(t.get(Calendar.MONTH) + 1)}-${pad(t.get(Calendar.DAY_OF_MONTH))} " +
            "${pad(t.get(Calendar.HOUR_OF_DAY))}:${pad(t.get(Calendar.MINUTE))}"
    }

    private class Stopped : RuntimeException() {
        override fun fillInStackTrace(): Throwable = this
    }

    companion object {
        private val FALLBACK = listOf("pm25", "pm10", "o3", "no2", "co", "so2", "aqi")
        private val WHITE_SPACE = Regex("\\s+")

        private fun stop(): Nothing = throw Stopped()

        /** `aqiCode + suffix`: an unset code reads `undefined…`. */
        private fun key(code: String?, suffix: String) = "${code ?: "undefined"}$suffix"

        /** `value[key]`: undefined for a primitive; reading from undefined or null stops the apply. */
        private fun prop(value: JsonElement?, key: String): JsonElement? = when (value) {
            null, JsonNull -> stop()
            is JsonObject -> value[key]
            is JsonArray -> key.toIntOrNull()?.let { value.getOrNull(it) }
            is JsonPrimitive -> if (value.isString) key.toIntOrNull()?.let { i -> value.content.getOrNull(i)?.let { JsonPrimitive(it.toString()) } } else null
        }

        /** `list[index]` of a truthy value. */
        private fun member(list: JsonElement?, index: Int): JsonElement? = prop(list, index.toString())

        /** `value.hasOwnProperty(key)`; stops for undefined and null. */
        private fun hasOwn(value: JsonElement?, key: String): Boolean = when (value) {
            null, JsonNull -> stop()
            is JsonObject -> key in value
            is JsonArray -> key == "length" || key.toIntOrNull()?.let { it in value.indices } == true
            is JsonPrimitive -> value.isString && (key == "length" || key.toIntOrNull()?.let { it in value.content.indices } == true)
        }
    }
}
