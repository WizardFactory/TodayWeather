package net.wizardfactory.todayweather.core.domain.air

import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.forecast.RunStyle

/**
 * AirPage against the Cordova S05 itself: the text, images and grade colors of every block tools/air-reference captured
 * from the Cordova build in seven states, the value label's position at the captured widths, and the template rules
 * the captures do not reach.
 */
class AirPageTest {
    @Test
    fun pagesShowWhatTheCordovaPageShows() {
        for (state in AirReferences.STATES) {
            val capture = AirReferences.capture(state)
            val blocks = capture["blocks"]!!.jsonArray.map { it.jsonObject }
            val page = AirPage(AirReferences.scope(state), AirReferences.ko)
            val expected = blocks.map { b -> b["elements"]!!.jsonArray.mapNotNull { entry(it.jsonObject) } }
            val actual = blocks(page)
            assertEquals(expected.size, actual.size, "$state: blocks")
            expected.zip(actual).forEachIndexed { i, (e, a) -> assertEquals(e, a, "$state block $i") }
            assertEquals(AirReferences.scope(state).cityCount?.let { it > 1 } ?: false, page.arrows, "$state: arrows")
        }
    }

    @Test
    fun theLabelSitsWhereTheCordovaPagePutItAtTheCapturedWidths() {
        for (state in AirReferences.STATES) {
            val gauge = AirReferences.capture(state)["gauge"]!!.jsonObject
            val page = AirPage(AirReferences.scope(state), AirReferences.ko)
            val left = gauge["left"]!!.jsonPrimitive.content.removeSuffix("px").toDouble()
            assertEquals(left, page.gauge.labelPosition(gauge["width"]!!.jsonPrimitive.double, gauge["labelWidth"]!!.jsonPrimitive.double), 1e-9, state)
        }
    }

    @Test
    fun cellsSelectAndLinksOpenTheirPages() {
        val page = AirPage(AirReferences.scope("kma-seoul-station-1"), AirReferences.ko)
        assertEquals(listOf(false, true, false), page.stations!!.map { it.selected })
        assertEquals(listOf(true, false, false, false, false, false, false), page.detail!!.map { it.selected })
        assertEquals(listOf("aqi", "pm25", "pm10", "o3", "no2", "co", "so2"), page.detail!!.map { it.code })
        val info = page.info!!
        assertEquals(PageAction.Units, info.single { it.label == "대기환경기준" }.action)
        assertEquals(PageAction.AirForecastInfo("airkorea"), info.single { it.label == "예보자료" }.action)
        assertEquals(RunStyle.LINK_ARROW, info.single { it.label == "예보자료" }.text.last().style, "the link arrow")
        assertEquals("측정소 (통합대기)", page.stationsTitle)
        val pm25 = AirPage(AirReferences.scope("kma-seoul-pm25"), AirReferences.ko)
        assertEquals("측정소 (초미세먼지)", pm25.stationsTitle)
        assertEquals(listOf("12", "4", "11"), pm25.stations!!.map { it.text }, "a pollutant's stations show its values")
        assertEquals(false, pm25.main!!.grade, "a pollutant's value is set at the full size")
        assertEquals(true, AirPage(AirReferences.scope("kma-seoul"), AirReferences.ko).main!!.grade)
    }

    @Test
    fun valuesShowAsTheyCameAndZeroOnlyInTheStationsAsADash() {
        // Tokyo under airnow: so2 0 and the decimals as sent (no toFixed).
        val tokyo = AirScope(ChartMetrics(384.0, 832.0), "airnow", TimeZone.getTimeZone("Asia/Seoul"))
        tokyo.open(AirReferences.record("vc-tokyo", "도쿄", "일본 도쿄", "JP"), "so2", 1, false)
        val page = AirPage(tokyo, AirReferences.ko)
        assertEquals("0", page.main!!.value)
        assertEquals("ppm", page.main!!.unit)
        assertEquals("0", page.gauge.label)
        assertEquals(listOf("31", "5.98", "7.65", "0.034", "0.013", "0.209", "0"), page.detail!!.map { it.text })
        assertEquals(6, page.gauge.bands.size, "airnow has six grades")
        assertEquals("~ 0.75", page.gauge.bands[1].bound, "A17 kept")
        assertNull(page.stations, "no stations overseas")
        assertNull(page.chartTitle)
        assertNull(page.daily)
        // A station whose value is 0 shows "-" there; the main box shows 0.
        val zero = AirScope(ChartMetrics(384.0, 832.0), "airkorea", TimeZone.getTimeZone("Asia/Seoul"))
        zero.open(AirReferences.set(AirReferences.seoul(), listOf("airInfoList", 0, "last", "pm25Value"), JsonPrimitive(0)), "pm25", 1, false)
        val zeroPage = AirPage(zero, AirReferences.ko)
        assertEquals("0", zeroPage.main!!.value)
        assertEquals(listOf("-", "4", "11"), zeroPage.stations!!.map { it.text })
    }

    @Test
    fun aPlaceWithoutAirShowsOnlyTheScaleOnAFreshVisitAndKeepsTheLastAirAfterASwipe() {
        val fresh = AirPage(AirReferences.scope("kma-jeju-no-air"), AirReferences.ko)
        assertNull(fresh.main)
        assertNull(fresh.chartTitle)
        assertNull(fresh.daily)
        assertNull(fresh.detail)
        assertNull(fresh.info)
        assertNull(fresh.stations)
        assertEquals(4, fresh.gauge.bands.size)
        assertEquals("", fresh.gauge.label)
        assertEquals("연동", fresh.title)
        // A swipe from Seoul's second station to it changes only the title and the station (the apply stops at the
        // missing observation): the rest is Seoul's.
        val scope = AirReferences.scope("kma-seoul-station-1")
        scope.applyEvent(AirReferences.noAir(), 2, false)
        val swiped = AirPage(scope, AirReferences.ko)
        assertEquals("연동", swiped.title)
        assertEquals("좋음", swiped.main!!.value)
        assertEquals("47", swiped.gauge.label, "한강대로's value stays")
        assertEquals(listOf(true, false, false), swiped.stations!!.map { it.selected }, "the first station is selected again")
    }

    private fun blocks(page: AirPage): List<List<String>> {
        val blocks = mutableListOf<List<String>>()
        fun glyph(g: String, color: String?) = "glyph:$g" + (color?.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: "")
        fun text(t: String, color: String? = null) = if (t.isEmpty()) null else "text:$t" + (color?.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: "")
        val m = page.main
        blocks += if (m == null) emptyList() else listOfNotNull(
            text(m.title), text(m.value, m.color), text(m.unit, m.color), text(m.lead), glyph(m.glyph, m.color), m.advice?.let { text(it) },
            "img:${m.weather.image.name}", text(m.weather.text), if (m.weather.degree) "text:˚" else null,
        )
        blocks += listOfNotNull(text(page.gauge.label, page.gauge.color)) + page.gauge.bands.flatMap { listOfNotNull(text(it.label), text(it.bound)) }
        page.chartTitle?.let { blocks += listOf("title:$it") }
        page.daily?.let { cells -> blocks += listOf("title:${page.dailyTitle}") + cells.flatMap { cell(it) } }
        page.detail?.let { cells -> blocks += listOf("title:${page.detailTitle}") + cells.flatMap { cell(it) } }
        page.info?.let { rows ->
            blocks += rows.flatMap { r -> listOfNotNull(text(r.label), glyph(r.glyph, r.color)) + r.text.filter { it.style != RunStyle.LINK_ARROW }.mapNotNull { text(it.text.trim()) } }
        }
        page.stations?.let { cells -> blocks += listOf("title:${page.stationsTitle}") + cells.flatMap { cell(it) } }
        return blocks
    }

    private fun cell(c: AirCell): List<String> =
        listOfNotNull("text:${c.heading}", "glyph:${c.glyph}" + (c.color?.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: ""),
            c.text.takeIf { it.isNotEmpty() }?.let { "text:$it" + (c.color?.takeIf { col -> col in GRADE_COLORS }?.let { col -> "@$col" } ?: "") })

    /** A captured element as the model names it; the chart's SVG is AirChartTest's. */
    private fun entry(e: JsonObject): String? {
        val tag = e.str("tag")
        val cls = e.str("cls")
        val text = e.str("text")
        val color = rgbToHex(e.str("color"))
        return when {
            tag == "svg" || tag == "text" || tag == "tspan" -> null
            tag == "img" -> "img:" + e.str("src").substringAfterLast('/')
            tag == "i" && "material-icons" in cls -> "glyph:$text" + (color.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: "")
            cls == "card-title" -> "title:$text"
            else -> "text:$text" + (color.takeIf { it in GRADE_COLORS }?.let { "@$it" } ?: "")
        }
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
