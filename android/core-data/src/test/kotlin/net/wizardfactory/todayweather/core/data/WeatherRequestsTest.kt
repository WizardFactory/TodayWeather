package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/** The weather requests against `getWeatherByGeoInfo` run under Node (corpus/requests.json, tools/corpus/generate.mjs). */
class WeatherRequestsTest {
    private val cases = Json.parseToJsonElement(File(javaClass.getResource("/corpus/requests.json")!!.toURI()).readText()).jsonArray

    @Test
    fun urlsMatchTheCordovaCode() {
        assertEquals(15, cases.size)
        for (case in cases.map { it.jsonObject }) {
            val name = case["name"]!!.jsonPrimitive.content
            val geo = case["geoInfo"]!!.jsonObject
            val location = geo["location"]?.jsonObject?.let { Location(it["lat"]!!.jsonPrimitive.double, it["long"]!!.jsonPrimitive.double) }
            val place = Place(currentPosition = false, disable = false, address = geo["address"]?.jsonPrimitive?.contentOrNull, location = location)
            val url = WeatherRequests.url("https://server.test.invalid", place, units(case["units"]!!.jsonObject))
            assertEquals(case["url"]?.jsonPrimitive?.content, url, name)
            case["timeout"]?.let { assertEquals(it.jsonPrimitive.long, WeatherRequests.TIMEOUT_MS, "$name timeout") }
        }
    }

    @Test
    fun acceptLanguageIsAWebViewHeader() {
        assertEquals("ko-KR,ko;q=0.9", WeatherRequests.acceptLanguage(listOf("ko-KR")))
        assertEquals("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7", WeatherRequests.acceptLanguage(listOf("ko-KR", "en-US")))
        assertEquals("en-US,en-GB;q=0.9,en;q=0.8", WeatherRequests.acceptLanguage(listOf("en-US", "en-GB")))
        assertEquals("en-US,ko;q=0.9,en;q=0.8", WeatherRequests.acceptLanguage(listOf("en-US", "ko", "en")))
        assertEquals("zh-Hant-TW,zh;q=0.9", WeatherRequests.acceptLanguage(listOf("zh-Hant-TW")))
        assertEquals("ja", WeatherRequests.acceptLanguage(listOf("ja")))
        val many = WeatherRequests.acceptLanguage((1..12).map { "x$it" })
        assertEquals("x1,x2;q=0.9", many.substringBefore(",x3"))
        assertEquals("x12;q=0.1", many.substringAfterLast(","), "q-values stop at 0.1")
    }

    private fun units(u: JsonObject) = UnitSettings(
        temperatureUnit = u.text("temperatureUnit"), windSpeedUnit = u.text("windSpeedUnit"), pressureUnit = u.text("pressureUnit"),
        distanceUnit = u.text("distanceUnit"), precipitationUnit = u.text("precipitationUnit"), airUnit = u.text("airUnit"),
    )

    private fun JsonObject.text(key: String) = this[key]!!.jsonPrimitive.content
}
