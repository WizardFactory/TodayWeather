package net.wizardfactory.todayweather.core.domain

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.core.model.GeocodeResponse
import net.wizardfactory.todayweather.core.model.NationResponse
import net.wizardfactory.todayweather.core.model.PlaceWeather
import net.wizardfactory.todayweather.core.model.WeatherWarning

/** The core-model views read the captured responses and the converted weather without changing values. */
class ModelsTest {
    private val corpus = File(javaClass.getResource("/corpus/functions.json")!!.toURI()).parentFile
    private fun read(name: String) = Json.parseToJsonElement(File(corpus, name).readText())

    @Test
    fun placeWeatherViewsMatchTheConvertedJson() {
        for (name in listOf("kma-seoul", "kma-seoul-imperial", "vc-london", "vc-tokyo")) {
            val place = PlaceWeather(WeatherConverter.convert(read("inputs/$name.json"))!!)
            val current = place.currentWeather!!
            assertEquals((place.json["currentWeather"]!!.jsonObject["t1h"] as JsonPrimitive).content.toDouble(), current.t1h, name)
            assertEquals(place.json["timeTable"]!!.jsonArray.size, place.timeTable.size, name)
            assertEquals(2, place.timeChart.size, name)
            assertEquals("today", place.timeChart[1].name)
            assertTrue(place.dayTable.isNotEmpty(), name)
            assertEquals(place.dayTable.indexOfFirst { it.fromToday == 0.0 }.toDouble(), current.today!!.index, name)
            assertTrue(place.airStations.isNotEmpty(), name)
            assertTrue(place.location!!.lat != null && place.location!!.long != null, name)
        }
        assertEquals("KMA", PlaceWeather(WeatherConverter.convert(read("inputs/kma-seoul.json"))!!).source)
        assertEquals("VC", PlaceWeather(WeatherConverter.convert(read("inputs/vc-london.json"))!!).source)
    }

    @Test
    fun rawValuesKeepCordovaSemantics() {
        val case = read("conversion/kma-sentinels.json").jsonObject
        val place = PlaceWeather(WeatherConverter.convert(case["input"]!!)!!)
        assertEquals(-50.0, place.currentWeather!!.t1h, "sentinel kept")
        val strings = PlaceWeather(WeatherConverter.convert(read("conversion/kma-string-values.json").jsonObject["input"]!!)!!)
        val row = strings.timeTable.first { it.raw("pop") != null }
        assertTrue((row.raw("pop") as JsonPrimitive).isString, "raw keeps the string")
        assertEquals((row.raw("pop") as JsonPrimitive).content.toDouble(), row.pop)
        assertEquals(null, strings.currentWeather!!.raw("doesNotExist"))
    }

    @Test
    fun otherResponsesParse() {
        val nation = NationResponse(read("inputs/nation.json").jsonObject)
        assertEquals(15, nation.weather.size)
        assertEquals(17, nation.air.size)
        assertTrue(nation.weather.all { it.current?.skyIcon != null })
        val warnings = read("inputs/special.json").jsonArray.map { WeatherWarning(it.jsonObject) }
        assertTrue(warnings.isNotEmpty() && warnings.all { it.announcement != null && it.comment != null })
        val geo = GeocodeResponse(read("inputs/geocode-seoul.json").jsonObject)
        assertEquals("서울특별시 중구 회현동", geo.address)
        assertEquals(37.56, geo.location!!.lat)
    }
}
