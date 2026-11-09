package net.wizardfactory.todayweather.core.domain.air

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.chart.D3

/**
 * The SVG ngAirChart (client/www/js/app.js L1552-L1704) draws for S05's hourly series in a [width] × [height] dp area:
 * an x axis [bottom] dp from the top with a tick at the middle of each date's band ([ticks]) and its line from
 * [domainStart] to [domainEnd], then a bar per slot ([bars]), which covers the axis where it stands. A series with a
 * slot the apply did not reach draws nothing (the directive stops at it): [domainStart] is null and there are no ticks
 * or bars.
 */
data class AirChart(
    val width: Double,
    val height: Double,
    val bottom: Double,
    val ticks: List<Tick>,
    val domainStart: Double?,
    val domainEnd: Double?,
    val bars: List<Bar>,
) {
    /**
     * A tick at [x]: a 6 dp line down from the axis, which for the 13th date (the current hour) reaches up to the top
     * of the chart 2 dp wide ([current]); its [label] (the hour every three hours, else empty) 9 dp under the axis
     * with `dy` 0.71 em, and under 0시 the [date] (`MM.DD`) 1.065 em lower.
     */
    data class Tick(val x: Double, val label: String, val date: String?, val current: Boolean)

    /** A bar of a slot: [fill] its grade color (null: the class color); [current] the current hour (`chart-bar`). */
    data class Bar(val x: Double, val y: Double, val width: Double, val height: Double, val fill: String?, val current: Boolean)

    companion object {
        /** Margins of the directive: top -5, right 5, bottom 35, left 5. */
        private const val SIDE = 5.0
        private const val BOTTOM = 35.0
        private const val TOP = -5.0

        /** The chart of [series] with the colors of [standard]; [hour] is `LOC_HOUR` (`strHour`). */
        fun build(series: AirSeries, standard: AirStandard?, hour: String, width: Double, height: Double = 100.0): AirChart {
            val bottom = height - BOTTOM
            val slots = series.data
            if (slots.any { it == null || it == JsonNull }) return AirChart(width, height, bottom, emptyList(), null, null, emptyList())
            // d3.max(data, d => d.val + d.val/10): an undefined value is NaN and skipped, null counts as 0. A standard
            // maximum raises it (Math.max: NaN when no slot has a value).
            var max = D3.max(slots.map { it.value().let { v -> v + v / 10 } })
            val std = series.maxValue
            if (std != null && std != 0.0 && !std.isNaN()) max = max?.let { maxOf(std, it) } ?: Double.NaN
            val y = D3.Linear(0.0, max, bottom, TOP)
            val dates = slots.map { Js.string((it as? JsonObject)?.get("date")) }
            // An ordinal domain keeps each date once, in order; the bands share the width between them.
            val domain = dates.distinct()
            val band = D3.band(SIDE, width - SIDE, domain.size)
            val ticks = domain.mapIndexed { i, date ->
                val hourOfDay = parseInt(date.substring(minOf(11, date.length), minOf(13, date.length)))
                val shown = hourOfDay == 0.0 || (!hourOfDay.isNaN() && hourOfDay % 3 == 0.0)
                Tick(
                    x = SIDE + band * i + band / 2,
                    label = if (shown) Js.numberToString(hourOfDay) + hour else "",
                    date = if (hourOfDay == 0.0) date.substring(minOf(5, date.length), minOf(7, date.length)) + "." +
                        date.substring(minOf(8, date.length), minOf(10, date.length)) else null,
                    current = i == 12,
                )
            }
            val bars = slots.mapIndexed { i, slot ->
                val row = slot as? JsonObject
                val v = row?.get("val")
                val top = if (Js.present(v)) y(Js.number(v)) else y(0.0)
                val color = AirQuality.gradeColor(standard, row?.get("grade"), null)
                Bar(
                    x = band * i + 1 + SIDE,
                    y = top,
                    width = band - 2,
                    height = if (Js.present(v)) y(0.0) - y(Js.number(v)) else 0.0,
                    fill = color.ifEmpty { null },
                    current = i == 12,
                )
            }
            return AirChart(width, height, bottom, ticks, SIDE, width - SIDE, bars)
        }

        /** `d.val` as the arithmetic reads it (the server sends numbers): NaN for undefined, 0 for null. */
        private fun JsonElement?.value(): Double = when (val v = (this as? JsonObject)?.get("val")) {
            null -> Double.NaN
            else -> Js.number(v)
        }

        /** JavaScript `parseInt(s)`: leading white space, a sign and the digits before anything else; NaN without digits. */
        private fun parseInt(s: String): Double {
            val m = Regex("""^\s*([+-]?)(\d+)""").find(s) ?: return Double.NaN
            val n = m.groupValues[2].toDouble()
            return if (m.groupValues[1] == "-") -n else n
        }
    }
}
