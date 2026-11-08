package net.wizardfactory.todayweather.core.domain.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import java.io.File
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Language, region, theme, startup page and photo feed rules of the Cordova shell (#2886). */
class ShellLogicTest {
    /** angular-translate with the app's keys and aliases: exact keys, aliases in order, the language part, else English. */
    @Test
    fun firstSystemLanguagePicksTheCatalog() {
        val cases = mapOf(
            "ko-KR" to "ko", "ko" to "ko", "en-US" to "en", "en" to "en", "de-AT" to "de", "ja-JP" to "ja",
            "zh-TW" to "zh-TW", "zh-HK" to "zh-TW", "zh-CN" to "zh-CN", "zh-SG" to "zh-CN",
            "zh-Hant-TW" to "zh-CN", // "zh_Hant_TW" only matches zh_* (survey ambiguity 4)
            "zh" to "en", "fr-FR" to "en", "pt-BR" to "en", "" to "en",
        )
        cases.forEach { (tag, expected) -> assertEquals(expected, AppLanguage.catalog(tag), tag) }
        assertEquals("en", AppLanguage.catalog(null))
    }

    @Test
    fun regionIsTheLastPartOfTheFirstTagWithARegion() {
        assertEquals("KR", AppLanguage.region(listOf("ko-KR", "en-US")))
        assertEquals("US", AppLanguage.region(listOf("en", "en-US")))
        assertEquals("TW", AppLanguage.region(listOf("zh-Hant-TW")))
        assertEquals("KR", AppLanguage.region(listOf("en")))
        assertEquals("KR", AppLanguage.region(emptyList()))
        assertEquals("ko-KR", AppLanguage.webTag("ko", "KR"))
        assertEquals("en", AppLanguage.webTag("en", ""))
    }

    @Test
    fun themesStartupPagesAndFolders() {
        assertEquals(Theme.LIGHT, Theme.of(null))
        assertEquals(Theme.LIGHT, Theme.of("unknown"))
        assertEquals("img/icons_dark", Theme.of("dark").icons)
        assertEquals("img/weather_old", Theme.of("old").weather)
        assertEquals("img/weather_default", Theme.of("photo").weather)
        assertEquals(Tab.HOURLY, StartupPage.tab("0"))
        assertEquals(Tab.DAILY, StartupPage.tab("1"))
        assertEquals(Tab.LOCATIONS, StartupPage.tab("2"))
        assertEquals(Tab.AIR, StartupPage.tab("3"))
        assertEquals(Tab.HOURLY, StartupPage.tab("9"))
        assertEquals(Tab.HOURLY, StartupPage.tab(null))
    }

    /**
     * The Cordova code's grouping and choice (corpus/photos.json): groups by joined tags, the first group in the
     * icon name with photos, and the photo at floor(random * (n - 1)), for every weather image name.
     */
    @Test
    fun photosMatchTheCordovaCode() {
        val corpus = Json.parseToJsonElement(File(javaClass.getResource("/corpus/photos.json")!!.toURI()).readText()).jsonObject
        assertEquals(20000, corpus["request"]!!.jsonObject["timeout"]!!.jsonPrimitive.int)
        for (feed in corpus["feeds"]!!.jsonArray.map { it.jsonObject }) {
            val groups = WeatherPhotos.parse(feed["feed"]!!).groups.mapValues { (_, photos) -> photos.map { it["id"]!!.jsonPrimitive.content } }
            val expected = feed["groups"]!!.jsonObject.mapValues { (_, ids) -> ids.jsonArray.map { it.jsonPrimitive.content } }
            assertEquals(expected, groups, feed["name"]!!.jsonPrimitive.content)
        }
        val photos = WeatherPhotos.parse(corpus["feeds"]!!.jsonArray.first().jsonObject["feed"]!!)
        val cases = corpus["cases"]!!.jsonArray.map { it.jsonObject }
        assertEquals(195, cases.size)
        for (case in cases) {
            val icon = case["skyIcon"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val random = case["random"]!!.jsonPrimitive.double
            assertEquals(case["photo"]!!.jsonPrimitive.contentOrNull, photos.find(icon, random), "$icon at $random")
        }
        assertNull(WeatherPhotos.parse(Json.parseToJsonElement("{}")).find("sun", 0.3), "not an array")
    }
}
