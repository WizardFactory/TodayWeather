package net.wizardfactory.todayweather.core.domain

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** One grade band of an air standard: its color, translation key and upper bound per pollutant. */
data class AirGrade(val color: String, val str: String, val upperBound: Map<String, Double>)

/** An air standard as `setAirUnit` builds it in TabCtrl, plus the chart maxima. */
data class AirStandard(val grades: List<AirGrade>, val maxValue: Map<String, Double>)

/**
 * Air quality display rules of the Cordova app: `WeatherUtil.aqiStandard`, TabCtrl's `setAirUnit`,
 * `grade2Color`, `airkoreaGrade2Color`, `getSentimentIcon`, and AirCtrl's gauge label and pollutant list.
 * Grades themselves come from the server. [dustForecast] and [hourlyForecast] port AirCtrl helpers that no
 * template calls (S05 uses the pollutant's own series, `AirScope`); the corpus pins them.
 */
object AirQuality {
    val POLLUTANTS = listOf("aqi", "pm25", "pm10", "o3", "no2", "co", "so2")
    private val CODES = listOf("pm25", "pm10", "o3", "no2", "co", "so2", "aqi")

    private class Std(val colors: List<String>, val strs: List<String>, val values: Map<String, List<Double>>, val max: Map<String, Double>)

    private val KOREA = listOf("#32a1ff", "#00c73c", "#fd9b5a", "#ff5959") to
        listOf("LOC_GOOD", "LOC_MODERATE", "LOC_UNHEALTHY", "LOC_VERY_UNHEALTHY")
    private val SIX = listOf("#00c73c", "#d2d211", "#ff6f00", "#FF0000", "#b4004b", "#940021") to
        listOf("LOC_GOOD", "LOC_MODERATE", "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS", "LOC_UNHEALTHY", "LOC_VERY_UNHEALTHY", "LOC_HAZARDOUS")

    private fun v(vararg pairs: Pair<String, List<Double>>) = pairs.toMap()
    private fun l(vararg d: Double) = d.toList()

    // Values copied from client/www/js/service.weatherutil.js (aqiStandard), including anomaly A17
    // (airnow so2 grade-2 bound 0.75).
    private val STANDARDS = mapOf(
        "airkorea" to Std(KOREA.first, KOREA.second, v(
            "pm25" to l(0.0, 15.0, 35.0, 75.0, 500.0), "pm10" to l(0.0, 30.0, 80.0, 150.0, 600.0),
            "o3" to l(0.0, 0.03, 0.09, 0.15, 0.6), "no2" to l(0.0, 0.03, 0.06, 0.2, 2.0),
            "co" to l(0.0, 2.0, 9.0, 15.0, 50.0), "so2" to l(0.0, 0.02, 0.05, 0.15, 1.0), "aqi" to l(0.0, 50.0, 100.0, 250.0, 500.0)),
            mapOf("pm25" to 100.0, "pm10" to 150.0, "o3" to 0.15, "no2" to 0.2, "co" to 9.0, "so2" to 0.05, "aqi" to 250.0)),
        "airkorea_who" to Std(KOREA.first, KOREA.second, v(
            "pm25" to l(0.0, 15.0, 25.0, 50.0, 500.0), "pm10" to l(0.0, 30.0, 50.0, 100.0, 600.0),
            "o3" to l(0.0, 0.03, 0.09, 0.15, 0.6), "no2" to l(0.0, 0.03, 0.06, 0.2, 2.0),
            "co" to l(0.0, 2.0, 9.0, 15.0, 50.0), "so2" to l(0.0, 0.02, 0.05, 0.15, 1.0), "aqi" to l(0.0, 50.0, 100.0, 250.0, 500.0)),
            mapOf("pm25" to 100.0, "pm10" to 150.0, "o3" to 0.15, "no2" to 0.2, "co" to 9.0, "so2" to 0.05, "aqi" to 250.0)),
        "airnow" to Std(SIX.first, SIX.second, v(
            "pm25" to l(0.0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4), "pm10" to l(0.0, 54.0, 154.0, 254.0, 354.0, 424.0, 604.0),
            "o3" to l(0.0, 0.054, 0.124, 0.164, 0.204, 0.404, 0.604), "no2" to l(0.0, 0.053, 0.1, 0.36, 0.649, 1.249, 2.049),
            "co" to l(0.0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4), "so2" to l(0.0, 0.035, 0.75, 0.185, 0.304, 0.604, 1.004),
            "aqi" to l(0.0, 50.0, 100.0, 150.0, 200.0, 300.0, 500.0)),
            mapOf("pm25" to 100.0, "pm10" to 150.0, "o3" to 0.164, "no2" to 0.36, "co" to 12.4, "so2" to 0.185, "aqi" to 200.0)),
        "aqicn" to Std(SIX.first, SIX.second, v(
            "pm25" to l(0.0, 35.0, 75.0, 115.0, 150.0, 250.0, 500.0), "pm10" to l(0.0, 50.0, 150.0, 250.0, 350.0, 420.0, 600.0),
            "o3" to l(0.0, 0.075, 0.093, 0.14, 0.187, 0.374, 0.56), "no2" to l(0.0, 0.049, 0.097, 0.341, 0.584, 1.14, 1.87),
            "co" to l(0.0, 4.0, 8.0, 28.0, 48.0, 72.0, 120.0), "so2" to l(0.0, 0.052, 0.175, 0.227, 0.28, 0.56, 0.916),
            "aqi" to l(0.0, 50.0, 100.0, 150.0, 200.0, 300.0, 500.0)),
            mapOf("pm25" to 100.0, "pm10" to 150.0, "o3" to 0.14, "no2" to 0.341, "co" to 28.0, "so2" to 0.227, "aqi" to 200.0)),
    )

    /** `setAirUnit`: null for an unknown or missing standard (the Cordova code then leaves the scope unset). */
    fun standard(airUnit: String?): AirStandard? {
        val std = STANDARDS[airUnit] ?: return null
        return AirStandard(std.colors.indices.map { i ->
            AirGrade(std.colors[i], std.strs[i], CODES.associateWith { std.values.getValue(it)[i + 1] })
        }, std.max)
    }

    /** `$scope.grade2Color(grade, defaultColor)`. [grade] null means undefined. */
    fun gradeColor(standard: AirStandard?, grade: JsonElement?, defaultColor: String?): String {
        val color = defaultColor ?: ""
        if (standard == null || grade == null || grade == JsonNull) return color
        var g = Js.number(grade)
        if (g > standard.grades.size) g = standard.grades.size.toDouble()
        val i = g - 1
        return if (i >= 0 && i == kotlin.math.floor(i) && i < standard.grades.size) standard.grades[i.toInt()].color else color
    }

    /** `$scope.airkoreaGrade2Color(grade)`; null where the Cordova code yields undefined. */
    fun airkoreaGradeColor(grade: JsonElement?): String? {
        val colors = KOREA.first
        var g = Js.number(grade)
        if (g > colors.size) g = colors.size.toDouble()
        val i = g - 1
        return if (i >= 0 && i == kotlin.math.floor(i) && i < colors.size) colors[i.toInt()] else null
    }

    /** `$scope.getSentimentIcon(grade)`: Material icon code points as HTML entities. Strict equality on numbers. */
    fun sentimentIcon(airUnit: String?, grade: JsonElement?): String {
        val g = (grade as? JsonPrimitive)?.takeIf { !it.isString && it != JsonNull }?.let { Js.number(it) }
        val korean = airUnit == "airkorea" || airUnit == "airkorea_who"
        val icons = if (korean) {
            mapOf(1.0 to "&#xE815;", 2.0 to "&#xE812;", 3.0 to "&#xE811;", 4.0 to "&#xE814;")
        } else {
            mapOf(1.0 to "&#xE815;", 2.0 to "&#xE812;", 3.0 to "&#xE811;", 4.0 to "&#xE811;", 5.0 to "&#xE7F3;", 6.0 to "&#xE814;")
        }
        return icons[g] ?: "&#xE814;"
    }

    /**
     * `$scope.getLabelPosition(grade, val)`: x of the value label over the grade bands of the gauge,
     * [width] wide, with a label [labelWidth] wide. 0 where the Cordova code catches an error.
     */
    fun labelPosition(standard: AirStandard?, code: String, grade: Int, value: Double, width: Double, labelWidth: Double = 52.0): Double {
        if (standard == null || grade < 1 || grade > standard.grades.size) return 0.0
        val gradeW = width / standard.grades.size + 2
        val start = if (grade >= 2) standard.grades[grade - 2].upperBound[code] ?: return 0.0 else 0.0
        val end = standard.grades[grade - 1].upperBound[code] ?: return 0.0
        val diff = (value - start) / (end - start)
        var x = gradeW * (grade - 1) + diff * gradeW
        x -= labelWidth / 2
        if (x < 0) x = 0.0
        if (x > width - labelWidth) x = width - labelWidth
        return x
    }

    /** `$scope.getAirCodeUnit(code)`. */
    fun codeUnit(code: String): String = when (code) {
        "pm25", "pm10" -> "㎍/㎥"
        "o3", "no2", "co", "so2" -> "ppm"
        else -> ""
    }

    /** `_getAQIname`. */
    fun codeName(code: String): String = when (code) {
        "pm25" -> "LOC_PM25"; "pm10" -> "LOC_PM10"; "o3" -> "LOC_O3"; "no2" -> "LOC_NO2"
        "co" -> "LOC_CO"; "so2" -> "LOC_SO2"; "aqi" -> "LOC_AQI"; else -> ""
    }

    /** `_getAQIList(airInfo, pollutants)`: the pollutant cards, "-" for a pollutant with no current value. */
    fun pollutantList(last: JsonObject, pollutants: JsonObject?): JsonArray = JsonArray(POLLUTANTS.mapNotNull { code ->
        when {
            "${code}Value" in last -> buildJsonObject {
                put("name", JsonPrimitive(codeName(code)))
                put("value", last["${code}Value"]!!)
                last["${code}Grade"]?.let { put("grade", it) }
                last["${code}Str"]?.let { put("str", it) }
                put("code", JsonPrimitive(code))
            }
            pollutants != null && code in pollutants -> buildJsonObject {
                put("name", JsonPrimitive(codeName(code)))
                put("code", JsonPrimitive(code))
                put("value", JsonPrimitive("-"))
            }
            else -> null
        }
    })

    /** `_getDustForecast(days)` for the selected pollutant [code]; null where the Cordova code fails. */
    fun dustForecast(days: JsonElement?, code: String): JsonArray? {
        val list = days as? JsonArray ?: return null
        if (list.any { it == JsonNull }) return null
        val out = list.mapNotNull { day ->
            val d = day as? JsonObject ?: return@mapNotNull null
            if (!Js.greaterOrEqual(d["fromToday"], 0.0) || "dustForecast" !in d) return@mapNotNull null
            var obj: JsonObject = d
            val forecast = d["dustForecast"] as? JsonObject
            forecast?.forEach { (key, value) ->
                if (code in key) {
                    if ("Grade" in key) obj = JsonObject(obj + ("grade" to value))
                    else if ("Str" in key) obj = JsonObject(obj + ("str" to value))
                }
            }
            obj.takeIf { "grade" in it }
        }
        return JsonArray(out)
    }

    /** `_getHourlyForecast(current, hourlyList)`: rows after [current], each with its hour as `time`. */
    fun hourlyForecast(current: String, hourly: JsonElement?): JsonArray? {
        val list = hourly as? JsonArray ?: return null
        if (list.any { it == JsonNull }) return null
        return JsonArray(list.filter { row ->
            val date = (row as? JsonObject)?.get("date")
            date is JsonPrimitive && date.isString && date.content > current
        }.map { row ->
            val o = row as JsonObject
            val date = (o["date"] as JsonPrimitive).content
            val hour = date.substring(minOf(11, date.length), minOf(13, date.length)).let { s ->
                Regex("^\\s*[+-]?\\d+").find(s)?.value?.trim()?.toIntOrNull()
            }
            JsonObject(o + ("time" to (hour?.let { JsonPrimitive(it) } ?: JsonNull)))
        })
    }
}
