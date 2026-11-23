package net.wizardfactory.todayweather.core.domain.share

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The share message of the Cordova build (`doTabShare`, `_makeMessageForTodayWeather`, `getWeatherEmoji`; O16, V20):
 * the lines, the values joined as JavaScript joins them, and the city line alone when building the rest throws. The
 * Branch links gave way to `link.todayweather.ai` links for the shared place and tab (specs/deeplink.md §7, D35).
 */
class ShareMessageTest {
    private val ko = ShareMessage.Texts(current = "현재", highest = "최고", lowest = "최저", app = "오늘날씨")
    private fun city(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private val seoul = city("""{"name": "회현동", "address": "대한민국 서울특별시 중구 회현동", "location": {"lat": 37.56, "long": 126.98},
        "currentWeather": {"t1h": 7.2, "skyIcon": "moon_smallcloud", "today": {"tmx": 12, "tmn": -1},
        "summaryWeather": "어제보다 -1˚, 맑음", "summaryAir": "대기상태가 좋아요"}}""")

    @Test
    fun theMessageHasTheCordovaLines() {
        assertEquals("회현동\n현재 7.2˚ ⛅\n최고 12˚, 최저 -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\n오늘날씨 https://link.todayweather.ai/place/seoul",
            ShareMessage.build(seoul, ko))
        val en = ShareMessage.Texts("Current", "High", "Low", "TodayWeather")
        assertEquals("회현동\nCurrent 7.2˚ ⛅\nHigh 12˚, Low -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\nTodayWeather https://link.todayweather.ai/place/seoul",
            ShareMessage.build(seoul, en))
    }

    @Test
    fun anAddressStandsInForAMissingName() {
        val place = city("""{"name": "", "address": "대한민국 서울특별시 중구 회현동", "location": {"lat": 37.56, "long": 126.98},
            "currentWeather": {"t1h": 7, "skyIcon": "sun", "today": {"tmx": 12, "tmn": 3}, "summary": "맑음"}}""")
        assertEquals("서울시,회현동\n현재 7˚ 🌞\n최고 12˚, 최저 3˚\n맑음\n\n오늘날씨 https://link.todayweather.ai/place/seoul", ShareMessage.build(place, ko))
    }

    @Test
    fun missingValuesPrintAsJavaScriptPrintsThem() {
        val bare = city("""{"name": "런던", "location": {"lat": 51.51, "long": -0.13}, "currentWeather": {"skyIcon": "cloud", "summaryWeather": null}}""")
        assertEquals("런던\n현재 undefined˚ ☁\n최고 undefined˚, 최저 undefined˚\n\n오늘날씨 https://link.todayweather.ai/place/london",
            ShareMessage.build(bare, ko))
        val nullAir = city("""{"name": "런던", "location": {"lat": 51.51, "long": -0.13},
            "currentWeather": {"t1h": null, "skyIcon": "cloud_rain", "today": {"tmx": "8", "tmn": null}, "summaryWeather": "비", "summaryAir": null}}""")
        assertEquals("런던\n현재 null˚ ☔\n최고 8˚, 최저 null˚\n비\nnull\n\n오늘날씨 https://link.todayweather.ai/place/london", ShareMessage.build(nullAir, ko))
    }

    @Test
    fun aThrowLeavesTheCityLineOnly() {
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}}"""), ko))
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}, "currentWeather": {"t1h": 3}}"""), ko))
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}, "currentWeather": {"skyIcon": 5}}"""), ko))
    }

    @Test
    fun withoutALocationThereIsNoMessage() {
        assertNull(ShareMessage.build(null, ko))
        assertNull(ShareMessage.build(city("""{"name": "현재 위치", "currentPosition": true}"""), ko))
        assertNull(ShareMessage.build(city("""{"name": "현재 위치", "location": null}"""), ko))
    }

    @Test
    fun theEmojiFollowsTheFirstMatch() {
        val cases = mapOf("SunSmallCloudLightning" to "⛈", "RainSnow" to "☔☃", "SunBigCloudRain" to "☔", "Snow" to "☃",
            "MoonBigCloud" to "⛅", "Cloud" to "☁", "Sun" to "🌞", "Moon" to "🌞", "Fog" to "")
        for ((icon, emoji) in cases) assertEquals(emoji, ShareMessage.emoji(icon.lowercase()), icon)
        assertEquals("", ShareMessage.emoji("Sun"), "indexOf is case-sensitive")
    }

    @Test
    fun theLinkFollowsTheSharedPlaceAndTab() {
        fun body(name: String, lat: Double, long: Double) = city("""{"name": "$name", "location": {"lat": $lat, "long": $long},
            "currentWeather": {"t1h": 7, "skyIcon": "sun", "today": {"tmx": 12, "tmn": 3}}}""")
        fun link(message: String?) = message!!.substringAfterLast(' ')
        assertEquals("https://link.todayweather.ai/place/seoul?view=daily", link(ShareMessage.build(seoul, ko, WeatherView.DAILY)))
        assertEquals("https://link.todayweather.ai/air/seoul?pollutant=pm25", link(ShareMessage.build(seoul, ko, WeatherView.AIR, "pm25")))
        assertEquals("https://link.todayweather.ai/air/seoul", link(ShareMessage.build(seoul, ko, WeatherView.AIR, "aqi")))
        // Outside the catalog: three decimals and the name the message starts with.
        assertEquals("https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EB%B6%84%EB%8B%B9%EA%B5%AC&view=air&pollutant=o3",
            link(ShareMessage.build(body("분당구", 37.38274, 127.11891), ko, WeatherView.AIR, "o3")))
        assertEquals("https://link.todayweather.ai/loc?lat=0&lon=0&name=Null%20Island", link(ShareMessage.build(body("Null Island", -0.0001, 0.0), ko)))
        // Coordinates out of range open the app only.
        assertEquals("https://link.todayweather.ai/open", link(ShareMessage.build(body("x", 95.0, 0.0), ko)))
    }
}
