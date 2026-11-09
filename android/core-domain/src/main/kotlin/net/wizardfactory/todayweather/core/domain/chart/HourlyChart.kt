package net.wizardfactory.todayweather.core.domain.chart

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.ChartPosition
import net.wizardfactory.todayweather.core.domain.Js

/** Translated catalog strings of the charts (`LOC_*` keys); a missing key shows itself, as `$translate` does. */
class ChartTexts(private val strings: Map<String, String>) {
    operator fun get(key: String): String = strings[key] ?: key
}

/** A day label of the hourly header: [left] edge in dp from the start of the scrolling content. */
data class DayLabel(val text: String, val left: Double)

/**
 * The hourly forecast chart of the Cordova forecast tab (`tab-forecast.html` with `ngShortChart` and
 * `ngShortDetailChart` in app.js): the header (day and hour labels), the temperature chart, the pinned
 * legend, the detail rows and the opening scroll offset. [width] is `timeWidth`.
 */
data class HourlyChart(
    val columnWidth: Double,
    val width: Double,
    val dayLabels: List<DayLabel>,
    val hourLabels: List<String>,
    val chart: Svg,
    val detail: Svg,
    val legendToday: String,
    val legendYesterday: String,
    val openingOffset: Double,
) {
    companion object {
        const val WEATHER_IMAGES = "img/weather_default"
        const val ICON_IMAGES = "img/icons_default"

        /**
         * Builds the chart for a converted place (WeatherConverter: `timeTable`, `timeChart`,
         * `currentWeather`), with the unit labels of the units settings.
         */
        fun build(place: JsonObject, metrics: ChartMetrics, texts: ChartTexts, precipUnit: String, windUnit: String): HourlyChart {
            val timeTable = place["timeTable"] as? JsonArray ?: JsonArray(emptyList())
            val timeChart = place["timeChart"] as JsonArray
            val current = place["currentWeather"] as? JsonObject ?: JsonObject(emptyMap())
            val c = metrics.columnWidth
            val width = c * timeTable.size
            val today = timeChart[1].jsonObjectOrEmpty()
            val dic = Js.number(today["displayItemCount"])
            return HourlyChart(
                columnWidth = c,
                width = width,
                dayLabels = dayLabels(timeTable, c, texts),
                // Angular's `value.time + strHour` drops an undefined operand.
                hourLabels = timeTable.map { t -> t.jsonObjectOrEmpty()["time"].let { if (it == null) "" else Js.string(it) } + texts["LOC_HOUR"] },
                chart = chart(timeChart, current, metrics, width, metrics.hourlyChartHeight(dic), precipUnit),
                detail = detail(timeChart, metrics, width, metrics.detailChartHeight, windUnit),
                legendToday = texts["LOC_THIS_DAY_TEMP"],
                legendYesterday = texts["LOC_PREVIOUS_DAY_TEMP"],
                openingOffset = ChartPosition.todayOffset("short", metrics.bodyWidth, place),
            )
        }

        /** `isNextDay` and `getDayPosition` (controller.forecastctrl.js), not in the last two columns. */
        private fun dayLabels(timeTable: JsonArray, c: Double, texts: ChartTexts): List<DayLabel> {
            val labels = mutableListOf<DayLabel>()
            var previousDate: JsonElement? = null
            timeTable.forEachIndexed { index, element ->
                if (index >= timeTable.size - 2) return@forEachIndexed
                val value = element.jsonObjectOrEmpty()
                val date = value["date"]
                if (Js.looseEquals(value["time"], 24.0) && index == 0) return@forEachIndexed
                if (Js.present(previousDate) && Js.looseEquals(previousDate, date)) return@forEachIndexed
                previousDate = date
                val day = Js.number(value["fromToday"])
                val key = if (day >= -3 && day <= 3) DAY_FROM_TODAY[(day + 3).toInt()] else DAY_FROM_TODAY.last()
                val d = Js.string(date)
                val left = c / 2 + (if (Js.greater(value["time"], 0.0)) index - 1 else index) * c
                labels += DayLabel(texts[key] + " " + substr(d, 4, 2) + "." + substr(d, 6, 2), left)
            }
            return labels
        }

        private val DAY_FROM_TODAY = listOf("LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY",
            "LOC_TODAY", "LOC_TOMORROW", "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY")

        /** `ngShortChart`. */
        private fun chart(timeChart: JsonArray, current: JsonObject, metrics: ChartMetrics, width: Double, height: Double,
                          precipUnit: String): Svg {
            val series = timeChart.map { it.jsonObjectOrEmpty() }
            val today = series[1]
            var dic = Js.number(today["displayItemCount"])
            if (dic.isNaN() || dic == 0.0) dic = 3.0
            val tableHeight = metrics.shortTableHeight(dic)
            val marginTop = 12 + tableHeight
            val textTop = 5 - tableHeight
            val marginBottom = 12.0
            val s = metrics.iconSize
            val values = series.map { (it["values"] as? JsonArray ?: JsonArray(emptyList())).map { v -> v.jsonObjectOrEmpty() } }
            val band = D3.band(0.0, width, values[0].size)
            val ci = Js.number(today["currentIndex"])

            val currentTime = current["time"]
            val currentTemp = d3Value(current["t1h"])
            val liveTime = current["liveTime"]
            val sharp = (liveTime == JsonNull || Js.looseEquals(JsonPrimitive(Js.string(currentTime) + "00"), liveTime)) &&
                Js.number(currentTime) % 3 == 0.0

            val y = D3.Linear(
                D3.min(values.map { list -> D3.min(list.map { d3Value(it.value()["t3h"]) }).lessThan(currentTemp) }),
                D3.max(values.map { list -> D3.max(list.map { d3Value(it.value()["t3h"]) }).greaterThan(currentTemp) }),
                height - marginBottom, marginTop,
            )

            val nodes = mutableListOf<SvgNode>()
            nodes += SvgRect("current-rect", band * ci + band / 2 + 0.5, 0.0, band - 0.5, height)
            values[1].forEachIndexed { i, d ->
                val x = band * i + band / 2 + 0.5
                nodes += SvgLine(guideClass(d), x, 0.0, x, height)
            }
            values[1].forEachIndexed { i, d ->
                if (i == 0) return@forEachIndexed // the first column's table is removed
                val v = d.value()
                val precip = listOf("rn1", "s06", "r06").firstOrNull { Js.truthy(v[it]) }?.let { v[it] }
                var subY = 12.0
                if (dic >= 1) subY += s
                if (dic >= 2) subY += 15
                nodes += SvgGroup("hourly-table", listOf(
                    SvgImage(null, "$WEATHER_IMAGES/${Js.string(v["skyIcon"])}.png", band * i - s / 2, 0.0, s, s),
                    SvgText("chart-text", band * i, if (dic >= 1) s + 12 else null, null, text(v["pop"]), Tspan("%", "chart-unit-text")),
                    SvgText("chart-sub-text", band * i, subY - 3, null, precipText(precip),
                        Tspan(if (precip != null) precipUnit else "", "chart-unit-text")),
                ))
            }
            series.forEachIndexed { k, s1 ->
                val name = Js.string(s1["name"])
                val list = values[k]
                // The line gets the current temperature between the current and the next column (not on the hour).
                val linePoints = list.map { scaleInput(it.value()["t3h"]) }.toMutableList()
                val cv = if (name == "today") current else (current["yesterday"] as? JsonObject)
                if (!sharp) linePoints.add(spliceIndex(ci + 1, linePoints.size), scaleInput(cv?.get("t1h")))
                val path = linePoints.mapIndexed { i, t ->
                    val x = when {
                        !sharp && i.toDouble() == ci + 1 -> band * i - band / 2 + band / 2
                        !sharp && i > ci + 1 -> band * (i - 1) + band / 2
                        else -> band * i + band / 2
                    }
                    x to y(t)
                }
                val circles = list.mapIndexed { i, d -> SvgCircle("circle-$name", band * i + band / 2, y(scaleInput(d.value()["t3h"])), 10.0) }
                val pointY = if (name == "today") y(scaleInput(current["t1h"])) else if (name == "yesterday") y(scaleInput((current["yesterday"] as? JsonObject)?.get("t1h"))) else Double.NaN
                val point = SvgCircle("point circle-$name-current", band * (ci + if (sharp) 0.0 else 0.5) + band / 2, pointY, if (sharp) 10.0 else 5.0)
                val labels = list.mapIndexed { i, d ->
                    val t3h = scaleInput(d.value()["t3h"])
                    SvgText(if (sharp && i.toDouble() == ci + 1) "text-$name-current" else "text-$name",
                        band * i + band / 2, y(t3h) - marginBottom + textTop, marginTop, Js.numberToString(Js.round(t3h)))
                }
                nodes += SvgGroup("line-group", listOf(
                    SvgPath("line line-$name", path),
                    SvgGroup("line-point", circles),
                    point,
                    SvgGroup("line-value", labels),
                ))
            }
            return Svg(width, height, nodes)
        }

        /** `ngShortDetailChart`. */
        private fun detail(timeChart: JsonArray, metrics: ChartMetrics, width: Double, height: Double, windUnit: String): Svg {
            val margin = 12.0
            val textTop = 12.0
            val s = metrics.iconSize
            val series = timeChart.map { it.jsonObjectOrEmpty() }
            val values = series.map { (it["values"] as? JsonArray ?: JsonArray(emptyList())).map { v -> v.jsonObjectOrEmpty() } }
            val band = D3.band(0.0, width, values[0].size)
            val ci = Js.number(series[1]["currentIndex"])
            val nodes = mutableListOf<SvgNode>()
            nodes += SvgRect("current-rect", band * ci + band / 2 + 0.5, 0.0, band - 0.5, height)
            values[1].forEachIndexed { i, d ->
                val x = band * i + band / 2 + 0.5
                nodes += SvgLine(guideClass(d), x, 0.0, x, margin)
            }
            values[1].forEachIndexed { i, d ->
                val v = d.value()
                val cx = band * i + band / 2
                val reh = if (Js.truthy(v["reh"])) Js.number(v["reh"]).let { Js.numberToString(it - it % 10) } else "00"
                nodes += SvgGroup("hourly-table", listOf(
                    SvgImage(null, "$ICON_IMAGES/wind_direction.png", cx - s / 2, margin / 2, s, s,
                        Rotation(angle(v["vec"]), cx, (margin + s) / 2)),
                    SvgText("chart-text", cx, margin / 2 + s + textTop, null, text(v["wsd"]), Tspan(windUnit, "chart-unit-text")),
                    SvgImage(null, "$ICON_IMAGES/humidity_$reh.png", cx - s / 2, margin / 2 + s + textTop + margin, s, s),
                    SvgText("chart-text", cx, margin / 2 + s * 2 + textTop + margin + textTop, null, text(v["reh"]), Tspan("%", "chart-unit-text")),
                ))
            }
            return Svg(width, height, nodes)
        }

        private fun guideClass(d: JsonObject): String = if (strictNumber(d.value()["time"], 24.0)) "guide-vivid-line" else "guide-line"

        /** `rn1`, `s06` or `r06` as the chart shows it: rounded from 10 up. */
        internal fun precipText(value: JsonElement?): String {
            if (value == null) return ""
            val n = Js.number(value)
            return if (n >= 10) Js.numberToString(Js.round(n)) else text(value)
        }

        private fun angle(vec: JsonElement?): Double = if (vec == null || vec == JsonNull) Double.NaN else Js.number(vec)
    }
}

/** A value object's `value` (timeChart entries are `{name, value}`). */
private fun JsonObject.value(): JsonObject = this["value"].jsonObjectOrEmpty()

internal fun JsonElement?.jsonObjectOrEmpty(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())

/** A value as `d3.min`/`d3.max` see it: null for undefined and null, which they skip. */
internal fun d3Value(e: JsonElement?): Double? = if (e == null || e == JsonNull) null else Js.number(e)

/** A value as a D3 scale sees it: ToNumber (undefined: NaN, null: 0). */
internal fun scaleInput(e: JsonElement?): Double = Js.number(e)

/** `textContent` of a D3 `.text(v)`: null and undefined give "", anything else JavaScript ToString. */
internal fun text(e: JsonElement?): String = if (e == null || e == JsonNull) "" else Js.string(e)

/** `a === b` for a number literal. */
internal fun strictNumber(e: JsonElement?, b: Double): Boolean =
    e is JsonPrimitive && !e.isString && e.content != "true" && e.content != "false" && e.content.toDoubleOrNull() == b

/** `minT3h < currentTemp ? minT3h : currentTemp` (undefined compares false). */
private fun Double?.lessThan(other: Double?): Double? = if (this != null && other != null && this < other) this else other

private fun Double?.greaterThan(other: Double?): Double? = if (this != null && other != null && this > other) this else other

/** `String.prototype.substr(start, length)`. */
internal fun substr(s: String, start: Int, length: Int): String =
    if (start >= s.length) "" else s.substring(start, minOf(s.length, start + length))

/** `Array.prototype.splice` start index for [start] in a list of [size]. */
private fun spliceIndex(start: Double, size: Int): Int = when {
    start.isNaN() -> 0
    start < 0 -> maxOf(size + start.toInt(), 0)
    else -> minOf(start.toInt(), size)
}
