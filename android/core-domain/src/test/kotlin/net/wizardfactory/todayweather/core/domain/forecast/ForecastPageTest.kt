package net.wizardfactory.todayweather.core.domain.forecast

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts

/**
 * ForecastPage against the Cordova pages themselves: the text, images and grade colors of every block that
 * tools/forecast-reference captured from the Cordova build (app/src/test/resources/forecast-reference) for Seoul alone
 * and London added after it, in Korean at 384x832; then the template rules the captures do not reach.
 */
class ForecastPageTest {
    private val project = File(System.getProperty("tw.projectDir"))
    private val corpus = File(javaClass.getResource("/corpus/forecast.json")!!.toURI()).parentFile
    private val ko = catalog("values-ko")
    private val units = PageUnits("C", "m/s", "hPa", "km", "mm", "airkorea")

    @Test
    fun pagesShowWhatTheCordovaPagesShow() {
        for ((place, cityCount) in listOf("kma-seoul" to 1, "vc-london" to 2)) {
            for ((page, type) in listOf("hourly" to ForecastType.SHORT, "daily" to ForecastType.MID)) {
                val reference = Json.parseToJsonElement(File(project, "../app/src/test/resources/forecast-reference/$place/$page.json").readText()).jsonObject
                val blocks = reference["blocks"]!!.jsonArray.map { it.jsonObject }
                val model = page(type, record(place), cityCount)
                val expected = blocks.filterIndexed { i, _ -> i != 1 }.map { b -> b["elements"]!!.jsonArray.map { entry(it.jsonObject) } }
                val actual = listOf(header(model)) + cards(model)
                assertEquals(expected.size, actual.size, "$place $page: blocks")
                expected.zip(actual).forEachIndexed { i, (e, a) -> assertEquals(e, a, "$place $page block ${if (i == 0) 0 else i + 1}") }
            }
        }
    }

    @Test
    fun rowsFollowTheTemplateConditions() {
        // Zero hides visibility, pressure, feels like and rain (truthiness); UV grade 0 still shows on S03 (!= undefined).
        val zero = record("kma-seoul").edit("currentWeather") {
            it + mapOf("visibility" to JsonPrimitive(0), "hPa" to JsonPrimitive(0), "sensorytem" to JsonPrimitive(0), "rn1" to JsonPrimitive(0),
                "dspls" to JsonPrimitive(61), "dsplsStr" to JsonPrimitive("보통"), "reh" to JsonPrimitive(0), "wdd" to kotlinx.serialization.json.JsonNull)
        }
        val rows = page(ForecastType.SHORT, zero, 1).detailWeather!!
        val images = rows.map { it.image.name }
        assertTrue("visibility.png" !in images && "pressure.png" !in images && "feels_like.png" !in images && "precipitation.png" !in images)
        assertEquals(listOf(TextRun("불쾌지수 보통 "), TextRun("(61)", RunStyle.SUB)), rows.single { it.image.name == "discomport_index.png" }.text)
        assertEquals("humidity_00.png", rows[2].image.name, "reh 0 uses the 00 image")
        assertEquals(listOf(TextRun("바람 2.3"), TextRun("m/s", RunStyle.SMALL)), rows.single { it.image.name == "wind.png" }.text, "null wdd collapses")

        // The pollen row opens the popup with the types present.
        val pollen = record("kma-seoul").edit("currentWeather") { cw ->
            cw + ("today" to JsonObject(cw["today"]!!.jsonObject + mapOf("pollenGrade" to JsonPrimitive(2), "pollenStr" to JsonPrimitive("높음"),
                "flowerPineGrade" to JsonPrimitive(2), "flowerPineStr" to JsonPrimitive("높음"))))
        }
        val row = page(ForecastType.SHORT, pollen, 1).detailWeather!!.single { it.pollen != null }
        assertEquals(listOf(TextRun("꽃가루 위험도: 높음")), row.text)
        assertEquals(listOf(PollenRow("LOC_POLLEN_PINE", "높음", "LOC_POLLEN_PINE_INFO", "LOC_POLLEN_ADVICE_2")), row.pollen!!.rows)

        // KHAI -1 hides its value; a string value fails its whole text (toFixed is not a function).
        val khai = record("kma-seoul").edit("currentWeather") { cw ->
            cw + ("arpltn" to JsonObject(cw["arpltn"]!!.jsonObject + mapOf("khaiValue" to JsonPrimitive(-1), "pm25Value" to JsonPrimitive("4"))))
        }
        val air = page(ForecastType.SHORT, khai, 1).detailAir!!
        assertEquals(listOf(TextRun("좋음", color = "#32a1ff")), air.single { it.label == "통합대기" }.text)
        assertEquals(listOf(TextRun("좋음", color = "#32a1ff")), air.single { it.label == "초미세먼지" }.text)
    }

    @Test
    fun aPlaceWithoutWeatherKeepsThePreviousPage() {
        val scope = scope(ForecastType.SHORT)
        scope.open(record("kma-seoul"), 2, false)
        scope.apply(record("vc-london").edit("currentWeather") { null }, false)
        val page = ForecastPage(scope, units, ko)
        assertEquals("런던", page.title)
        assertNull(page.hero, "no current weather: no header weather")
        assertEquals("어제보다 -2.3˚", page.detailWeather!![0].text.single().text, "Seoul's comparison stays (Cordova stops at the error)")
        assertEquals(Attribution.VISUAL_CROSSING, page.attribution)
    }

    private fun header(page: ForecastPage): List<String> {
        val hero = page.hero!!
        return listOfNotNull("text:${hero.temperature}", "text:˚", "img:${hero.sky.name}", "text:${hero.summary}", hero.summaryAir?.let { "text:$it" })
    }

    private fun cards(page: ForecastPage): List<List<String>> {
        val cards = mutableListOf<List<String>>()
        fun glyph(g: String, color: String?) = "glyph:$g" + (color?.let { "@$it" } ?: "")
        // An element's own text is trimmed in the captures; the space before a nested element is in the run.
        fun runs(runs: List<TextRun>) = runs.mapNotNull { r ->
            val t = r.text.trim()
            if (t.isEmpty()) null else when (r.style) {
                RunStyle.SMALL, RunStyle.SUB_SMALL -> "small:$t"
                RunStyle.SUB -> "sub:$t"
                else -> "text:$t" + (r.color?.let { "@$it" } ?: "")
            }
        }
        page.hourlyAqi?.let { cells ->
            cards += listOf("title:${page.hourlyAqiTitle}") + cells.flatMap { c ->
                listOf("text:${c.heading}", glyph(c.glyph, c.color), "text:${c.grade}" + (c.color?.let { "@$it" } ?: ""))
            }
        }
        page.currentAir?.let { cells ->
            cards += cells.flatMap { c ->
                listOf("text:${c.heading}", glyph(c.glyph, c.color), "text:${c.grade}" + (c.color?.let { "@$it" } ?: "")) + runs(c.value)
            }
        }
        page.detailWeather?.let { rows ->
            cards += listOf("title:${ko["LOC_DETAIL_WEATHER"]}") + rows.flatMap { r -> listOf("img:${r.image.name}") + runs(r.text) }
        }
        page.detailAir?.let { rows ->
            cards += listOf("title:${ko["LOC_DETAIL_AQI"]}") + rows.flatMap { r -> listOf("text:${r.label}", glyph(r.glyph, r.color)) + runs(r.text) }
        }
        page.dailyAqi?.let { aqi ->
            cards += listOf("title:${aqi.title}") + aqi.cells!!.flatMap { c ->
                listOf("text:${c.heading}", glyph(c.glyph, c.color), "text:${c.grade}" + (c.color?.let { "@$it" } ?: ""))
            }
        }
        page.dayDetails?.let { days ->
            cards += listOf("title:${ko["LOC_DETAIL_WEATHER"]}") + days.flatMap { d ->
                listOf("text:${d.title}") + d.rows.flatMap { r -> listOf("img:${r.image.name}") + runs(r.value) + "sub:${r.label}" }
            }
        }
        page.attribution?.let { cards += listOf("text:${Attribution.VISUAL_CROSSING_TEXT}") }
        return cards
    }

    /** A captured element as the model names it; colors only where the page sets a grade color. */
    private fun entry(e: JsonObject): String {
        val tag = e.str("tag")
        val cls = e.str("cls")
        val text = e.str("text")
        val color = rgbToHex(e.str("color"))
        return when {
            tag == "img" -> "img:" + e.str("src").substringAfterLast('/')
            tag == "i" && "material-icons" in cls -> "glyph:$text" + (color.takeIf { it != "#000000" && it != "#444444" }?.let { "@$it" } ?: "")
            cls == "card-title" -> "title:$text"
            tag == "small" -> "small:$text"
            "sub-text" in cls -> "sub:$text"
            else -> "text:$text" + (color.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: "")
        }
    }

    private fun page(type: ForecastType, city: JsonObject, cityCount: Int): ForecastPage {
        val scope = scope(type)
        scope.open(city, cityCount, false)
        return ForecastPage(scope, units, ko)
    }

    private fun scope(type: ForecastType) = ForecastScope(type, ChartMetrics(384.0, 832.0), fahrenheit = false, photoTheme = false,
        yesterday = YesterdayText(ko["LOC_SAME_AS_YESTERDAY"], ko["LOC_THAN_YESTERDAY"]), expandShortChart = false)

    /** The captures' places: the converted fixture with the saved place's own fields (forecast-reference/capture.mjs). */
    private fun record(fixture: String): JsonObject {
        val converted = WeatherConverter.convert(Json.parseToJsonElement(File(corpus, "inputs/$fixture.json").readText()))!!
        val own = if (fixture == "kma-seoul") mapOf("name" to "회현동", "address" to "대한민국 서울특별시 중구 회현동", "country" to "KR")
        else mapOf("name" to "런던", "address" to "영국 런던", "country" to "GB")
        return JsonObject(converted.filterValues { Js.truthy(it) } + own.mapValues { JsonPrimitive(it.value) } + ("currentPosition" to JsonPrimitive(false)))
    }

    private fun JsonObject.edit(key: String, change: (JsonObject) -> Map<String, JsonElement>?): JsonObject {
        val changed = change(this[key]!!.jsonObject)
        return JsonObject(if (changed == null) this - key else this + (key to JsonObject(changed)))
    }

    private fun catalog(dir: String): ChartTexts {
        val xml = File(System.getProperty("tw.projectDir"), "../app/src/main/res/$dir/client_strings.xml").readText()
        return ChartTexts(Regex("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>").findAll(xml).associate { m ->
            m.groupValues[1] to m.groupValues[2].replace("\\'", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        })
    }

    private fun rgbToHex(rgb: String): String {
        val n = Regex("\\d+").findAll(rgb).map { it.value.toInt() }.toList()
        return "#%02x%02x%02x".format(n[0], n[1], n[2])
    }

    private fun JsonObject.str(key: String): String = (this[key] as? JsonPrimitive)?.content ?: ""

    private companion object {
        val GRADE_COLORS = setOf("#32a1ff", "#00c73c", "#fd9b5a", "#ff5959")
    }
}
