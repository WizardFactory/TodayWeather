package net.wizardfactory.todayweather.core.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.model.PlaceWeather
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HourlyDetailsTest {
    @Test
    fun convertsSupplementalForecastWithoutChangingTheChart() {
        val input = Json.parseToJsonElement(
            """{"daily":[],"hourly":[],"thisTime":[{},{}],"pubDate":{"VC":{}},"hourlyDetails":[
              {"at":"2026-09-23T08:00:00.000Z","uvIndex":0,"windGustMps":8,"wbgtC":-3}
            ]}"""
        ) as JsonObject
        val weather = PlaceWeather(requireNotNull(WeatherConverter.convert(input)))
        val detail = weather.hourlyDetails.single()
        assertEquals("2026-09-23T08:00:00.000Z", detail.at)
        assertEquals(0.0, detail.uvIndex)
        assertEquals(8.0, detail.windGustMps)
        assertEquals(-3.0, detail.wbgtC)
        assertNull(detail.severeRisk)

        val legacy = PlaceWeather(requireNotNull(WeatherConverter.convert(JsonObject(input - "hourlyDetails"))))
        assertEquals(weather.timeTable, legacy.timeTable)
        assertTrue(legacy.hourlyDetails.isEmpty())
    }
}
