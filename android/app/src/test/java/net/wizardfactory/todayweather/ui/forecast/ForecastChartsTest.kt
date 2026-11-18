package net.wizardfactory.todayweather.ui.forecast

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ForecastChartsTest {
    @Test fun reusesBothChartsByValueAndRebuildsForChangedInputs() {
        val project = File(System.getProperty("tw.projectDir")!!)
        val fixture = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
        val weather = WeatherConverter.convert(Json.parseToJsonElement(fixture))!!
        val cache = ForecastCharts()
        val texts = ChartTexts(emptyMap())
        val metrics = ChartMetrics(384.0, 832.0)
        val hourly = cache.hourly(weather, metrics, texts, "mm", "m/s")!!
        val daily = cache.daily(weather, metrics, texts, "mm")!!
        val equalWeather = JsonObject(weather.toMap())

        assertSame(hourly, cache.hourly(equalWeather, ChartMetrics(384.0, 832.0), ChartTexts(emptyMap()), "mm", "m/s"))
        assertSame(daily, cache.daily(equalWeather, ChartMetrics(384.0, 832.0), ChartTexts(emptyMap()), "mm"))
        assertNull(cache.hourly(null, metrics, texts, "mm", "m/s"))
        assertNull(cache.daily(JsonObject(emptyMap()), metrics, texts, "mm"))

        val translated = cache.hourly(weather, metrics, ChartTexts(mapOf("LOC_THIS_DAY_TEMP" to "Today")), "mm", "m/s")!!
        assertEquals("Today", translated.legendToday)
        val differentUnits = cache.hourly(weather, metrics, texts, "in", "mph")!!
        assertNotSame(hourly, differentUnits)
        val resized = cache.daily(weather, ChartMetrics(360.0, 780.0), texts, "mm")!!
        assertEquals(360.0 / 7, resized.columnWidth, 0.0)
        val updated = JsonObject(weather - "currentWeather")
        assertNotSame(differentUnits, cache.hourly(updated, metrics, texts, "in", "mph"))
        assertNotSame(resized, cache.daily(updated, ChartMetrics(360.0, 780.0), texts, "mm"))
    }
}
