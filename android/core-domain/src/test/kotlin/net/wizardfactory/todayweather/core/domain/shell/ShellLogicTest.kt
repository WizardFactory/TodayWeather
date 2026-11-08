package net.wizardfactory.todayweather.core.domain.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json

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

    /** Grouping by joined tags in the Cordova order, and the photo index floor(random * (n - 1)). */
    @Test
    fun photosAreGroupedAndChosenAsInCordova() {
        val feed = Json.parseToJsonElement("""{"data": [
            {"tags": ["sun", "smallcloud"], "twUrls": {"regular": "sun-small-1"}},
            {"tags": ["sun", "smallcloud"], "twUrls": {"regular": "sun-small-2"}},
            {"tags": ["sun", "smallcloud"], "twUrls": {"regular": "sun-small-3"}},
            {"tags": ["rain", "sun"], "twUrls": {"regular": "rain-1"}},
            {"tags": ["lightning", "rain"], "twUrls": {"regular": "lightning-1"}},
            {"tags": ["moon"], "twUrls": {"regular": "moon-1"}},
            {"tags": "cloud", "twUrls": {"regular": "skipped"}},
            {"tags": ["cloud", null], "twUrls": {"regular": "cloud-1"}},
            {"tags": ["fog"], "twUrls": {"regular": "none"}}
        ]}""")
        val photos = WeatherPhotos.parse(feed)
        assertEquals("sun-small-1", photos.find("sun_smallcloud", 0.0))
        assertEquals("sun-small-2", photos.find("sun_smallcloud", 0.99)) // floor(0.99 * 2) = 1: the last is never chosen
        // "rain" comes before "sun" in the group order, so a rain icon finds the rain photo first.
        assertEquals("rain-1", photos.find("sun_smallcloud_rain", 0.5))
        assertEquals("lightning-1", photos.find("cloud_lightning", 0.7))
        assertEquals("moon-1", photos.find("moon", 0.3))
        assertEquals("cloud-1", photos.find("cloud", 0.3))
        // Empty groups (sun_bigcloud, sun) are skipped; "cloud" is also in the icon name.
        assertEquals("cloud-1", photos.find("sun_bigcloud", 0.3))
        assertNull(photos.find("fog", 0.3), "no group key in the icon name")
        assertNull(photos.find(null, 0.3))
        assertNull(WeatherPhotos.parse(Json.parseToJsonElement("{}")).find("sun", 0.3))
    }
}
