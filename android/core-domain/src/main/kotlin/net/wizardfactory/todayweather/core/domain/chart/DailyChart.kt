package net.wizardfactory.todayweather.core.domain.chart

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.domain.ChartPosition
import net.wizardfactory.todayweather.core.domain.Js

/**
 * The daily forecast chart of the Cordova daily tab (`tab-dailyforecast.html` with `ngMidChart` in app.js):
 * weekday and date header, the chart and the opening scroll offset. [width] is `dayWidth`.
 */
data class DailyChart(
    val columnWidth: Double,
    val width: Double,
    val dayNames: List<String>,
    val dates: List<String>,
    val chart: Svg,
    val openingOffset: Double,
) {
    companion object {
        fun build(place: JsonObject, metrics: ChartMetrics, texts: ChartTexts, precipUnit: String): DailyChart {
            val dayChart = (place["dayChart"] as JsonArray)[0].jsonObjectOrEmpty()
            val values = (dayChart["values"] as? JsonArray ?: JsonArray(emptyList())).map { it.jsonObjectOrEmpty() }
            val c = metrics.columnWidth
            val width = if (c * values.size < metrics.bodyWidth) metrics.bodyWidth else c * values.size
            val height = metrics.dailyChartHeight(Js.number(dayChart["displayItemCount"]))
            return DailyChart(
                columnWidth = c,
                width = width,
                dayNames = values.map { v -> DAY_NAMES.getOrNull(Js.number(v["dayOfWeek"]).let { if (it.isNaN()) -1 else it.toInt() })?.let { texts[it] } ?: "" },
                dates = values.map { v -> v["date"].let { if (Js.present(it)) substr(Js.string(it), 6, 2) else "" } },
                chart = chart(dayChart, values, metrics, width, height, precipUnit),
                openingOffset = ChartPosition.todayOffset("mid", metrics.bodyWidth, place),
            )
        }

        private val DAY_NAMES = listOf("LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT")

        private fun chart(dayChart: JsonObject, values: List<JsonObject>, metrics: ChartMetrics, width: Double, height: Double,
                          precipUnit: String): Svg {
            val marginTop = 18 + metrics.midTableHeight(Js.number(dayChart["displayItemCount"]))
            val marginBottom = 18.0
            val textTop = 5.0
            val s = metrics.iconSize
            val band = D3.band(0.0, width, values.size)
            val y = D3.Linear(D3.min(values.map { d3Value(it["tmn"]) }), D3.max(values.map { d3Value(it["tmx"]) }), height - marginBottom, marginTop)
            val todayIndex = values.indexOfFirst { strictNumber(it["fromToday"], 0.0) }

            val nodes = mutableListOf<SvgNode>()
            nodes += SvgRect("current-rect", if (todayIndex >= 0) band * todayIndex else 0.0, 0.0, band - 0.5, height)
            nodes += SvgGroup("bar-group", values.indices.map { i -> SvgLine("guide-line", band * i + 0.5, 0.0, band * i + 0.5, height) } +
                values.mapIndexed { i, d ->
                    SvgRect("chart-bar", band * i + band / 2 - 1, y(scaleInput(d["tmx"])), 2.0, y(scaleInput(d["tmn"])) - y(scaleInput(d["tmx"])))
                })
            values.forEachIndexed { i, d ->
                val am = d["skyAm"]
                val pm = d["skyPm"]
                val x = band * i + (band - s) / 2
                val sameOrMissing = Js.looseEquals(am, pm) || !Js.present(am) || !Js.present(pm)
                val iconsBottom = s + if (sameOrMissing) s / 3 else s
                val popShown = Js.greaterOrEqual(d["fromToday"], 0.0) && Js.truthy(d["pop"])
                val precip = listOf("rn1", "s06", "r06").firstOrNull { Js.truthy(d[it]) }?.let { d[it] }
                val children = mutableListOf<SvgNode>()
                if (Js.present(am)) {
                    children += SvgImage("skyAm", "${HourlyChart.WEATHER_IMAGES}/${Js.string(am)}.png", x,
                        2 + if (Js.looseEquals(am, pm) || !Js.present(pm)) s / 3 else 0.0, s, s)
                }
                if (!(Js.looseEquals(am, pm) || !Js.present(pm))) {
                    children += SvgImage("skyPm", "${HourlyChart.WEATHER_IMAGES}/${Js.string(pm)}.png", x,
                        if (!Js.present(am)) 2 + s / 3 else s, s, s)
                }
                children += SvgText("chart-text", band * i + band / 2, iconsBottom + 14, null,
                    if (popShown) text(d["pop"]) else "", Tspan(if (popShown) "%" else "", "chart-unit-text"))
                // The tspan's class went to a font-size attribute (app.js), so the unit is 13 px like its text.
                children += SvgText("chart-sub-text", band * i + band / 2, iconsBottom + 2 + (if (popShown) 15 else 0) + 10, null,
                    HourlyChart.precipText(precip), Tspan(if (precip != null) precipUnit else "", fontSizeAttr = "chart-unit-text"))
                nodes += SvgGroup("day-table", children)
            }
            nodes += SvgGroup("bar-max-value", values.mapIndexed { i, d ->
                SvgText("chart-text", band * i + band / 2, y(scaleInput(d["tmx"])) - marginTop - textTop, marginTop,
                    Js.numberToString(Js.round(scaleInput(d["tmx"]))) + "˚")
            })
            nodes += SvgGroup("bar-min-value", values.mapIndexed { i, d ->
                SvgText("chart-text", band * i + band / 2, y(scaleInput(d["tmn"])), marginBottom,
                    Js.numberToString(Js.round(scaleInput(d["tmn"]))) + "˚")
            })
            nodes += SvgCircle("circle circle-today-current", if (todayIndex >= 0) band * todayIndex + band / 2 else 0.0,
                y(scaleInput(dayChart["temp"])), 5.0)
            return Svg(width, height, nodes)
        }
    }
}
