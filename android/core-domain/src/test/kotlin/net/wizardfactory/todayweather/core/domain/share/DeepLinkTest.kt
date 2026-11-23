package net.wizardfactory.todayweather.core.domain.share

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * `link.todayweather.ai` links against the shared golden vectors (specs/deeplink.golden.json), which the edge, the web
 * app and iOS read too: every parse case, every share case and the catalog.
 */
class DeepLinkTest {
    private val repo = File(System.getProperty("tw.projectDir")!!).parentFile.parentFile
    private val golden = Json.parseToJsonElement(File(repo, "specs/deeplink.golden.json").readText()).jsonObject

    private fun JsonObject.str(key: String) = this[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull
    private fun JsonObject.num(key: String) = this[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.doubleOrNull

    private fun expected(native: JsonObject?): DeepLinkTarget? = native?.let { n ->
        when (n.str("kind")) {
            "open" -> DeepLinkTarget.Open(n.str("lang"))
            "place" -> DeepLinkTarget.Place(n.str("slug")!!, WeatherView.of(n.str("view")), n.str("pollutant"))
            "coordinate" -> DeepLinkTarget.Coordinate(n.num("lat")!!, n.num("lon")!!, n.str("name"), WeatherView.of(n.str("view")), n.str("pollutant"))
            "nationWeather" -> DeepLinkTarget.NationWeather
            "nationAir" -> DeepLinkTarget.NationAir
            "warnings" -> DeepLinkTarget.Warnings
            "legacyWidgetIndex" -> DeepLinkTarget.LegacyWidgetIndex(n.num("index")!!)
            else -> error("unknown kind ${n.str("kind")}")
        }
    }

    @Test
    fun everyGoldenParseCaseMatches() {
        val cases = golden["parseCases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 38, "found the parse cases (${cases.size})")
        for (case in cases) {
            val url = case.str("url")!!
            // The iOS widget link (`todayweather://widget?place=`) is not an Android link: it opens nothing here.
            val want = if (case.str("legacyPlatform") == "ios") null else expected(case["native"]?.takeIf { it !is JsonNull }?.jsonObject)
            assertEquals(want, DeepLink.parse(url), "${case.str("id")}: $url")
        }
    }

    @Test
    fun everyGoldenShareCaseMatches() {
        val cases = golden["shareBuildCases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 12, "found the share cases (${cases.size})")
        for (case in cases) {
            val input = case["input"]!!.jsonObject
            val url = DeepLink.shareUrl(
                lat = input.num("lat"), lon = input.num("lon"), name = input.str("name"),
                view = WeatherView.of(input.str("view")), pollutant = input.str("pollutant"), placeId = input.str("placeId"),
            )
            assertEquals(case.str("url"), url, case.str("id"))
        }
    }

    @Test
    fun theCatalogMatchesTheGoldenCatalogAndTheWebPlaces() {
        val catalog = golden["catalog"]!!.jsonArray.map { it.jsonObject }
        assertEquals(catalog.map { Triple(it.str("id")!!, it["lat"]!!.jsonPrimitive.double, it["lon"]!!.jsonPrimitive.double) },
            DeepLinkCatalog.PLACES.map { Triple(it.id, it.lat, it.lon) })
        // packages/weather-core PLACES: ["seoul", "서울", "서울특별시 중구", "KR", 37.567, 126.978],
        val row = Regex("""^\s*\["([a-z0-9-]+)", "([^"]*)", "([^"]*)", "([A-Z]{2})", (-?[\d.]+), (-?[\d.]+)],?\s*$""")
        val web = File(repo, "packages/weather-core/src/index.ts").readLines().mapNotNull { row.find(it)?.groupValues }
            .map { CatalogPlace(it[1], it[2], it[3], it[4], it[5].toDouble(), it[6].toDouble()) }
        assertEquals(web, DeepLinkCatalog.PLACES)
    }

    @Test
    fun hostsOtherThanTheLinkHostOpenNothing() {
        for (url in listOf("https://todayweather.ai/mobile/privacy.html", "https://app.todayweather.ai/weather/seoul/hourly",
            "https://link.todayweather.ai.evil.example/place/seoul", "https://evil.example/link.todayweather.ai/place/seoul",
            "intent://link.todayweather.ai/place/seoul", "", "not a url")) {
            assertNull(DeepLink.parse(url), url)
        }
        assertEquals(DeepLinkTarget.Place("seoul", WeatherView.HOURLY, null), DeepLink.parse("https://link.todayweather.ai:443/place/seoul#top"))
        assertEquals(DeepLinkTarget.Coordinate(37.5, 127.0, "a b", WeatherView.HOURLY, null),
            DeepLink.parse("https://link.todayweather.ai/loc?lat=37.5&lon=127&name=a+b&lat=1"))
    }

    @Test
    fun savedPlacesMatchWithinAHundredthOfADegree() {
        assertTrue(DeepLink.nearSaved(37.567, 126.978, 37.577, 126.968))
        assertTrue(!DeepLink.nearSaved(37.567, 126.978, 37.578, 126.978))
        assertEquals("seoul", DeepLinkCatalog.find("seoul")?.id)
        assertNull(DeepLinkCatalog.find("not-in-catalog"))
    }

    /** CODEX-3164-8, -9: raw and escaped names decode alike (supplementary characters too); ports follow `new URL`. */
    @Test
    fun rawNamesDecodeAsEscapedOnesAndPortsMustBeValid() {
        val raw = DeepLink.parse("https://link.todayweather.ai/loc?lat=1&lon=2&name=😀 서울")
        assertEquals(DeepLinkTarget.Coordinate(1.0, 2.0, "😀 서울", WeatherView.HOURLY, null), raw)
        assertEquals(raw, DeepLink.parse("https://link.todayweather.ai/loc?lat=1&lon=2&name=%F0%9F%98%80%20%EC%84%9C%EC%9A%B8"))
        assertNull(DeepLink.parse("https://link.todayweather.ai:65536/open"))
        assertNull(DeepLink.parse("https://link.todayweather.ai:x/open"))
        assertEquals(DeepLinkTarget.Open(null), DeepLink.parse("https://link.todayweather.ai:8443/open"))
        assertEquals(DeepLinkTarget.Open(null), DeepLink.parse("https://link.todayweather.ai:/open"))
    }
}
