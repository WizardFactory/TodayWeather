package net.wizardfactory.todayweather.widget

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.ForecastText
import net.wizardfactory.todayweather.core.domain.YesterdayText

internal data class ForecastCell(val label: String, val value: String, val icon: String, val offset: Int? = null, val sky: String? = null)

private fun JsonObject?.text(name: String) = (this?.get(name) as? JsonPrimitive)
    ?.takeUnless { it is JsonNull }?.content?.takeIf { it.isNotBlank() }

private fun JsonObject?.temperature(name: String): String? = text(name)?.takeIf {
    val number = it.toDoubleOrNull()
    number != null && number.isFinite() && number != -50.0 && number != -100.0
}

private fun JsonObject.icon() = text("skyIcon")?.let { if (it == "moon") "☾" else ForecastText.weatherEmoji(it) }.orEmpty()

/** The same converted, unit-adjusted WeatherEntry as the app. No independent weather API or timezone conversion. */
internal class WidgetReadings(weather: JsonObject, unit: String?, labels: YesterdayText) {
    private val observation = weather["currentWeather"] as? JsonObject
    private val yesterday = observation?.get("yesterday") as? JsonObject
    private val temp = observation.temperature("t1h")
    val sky = observation.text("skyIcon")
    val condition = observation.text("weather").orEmpty()
    val degrees = temp?.let { "$it°" + unit.orEmpty() }.orEmpty()
    val current = listOfNotNull(observation?.icon()?.ifEmpty { null }, temp?.let { "$it°" + unit.orEmpty() }).joinToString(" ")
    val compact = observation?.icon().orEmpty() + temp?.let { "$it°" }.orEmpty()
    val comparison = if (unit != null && temp != null && yesterday.temperature("t1h") != null && yesterday.text("comparisonAvailable") != "false")
        ForecastText.diffTodayYesterday(observation?.get("t1h"), yesterday, unit == "F", labels) else ""

    private val air = ((weather["airInfo"] as? JsonObject)?.get("last") as? JsonObject)
        ?: (((weather["airInfoList"] as? JsonArray)?.firstOrNull() as? JsonObject)?.get("last") as? JsonObject)
        ?: observation?.get("arpltn") as? JsonObject
    val airLevel = air.text("aqiGrade")?.toIntOrNull()
    val airName = air.text("aqiStr")
    val airIndex = air.text("aqiValue")?.takeIf { (it.toDoubleOrNull() ?: -1.0) >= 0 }
    val airGrade = listOfNotNull(airName, airIndex?.let { "AQI $it" }).joinToString(" · ")
    val airSummary = observation.text("summaryAir") ?: air.text("aqiActionGuide")
    fun pollutant(code: String) = air.text("${code}Value")?.takeIf { (it.toDoubleOrNull() ?: -1.0) >= 0 }
        ?.let { "$it ${AirQuality.codeUnit(code)}" }

    private val dailyRows = ((weather["dayChart"] as? JsonArray)?.firstOrNull() as? JsonObject)?.get("values") as? JsonArray
    val days = dailyRows.orEmpty().filterIsInstance<JsonObject>().mapNotNull { row ->
        val offset = row.text("fromToday")?.toIntOrNull() ?: return@mapNotNull null
        if (offset < -1) return@mapNotNull null
        val date = row.text("date").orEmpty()
        val label = if (date.length == 8) date.substring(4,6) + "/" + date.takeLast(2) else date
        ForecastCell(label, range(row), row.icon(), offset, row.text("skyIcon"))
    }

    private fun range(row: JsonObject) =
        listOf(row.temperature("tmn") ?: "–", row.temperature("tmx") ?: "–").joinToString(" / ") + "°"

    private val timeTable = (weather["timeTable"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
    private val hourSeries = (weather["timeChart"] as? JsonArray)?.getOrNull(1) as? JsonObject
    private val index = hourSeries.text("currentIndex")?.toIntOrNull()
    private val futureRows = if (index != null && index in timeTable.indices) timeTable.drop(index + 1)
    else timeTable.filter { row ->
        val day = row.text("date") ?: return@filter false
        val currentDay = observation.text("date") ?: return@filter false
        day > currentDay || (day == currentDay && (row.text("time")?.toIntOrNull() ?: -1) > (observation.text("time")?.toIntOrNull() ?: 24))
    }
    val hours = futureRows.take(5).mapNotNull { row ->
        val hour = row.text("time")?.toIntOrNull() ?: return@mapNotNull null
        ForecastCell((hour % 24).toString().padStart(2,'0') + ":00", row.temperature("t3h")?.let { "$it°" } ?: "–", row.icon(), sky = row.text("skyIcon"))
    }
}
