package net.wizardfactory.todayweather.core.domain.air

import java.util.TimeZone
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics

/**
 * AirChart against the SVG ngAirChart drew on the Cordova build in the captured S05 states (air-reference): every
 * tick, label, date and bar within 0.02 dp, with the grade fills; then D3's rules the captures do not reach.
 */
class AirChartTest {
    private val tolerance = 0.02

    @Test
    fun scenesMatchTheCordovaCharts() {
        var compared = 0
        for (state in AirReferences.STATES) {
            val chart = AirReferences.capture(state)["chart"]?.takeIf { it != JsonNull }?.jsonObject
            val scope = AirReferences.scope(state)
            if (chart == null) {
                assertNull(AirPage(scope, AirReferences.ko).chartTitle, "$state: no chart")
                continue
            }
            val rect = chart["rect"]!!.jsonObject
            val scene = AirChart.build(scope.airChart!!, scope.standard, AirReferences.ko["LOC_HOUR"], rect.num("width"), rect.num("height"))
            compare(scene, chart["scene"]!!.jsonObject, state)
            compared++
        }
        assertEquals(5, compared)
    }

    @Test
    fun theOrdinalScaleKeepsEachDateOnceAndTheBarsFollowTheSlots() {
        // A repeated date takes one band: 23 bands for 24 slots, and the bars still step by slot.
        val rows = (0 until 24).map { i -> row("2026-11-08 ${"%02d".format(if (i == 5) 4 else i)}:00", 10.0 + i, 1) }
        val chart = AirChart.build(AirSeries(rows, 250.0), AirQuality.standard("airkorea"), "시", 383.0)
        assertEquals(23, chart.ticks.size)
        val band = (383.0 - 10) / 23
        near(5 + band / 2, chart.ticks[0].x, "first tick")
        near(band * 23 + 1 + 5, chart.bars[23].x, "the last bar passes the last band")
        assertTrue(chart.ticks[12].current, "the 13th date has the long line")
        assertEquals("0시", chart.ticks[0].label)
        assertEquals("11.08", chart.ticks[0].date)
        assertEquals("", chart.ticks[1].label)
        assertEquals("3시", chart.ticks[3].label)
    }

    @Test
    fun withoutValuesTheScaleIsUndefinedAndNoBarShows() {
        val rows = (0 until 24).map { i -> buildJsonObject { put("date", "2026-11-08 ${"%02d".format(i)}:00") } }
        val chart = AirChart.build(AirSeries(rows, 250.0), AirQuality.standard("airkorea"), "시", 384.0)
        assertTrue(chart.bars.all { it.height == 0.0 && it.y.isNaN() }, "Math.max(250, undefined) is NaN: y(0) is NaN")
        assertTrue(chart.bars.all { it.fill == null })
        // Null values count as 0: a bar of height 0 at the axis.
        val nulls = rows.map { JsonObject(it.jsonObject + ("val" to JsonNull)) }
        val zero = AirChart.build(AirSeries(nulls, 250.0), AirQuality.standard("airkorea"), "시", 384.0)
        assertTrue(zero.bars.all { it.y == 65.0 && it.height == 0.0 })
    }

    @Test
    fun aSlotTheApplyDidNotReachDrawsNothing() {
        val scope = AirScope(ChartMetrics(384.0, 832.0), "airkorea", TimeZone.getTimeZone("Asia/Seoul"))
        scope.open(AirReferences.set(AirReferences.seoul(), listOf("airInfoList", 0, "last", "dataTime"), JsonPrimitive("2026-11-10 00:00")), null, 1, false)
        val chart = AirChart.build(scope.airChart!!, scope.standard, "시", 384.0)
        assertEquals(emptyList(), chart.ticks)
        assertEquals(emptyList(), chart.bars)
        assertNull(chart.domainStart)
    }

    private fun row(date: String, value: Double, grade: Int) = buildJsonObject {
        put("date", date)
        put("val", value)
        put("grade", grade)
    }

    private fun compare(scene: AirChart, svg: JsonObject, where: String) {
        near(svg.num("width"), scene.width, "$where width")
        near(svg.num("height"), scene.height, "$where height")
        val children = svg["children"]!!.jsonArray.map { it.jsonObject }
        val axis = children[0]
        assertEquals("x-axis", axis.str("class"), where)
        assertEquals("translate(0,${num(scene.bottom)})", axis.str("transform"), "$where axis")
        val parts = axis["children"]!!.jsonArray.map { it.jsonObject }
        val ticks = parts.filter { it.str("class") == "tick" }
        assertEquals(ticks.size, scene.ticks.size, "$where ticks")
        ticks.zip(scene.ticks).forEachIndexed { i, (e, t) ->
            val at = "$where tick $i"
            val x = Regex("""translate\(([^,]+),0\)""").find(e.str("transform")!!)!!.groupValues[1].toDouble()
            near(x, t.x, "$at x")
            val (line, text) = e["children"]!!.jsonArray.map { it.jsonObject }
            assertEquals("6", line.str("y2"), at)
            assertEquals(if (t.current) num(-scene.bottom) else null, line.str("y1"), "$at long line")
            assertEquals(if (t.current) "2px" else null, line.str("stroke-width"), "$at stroke")
            assertEquals("9", text.str("y"), at)
            assertEquals(".71em", text.str("dy"), at)
            assertEquals(t.label, text.str("text"), "$at label")
            val tspans = text["tspans"]!!.jsonArray.map { it.jsonObject }
            assertEquals(t.date, tspans.singleOrNull()?.str("text"), "$at date")
            tspans.singleOrNull()?.let { assertEquals("1.065em", it.str("dy"), at); assertEquals("0", it.str("x"), at) }
        }
        val domain = parts.single { it.str("class") == "domain" }
        assertEquals("M${num(scene.domainStart!!)},0V0H${num(scene.domainEnd!!)}V0", domain.str("d"), "$where domain")
        val rects = children.drop(1)
        assertEquals(rects.size, scene.bars.size, "$where bars")
        rects.zip(scene.bars).forEachIndexed { i, (e, b) ->
            val at = "$where bar $i"
            assertEquals(if (b.current) "chart-bar" else "chart-blurry-bar", e.str("class"), at)
            near(e.num("x"), b.x, "$at x")
            near(e.num("y"), b.y, "$at y")
            near(e.num("width"), b.width, "$at width")
            near(e.num("height"), b.height, "$at height")
            assertEquals(e.str("style"), b.fill?.let { "fill: ${rgb(it)};" }, "$at fill")
        }
    }

    private fun near(expected: Double, actual: Double, what: String) {
        if (expected.isNaN() || actual.isNaN()) {
            if (expected.isNaN() != actual.isNaN()) fail("$what: expected $expected, got $actual")
            return
        }
        if (abs(expected - actual) > tolerance) fail("$what: expected $expected, got $actual")
    }

    /** A number as the SVG attribute prints it. */
    private fun num(d: Double): String = if (d == kotlin.math.floor(d)) d.toLong().toString() else d.toString()

    private fun rgb(hex: String): String {
        val v = hex.removePrefix("#").toInt(16)
        return "rgb(${v shr 16 and 255}, ${v shr 8 and 255}, ${v and 255})"
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.content
    private fun JsonObject.num(key: String): Double = str(key)?.toDoubleOrNull() ?: Double.NaN
}
