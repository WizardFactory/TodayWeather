package net.wizardfactory.todayweather.core.domain.air

import java.io.File
import java.util.TimeZone
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.CorpusPlaces
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics

/**
 * AirScope against the scope of the Cordova AirCtrl (corpus/air.json `visits`, tools/corpus/generate.mjs): each visit
 * opens S05 with its code on its place, then taps cells and applies places as the page does; every value the template
 * reads must match after each step, including the values an apply leaves from an earlier place, the grade colors and
 * faces of every cell and the 24 slots of the hourly series.
 */
class AirScopeTest {
    private val corpus = File(javaClass.getResource("/corpus/air.json")!!.toURI()).parentFile
    private val golden = Json.parseToJsonElement(File(corpus, "air.json").readText()).jsonObject

    @Test
    fun visitsMatchAirCtrl() {
        val visits = golden["visits"]!!.jsonArray.map { it.jsonObject }
        assertEquals(32, visits.size)
        var steps = 0
        for (visit in visits) {
            val name = visit.str("name")!!
            val places = visit["places"]!!.jsonArray.map { it.jsonObject }
            val records = places.map { CorpusPlaces.record(corpus, it) }
            val airUnit = visit["units"]!!.jsonObject.str("airUnit")
            val scope = AirScope(ChartMetrics(visit["width"]!!.jsonPrimitive.double, visit["height"]!!.jsonPrimitive.double), airUnit,
                TimeZone.getTimeZone(visit.str("zone")!!))
            val hasPush = { i: Int -> places.getOrNull(i)?.get("hasPush")?.jsonPrimitive?.boolean == true }
            var index = visit["index"]!!.jsonPrimitive.int
            val applied = visit["applied"]!!.jsonArray.map { it.jsonObject }
            val opened = scope.open(records.getOrNull(index), visit.str("code"), records.size, hasPush(index))
            assertEquals(records.isNotEmpty(), opened, "$name: opened")
            check(applied[0], scope, records, "$name open")
            visit["actions"]!!.jsonArray.forEachIndexed { i, a ->
                val (action, arg) = a.jsonArray.let { it[0].jsonPrimitive.content to it[1].jsonPrimitive }
                when (action) {
                    "apply" -> {
                        index = arg.int
                        scope.applyEvent(records.getOrNull(index), records.size, hasPush(index))
                    }
                    "code" -> scope.setCode(arg.content)
                    "station" -> scope.setStation(arg.int)
                    else -> error("unknown action $action")
                }
                check(applied[i + 1], scope, records, "$name $action $arg")
            }
            steps += applied.size
        }
        assertEquals(97, steps)
    }

    private fun check(expected: JsonObject, scope: AirScope, records: List<JsonObject>, name: String) {
        fun same(key: String, actual: JsonElement?) = assertEquals(expected[key], actual, "$name: $key")
        fun number(key: String, actual: Double?) {
            val e = expected[key]?.jsonPrimitive?.double
            if (e == null || actual == null) assertEquals(e, actual, "$name: $key") else assertTrue(abs(e - actual) < 1e-9, "$name: $key $e != $actual")
        }
        fun string(key: String, actual: String?) = assertEquals(expected.str(key), actual, "$name: $key")
        same("address", scope.address)
        same("currentPosition", scope.currentPosition)
        assertEquals(expected["hasPush"]?.jsonPrimitive?.boolean, scope.hasPush, "$name: hasPush")
        assertEquals(expected["cityCount"]?.jsonPrimitive?.int, scope.cityCount, "$name: cityCount")
        string("aqiCode", scope.aqiCode)
        string("airCodeName", scope.airCodeName)
        string("mainName", scope.mainName)
        assertEquals(expected["stnIndex"]!!.jsonPrimitive.int, scope.stnIndex, "$name: stnIndex")
        string("airInfoOf", pathOf(scope.airInfo, records))
        string("currentWeatherOf", pathOf(scope.currentWeather, records))
        same("airCodeGrade", scope.airCodeGrade)
        same("airCodeValue", scope.airCodeValue)
        same("airCodeStr", scope.airCodeStr)
        same("mainInfo", scope.mainInfo)
        same("airCodeActionGuide", scope.airCodeActionGuide)
        string("unit", AirQuality.codeUnit(scope.aqiCode ?: "undefined"))
        string("mainColor", AirQuality.gradeColor(scope.standard, scope.airCodeGrade, null))
        string("labelColor", AirQuality.gradeColor(scope.standard, scope.airCodeGrade, "white"))
        string("face", AirQuality.sentimentIcon(scope.airUnit, scope.airCodeGrade))
        same("forecastPubdate", scope.forecastPubdate)
        same("forecastSource", scope.forecastSource)
        same("aqiList", scope.aqiList?.map { cell(scope, it.jsonObject, null) }?.let(::JsonArray))
        same("stnList", scope.stnList?.map { cell(scope, it, null) }?.let(::JsonArray))
        same("dayForecast", scope.dayForecast?.map { cell(scope, it.jsonObject, "white") }?.let(::JsonArray))
        val chart = expected["airChart"]?.jsonObject
        assertEquals(chart == null, scope.airChart == null, "$name: airChart")
        if (chart != null) {
            assertEquals(chart["maxValue"]?.jsonPrimitive?.double, scope.airChart!!.maxValue, "$name: maxValue")
            assertEquals(chart["data"]!!.jsonArray.map { if (it == JsonNull) null else it }, scope.airChart!!.data, "$name: slots")
        }
        string("hourlyChartTitle", scope.hourlyChartTitle)
        number("chartAirHeight", scope.chartAirHeight)
        assertEquals(expected["scrolls"]!!.jsonPrimitive.int, scope.scrolls, "$name: scrolls")
        number("bodyWidth", scope.metrics.bodyWidth)
        number("headerHeight", scope.metrics.headerHeight)
        number("bigFontSize", scope.metrics.bigFontSize)
    }

    /** A cell with the face and color the template gives it (`getSentimentIcon`, `grade2Color(grade[, default])`). */
    private fun cell(scope: AirScope, o: JsonObject, default: String?): JsonObject = JsonObject(o + mapOf(
        "face" to JsonPrimitive(AirQuality.sentimentIcon(scope.airUnit, o["grade"])),
        "color" to JsonPrimitive(AirQuality.gradeColor(scope.standard, o["grade"], default)),
    ))

    /** Where the generator found the object: `<place>/airInfoList/<i>/last`, `<place>/currentWeather/arpltn`… */
    private fun pathOf(value: JsonElement?, records: List<JsonObject>): String? {
        if (value == null) return null
        records.forEachIndexed { p, c ->
            val cw = c["currentWeather"]
            if (cw === value) return "$p/currentWeather"
            if ((cw as? JsonObject)?.get("arpltn") === value) return "$p/currentWeather/arpltn"
            if ((c["airInfo"] as? JsonObject)?.get("last") === value) return "$p/airInfo/last"
            (c["airInfoList"] as? JsonArray)?.forEachIndexed { i, s -> if ((s as? JsonObject)?.get("last") === value) return "$p/airInfoList/$i/last" }
        }
        return "other"
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
}
