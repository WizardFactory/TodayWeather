package net.wizardfactory.todayweather.core.domain.chart

import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.WeatherConverter

/**
 * The chart scenes against the Cordova charts captured on the emulator (chart-reference/<WxH>/<fixture>.json,
 * written by android/tools/chart-reference/capture.sh): every SVG element with its class, attributes and
 * text, the header labels, the legend and the opening scroll offsets, for every captured fixture and size.
 */
class ChartSceneTest {
    private val resources = File(javaClass.getResource("/chart-reference")!!.toURI())
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val texts = catalog("values-ko") // the emulator ran in ko-KR (capture.json)

    /** Positions in the captures went through Chrome's layout (1/128 px) and attribute printing. */
    private val tolerance = 0.02

    @Test
    fun scenesMatchTheCordovaCharts() {
        val sizes = resources.listFiles()!!.filter { it.isDirectory }.sortedBy { it.name }
        assertEquals(listOf("360x780", "384x832", "412x892"), sizes.map { it.name })
        var compared = 0
        for (dir in sizes) {
            val (w, h) = dir.name.split("x").map { it.toDouble() }
            val capture = Json.parseToJsonElement(File(dir, "capture.json").readText()).jsonObject
            assertEquals("ko-KR", capture["env"]!!.jsonObject["language"]!!.jsonPrimitive.content)
            for (name in capture["fixtures"]!!.jsonArray.map { it.jsonPrimitive.content }) {
                val record = Json.parseToJsonElement(File(dir, "$name.json").readText()).jsonObject
                val place = WeatherConverter.convert(input(record))!!
                val metrics = ChartMetrics(w, h)
                val where = "${dir.name} $name"
                checkHourly(HourlyChart.build(place, metrics, texts, "mm", "m/s"), record["hourly"]!!.jsonObject, where)
                checkDaily(DailyChart.build(place, metrics, texts, "mm"), record["daily"]!!.jsonObject, where)
                compared++
            }
        }
        assertEquals(15, compared, "fixtures x sizes")
    }

    private fun checkHourly(chart: HourlyChart, captured: JsonObject, where: String) {
        compareSvg(chart.chart, captured["scene"]!!.jsonObject, "$where hourly")
        compareSvg(chart.detail, captured["detailScene"]!!.jsonObject, "$where detail")
        val days = captured["dayTitles"]!!.jsonArray.map { it.jsonObject }
        assertEquals(days.map { it.text() }, chart.dayLabels.map { it.text }, "$where day labels")
        days.zip(chart.dayLabels).forEach { (e, a) -> near(e.num("x"), a.left, "$where day label ${a.text}") }
        assertEquals(captured["hourTitles"]!!.jsonArray.map { it.jsonObject.text() }, chart.hourLabels, "$where hour labels")
        val legend = captured["legend"]!!.jsonObject
        assertEquals(legend["today"]!!.jsonObject.text(), chart.legendToday, "$where legend")
        assertEquals(legend["yesterday"]!!.jsonObject.text(), chart.legendYesterday, "$where legend")
        val scroll = captured["scroll"]!!.jsonObject
        // scrollLeft is a whole CSS pixel in the capture.
        assertTrue(abs(scroll.num("left") - chart.openingOffset) < 1, "$where opening offset ${chart.openingOffset} vs ${scroll.num("left")}")
    }

    private fun checkDaily(chart: DailyChart, captured: JsonObject, where: String) {
        compareSvg(chart.chart, captured["scene"]!!.jsonObject, "$where daily")
        assertEquals(captured["dayNames"]!!.jsonArray.map { it.jsonObject.text() }, chart.dayNames, "$where day names")
        assertEquals(captured["dates"]!!.jsonArray.map { it.jsonObject.text() }, chart.dates, "$where dates")
        val scroll = captured["scroll"]!!.jsonObject
        assertTrue(abs(scroll.num("left") - chart.openingOffset) < 1, "$where opening offset ${chart.openingOffset} vs ${scroll.num("left")}")
    }

    // ---------------------------------------------------------------- SVG comparison

    private fun compareSvg(svg: Svg, captured: JsonObject, where: String) {
        near(captured.num("width"), svg.width, "$where svg width")
        near(captured.num("height"), svg.height, "$where svg height")
        compareChildren(svg.children, captured["children"]?.jsonArray ?: JsonArray(emptyList()), where)
    }

    private fun compareChildren(nodes: List<SvgNode>, captured: JsonArray, where: String) {
        assertEquals(captured.size, nodes.size, "$where: element count (${captured.map { it.jsonObject["tag"] }})")
        nodes.zip(captured.map { it.jsonObject }).forEachIndexed { i, (node, e) -> compareNode(node, e, "$where/$i") }
    }

    private fun compareNode(node: SvgNode, e: JsonObject, where: String) {
        val tag = e.str("tag")
        val at = "$where<$tag ${e.str("class")}>"
        when (node) {
            is SvgGroup -> { assertEquals("g", tag, at); assertEquals(e.str("class"), node.cls, at); compareChildren(node.children, e["children"]?.jsonArray ?: JsonArray(emptyList()), at) }
            is SvgRect -> {
                assertEquals("rect", tag, at); assertEquals(e.str("class"), node.cls, at)
                near(e.num("x"), node.x, "$at x"); near(e.num("y"), node.y, "$at y")
                near(e.num("width"), node.width, "$at width"); near(e.num("height"), node.height, "$at height")
            }
            is SvgLine -> {
                assertEquals("line", tag, at); assertEquals(e.str("class"), node.cls, at)
                near(e.num("x1"), node.x1, "$at x1"); near(e.num("y1"), node.y1, "$at y1")
                near(e.num("x2"), node.x2, "$at x2"); near(e.num("y2"), node.y2, "$at y2")
            }
            is SvgImage -> {
                assertEquals("image", tag, at); assertEquals(e.str("class"), node.cls, at); assertEquals(e.str("href"), node.href, at)
                near(e.num("x"), node.x, "$at x"); near(e.num("y"), node.y, "$at y")
                near(e.num("width"), node.width, "$at width"); near(e.num("height"), node.height, "$at height")
                val transform = e.str("transform")
                if (node.rotation == null) assertEquals(null, transform, at) else {
                    val parts = Regex("""^rotate\((.*), (.*), (.*)\)$""").find(transform!!)!!.groupValues.drop(1).map { it.toDoubleOrNull() ?: Double.NaN }
                    near(parts[0], node.rotation.angle, "$at angle"); near(parts[1], node.rotation.cx, "$at cx"); near(parts[2], node.rotation.cy, "$at cy")
                }
            }
            is SvgText -> {
                assertEquals("text", tag, at); assertEquals(e.str("class"), node.cls, at)
                near(e.num("x"), node.x, "$at x")
                if (node.y == null) assertEquals(null, e.str("y"), "$at y") else near(e.num("y"), node.y, "$at y")
                if (node.dy == null) assertEquals(null, e.str("dy"), "$at dy") else near(e.num("dy"), node.dy, "$at dy")
                assertEquals(e.str("text"), node.text, "$at text")
                val tspans = e["tspans"]?.jsonArray?.map { it.jsonObject } ?: emptyList()
                assertEquals(tspans.size, if (node.tspan == null) 0 else 1, "$at tspans")
                tspans.firstOrNull()?.let { t ->
                    assertEquals(t.str("text"), node.tspan!!.text, "$at tspan text")
                    assertEquals(t.str("class"), node.tspan.cls, "$at tspan class")
                    assertEquals(t.str("font-size"), node.tspan.fontSizeAttr, "$at tspan font-size")
                }
            }
            is SvgPath -> {
                assertEquals("path", tag, at); assertEquals(e.str("class"), node.cls, at)
                val points = e.str("d")!!.removePrefix("M").removeSuffix("Z").split("L").map { p ->
                    p.split(",").map { it.toDoubleOrNull() ?: Double.NaN }.let { it[0] to it[1] }
                }
                assertEquals(points.size, node.points.size, "$at points")
                points.zip(node.points).forEachIndexed { i, (p, q) -> near(p.first, q.first, "$at point $i x"); near(p.second, q.second, "$at point $i y") }
            }
            is SvgCircle -> {
                assertEquals("circle", tag, at); assertEquals(e.str("class"), node.cls, at)
                near(e.num("cx"), node.cx, "$at cx"); near(e.num("cy"), node.cy, "$at cy"); near(e.num("r"), node.r, "$at r")
            }
        }
    }

    /** Within [tolerance]; NaN (a JavaScript NaN or undefined, or an absent attribute) only equals NaN. */
    private fun near(expected: Double, actual: Double, what: String) {
        if (expected.isNaN() || actual.isNaN()) {
            if (expected.isNaN() != actual.isNaN()) fail("$what: expected $expected, got $actual")
            return
        }
        if (abs(expected - actual) > tolerance) fail("$what: expected $expected, got $actual")
    }

    // ---------------------------------------------------------------- inputs

    /** The response the capture showed: the corpus input, with the patch named in the record (capture.mjs). */
    private fun input(record: JsonObject): JsonElement {
        val case = Json.parseToJsonElement(File(corpus, "conversion/${record.str("from")}.json").readText()).jsonObject
        var input = case["input"] ?: Json.parseToJsonElement(File(corpus, case.str("inputFile")!!).readText())
        if (record.str("fixture") == "kma-seoul-sharp") {
            val current = JsonObject(input.jsonObject["current"]!!.jsonObject + ("liveTime" to JsonPrimitive("2400")))
            input = JsonObject(input.jsonObject + ("current" to current))
        } else {
            assertEquals("false", record["patched"]!!.jsonPrimitive.content, "unknown patch for ${record.str("fixture")}")
        }
        return input
    }

    /** The imported Cordova catalog (android/app/src/main/res), as GoldenCorpusTest reads it. */
    private fun catalog(dir: String): ChartTexts {
        val xml = File(System.getProperty("tw.projectDir"), "../app/src/main/res/$dir/client_strings.xml").readText()
        val strings = Regex("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>").findAll(xml).associate { m ->
            m.groupValues[1] to m.groupValues[2].replace("\\'", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        }
        return ChartTexts(strings)
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.content
    private fun JsonObject.num(key: String): Double = str(key)?.toDoubleOrNull() ?: Double.NaN
    private fun JsonObject.text(): String = str("text")!!
}
