package net.wizardfactory.todayweather.core.domain

import java.io.File
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.model.NationResponse

/** Air, nationwide and warning display rules against the Cordova corpus (air.json, nation.json, special.json). */
class GoldenCorpusDisplayTest {
    private val corpus = File(javaClass.getResource("/corpus/functions.json")!!.toURI()).parentFile
    private fun read(name: String) = Json.parseToJsonElement(File(corpus, name).readText())
    // An undefined Cordova result is omitted from the JSON; read it as null.
    private fun cases(e: JsonElement) = e.jsonArray.map { it.jsonObject["args"]!!.jsonArray to (it.jsonObject["expected"] ?: JsonNull) }
    private fun s(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
    private fun arg(e: JsonElement): JsonElement? = if (e == JsonNull) null else e

    @Test
    fun airStandardsColorsIconsAndGaugeMatchCordova() {
        val air = read("air.json").jsonObject
        for ((args, expected) in cases(air["standards"]!!)) {
            val std = AirQuality.standard(s(args[0]))
            val e = expected.jsonObject
            if (e["list"] == JsonNull) {
                assertEquals(null, std, "standard $args")
                continue
            }
            val list = e["list"]!!.jsonArray
            assertEquals(list.size, std!!.grades.size, "grades $args")
            list.forEachIndexed { i, g ->
                val o = g.jsonObject
                assertEquals(s(o["color"]), std.grades[i].color)
                assertEquals(s(o["str"]), std.grades[i].str)
                for ((code, v) in o["value"]!!.jsonObject) assertEquals(v.jsonPrimitive.double, std.grades[i].upperBound[code], "$args $i $code")
            }
            for ((code, v) in e["maxValue"]!!.jsonObject) assertEquals(v.jsonPrimitive.double, std.maxValue[code], "max $args $code")
        }
        for ((args, expected) in cases(air["gradeColor"]!!)) {
            assertEquals(s(expected), AirQuality.gradeColor(AirQuality.standard(s(args[0])), arg(args[1]), s(args[2])), "gradeColor $args")
        }
        for ((args, expected) in cases(air["airkoreaGradeColor"]!!)) {
            assertEquals(s(expected), AirQuality.airkoreaGradeColor(arg(args[0])), "airkoreaGradeColor $args")
        }
        for ((args, expected) in cases(air["sentimentIcon"]!!)) {
            assertEquals(s(expected), AirQuality.sentimentIcon(s(args[0]), arg(args[1])), "icon $args")
        }
        for ((args, expected) in cases(air["labelPosition"]!!)) {
            val x = AirQuality.labelPosition(AirQuality.standard(s(args[0])), s(args[1])!!, args[3].jsonPrimitive.int,
                args[4].jsonPrimitive.double, args[2].jsonPrimitive.double)
            assertEquals(expected.jsonPrimitive.double, x, 1e-9, "labelPosition $args")
        }
        for ((args, expected) in cases(air["airCodeUnit"]!!)) assertEquals(s(expected), AirQuality.codeUnit(s(args[0])!!))
    }

    @Test
    fun airListsAndForecastsMatchCordova() {
        val air = read("air.json").jsonObject
        fun stations(name: String): List<JsonObject> {
            val data = read("inputs/$name.json").jsonObject
            return (data["airInfoList"] as? JsonArray)?.map { it.jsonObject } ?: listOfNotNull(data["airInfo"] as? JsonObject)
        }
        for ((args, expected) in cases(air["aqiList"]!!)) {
            val actual = if (s(args[0]) == "missing-air") {
                AirQuality.pollutantList(JsonObject(emptyMap()), null)
            } else {
                val station = stations(s(args[0])!!)[args[1].jsonPrimitive.int]
                AirQuality.pollutantList(station["last"] as? JsonObject ?: JsonObject(emptyMap()), station["pollutants"] as? JsonObject)
            }
            assertEquals<JsonElement>(expected, actual, "aqiList $args")
        }
        for ((args, expected) in cases(air["hourlyForecast"]!!)) {
            val station = stations(s(args[0])!!)[args[1].jsonPrimitive.int]
            val hourly = station["pollutants"]!!.jsonObject["aqi"]!!.jsonObject["hourly"]
            assertEquals<JsonElement?>(expected, AirQuality.hourlyForecast(s(args[2])!!, hourly), "hourly $args")
        }
        for ((args, expected) in cases(air["dustForecast"]!!)) {
            val data = read("inputs/${s(args[0])}.json").jsonObject
            val days = (data["midData"] as? JsonObject)?.get("dailyData") ?: data["daily"]
            assertEquals<JsonElement?>(if (expected == JsonNull) null else expected, AirQuality.dustForecast(days, s(args[1])!!), "dust $args")
        }
    }

    @Test
    fun nationwideMapsMatchCordova() {
        val nationJson = read("nation.json").jsonObject
        val nation = NationResponse(read("inputs/nation.json").jsonObject)
        assertEquals(nationJson["weatherCities"]!!.jsonArray.map { label(it) }, Nationwide.WEATHER_CITIES)
        assertEquals(nationJson["airCities"]!!.jsonArray.map { label(it) }, Nationwide.AIR_CITIES)
        val units = mapOf("precipitationUnit" to "mm", "windSpeedUnit" to "m/s")
        for ((args, expected) in cases(nationJson["weather"]!!)) {
            val mode = Nationwide.Mode.entries[args[0].jsonPrimitive.int]
            val label = Nationwide.weatherLabel(nation, mode, s(args[1])!!)
            val e = expected.jsonObject
            assertEquals(s(e["icon"]), label.icon, "icon $args")
            assertEquals(e["text1"], label.text1 ?: JsonNull, "text1 $args")
            assertEquals(e["text2"], label.text2 ?: JsonNull, "text2 $args")
            val (u1, u2) = Nationwide.unitKeys(mode)
            assertEquals(s(e["text1Unit"]), u1?.let(units::get), "unit1 $args")
            assertEquals(s(e["text2Unit"]), u2?.let(units::get), "unit2 $args")
        }
        for ((args, expected) in cases(nationJson["air"]!!)) {
            val e = expected.jsonObject
            assertEquals(e["text1"], Nationwide.airValue(nation, s(args[1])!!, s(args[2])!!) ?: JsonNull, "air $args")
            assertEquals(s(e["color"]), Nationwide.airColor(nation, s(args[1])!!, s(args[2])!!, s(args[0])), "color $args")
        }
    }

    @Test
    fun warningsMatchCordova() {
        val input = read("inputs/special.json").jsonArray
        for ((args, expected) in cases(read("special.json"))) {
            assertEquals(expected, Warnings.parse(input, s(args[0])!!, ZoneId.of(s(args[1])!!)), "special $args")
        }
    }

    private fun label(e: JsonElement) = e.jsonObject.let { MapLabel(s(it["name"])!!, it["top"]!!.jsonPrimitive.int, it["left"]!!.jsonPrimitive.int) }
}
