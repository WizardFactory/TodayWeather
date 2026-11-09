package net.wizardfactory.todayweather.core.domain.share

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The share message of the Cordova build (`doTabShare`, `_makeMessageForTodayWeather`, `getWeatherEmoji`; O16, V20):
 * the lines, the values joined as JavaScript joins them, the link per language, and the city line alone when building
 * the rest throws.
 */
class ShareMessageTest {
    private val ko = ShareMessage.Texts(current = "현재", highest = "최고", lowest = "최저", app = "오늘날씨")
    private fun city(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private val seoul = city("""{"name": "회현동", "address": "대한민국 서울특별시 중구 회현동", "location": {"lat": 37.56, "long": 126.98},
        "currentWeather": {"t1h": 7.2, "skyIcon": "moon_smallcloud", "today": {"tmx": 12, "tmn": -1},
        "summaryWeather": "어제보다 -1˚, 맑음", "summaryAir": "대기상태가 좋아요"}}""")

    @Test
    fun theMessageHasTheCordovaLines() {
        assertEquals("회현동\n현재 7.2˚ ⛅\n최고 12˚, 최저 -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM",
            ShareMessage.build(seoul, ko, "ko-KR"))
        val en = ShareMessage.Texts("Current", "High", "Low", "TodayWeather")
        assertEquals("회현동\nCurrent 7.2˚ ⛅\nHigh 12˚, Low -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\nTodayWeather https://twa.app.link/II1JstpVoM",
            ShareMessage.build(seoul, en, "en-US"))
    }

    @Test
    fun anAddressStandsInForAMissingName() {
        val place = city("""{"name": "", "address": "대한민국 서울특별시 중구 회현동", "location": {"lat": 37.56, "long": 126.98},
            "currentWeather": {"t1h": 7, "skyIcon": "sun", "today": {"tmx": 12, "tmn": 3}, "summary": "맑음"}}""")
        assertEquals("서울시,회현동\n현재 7˚ 🌞\n최고 12˚, 최저 3˚\n맑음\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM", ShareMessage.build(place, ko, "ko-KR"))
    }

    @Test
    fun missingValuesPrintAsJavaScriptPrintsThem() {
        val bare = city("""{"name": "런던", "location": {"lat": 51.51, "long": -0.13}, "currentWeather": {"skyIcon": "cloud", "summaryWeather": null}}""")
        assertEquals("런던\n현재 undefined˚ ☁\n최고 undefined˚, 최저 undefined˚\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM",
            ShareMessage.build(bare, ko, "ko"))
        val nullAir = city("""{"name": "런던", "location": {"lat": 51.51, "long": -0.13},
            "currentWeather": {"t1h": null, "skyIcon": "cloud_rain", "today": {"tmx": "8", "tmn": null}, "summaryWeather": "비", "summaryAir": null}}""")
        assertEquals("런던\n현재 null˚ ☔\n최고 8˚, 최저 null˚\n비\nnull\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM", ShareMessage.build(nullAir, ko, "ko"))
    }

    @Test
    fun aThrowLeavesTheCityLineOnly() {
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}}"""), ko, "ko-KR"))
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}, "currentWeather": {"t1h": 3}}"""), ko, "ko-KR"))
        assertEquals("회현동\n", ShareMessage.build(city("""{"name": "회현동", "location": {"lat": 1, "long": 2}, "currentWeather": {"skyIcon": 5}}"""), ko, "ko-KR"))
    }

    @Test
    fun withoutALocationThereIsNoMessage() {
        assertNull(ShareMessage.build(null, ko, "ko-KR"))
        assertNull(ShareMessage.build(city("""{"name": "현재 위치", "currentPosition": true}"""), ko, "ko-KR"))
        assertNull(ShareMessage.build(city("""{"name": "현재 위치", "location": null}"""), ko, "ko-KR"))
    }

    @Test
    fun theEmojiFollowsTheFirstMatch() {
        val cases = mapOf("SunSmallCloudLightning" to "⛈", "RainSnow" to "☔☃", "SunBigCloudRain" to "☔", "Snow" to "☃",
            "MoonBigCloud" to "⛅", "Cloud" to "☁", "Sun" to "🌞", "Moon" to "🌞", "Fog" to "")
        for ((icon, emoji) in cases) assertEquals(emoji, ShareMessage.emoji(icon.lowercase()), icon)
        assertEquals("", ShareMessage.emoji("Sun"), "indexOf is case-sensitive")
    }
}
