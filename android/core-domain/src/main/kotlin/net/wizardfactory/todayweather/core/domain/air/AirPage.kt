package net.wizardfactory.todayweather.core.domain.air

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.forecast.AirRow
import net.wizardfactory.todayweather.core.domain.forecast.ForecastFormat
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.forecast.PageImage
import net.wizardfactory.todayweather.core.domain.forecast.RunStyle
import net.wizardfactory.todayweather.core.domain.forecast.TextRun

/**
 * The main box (`.main-box`): the [title] (대기상태 or the pollutant), the [value] (the overall grade, sized
 * `bigFontSize × 0.55` when [grade], else the pollutant's value at `bigFontSize`) with its [unit], in [color]; the
 * grade line ([lead] text, the face in [color], the [advice]) and the current weather, which opens S03.
 */
data class AirMain(
    val title: String,
    val value: String,
    val unit: String,
    val grade: Boolean,
    val color: String?,
    val lead: String,
    val glyph: String,
    val advice: String?,
    val weather: AirWeather,
)

/** The current weather of the main box: the sky image, `weather t1h` (raw) and the degree sign when there is weather. */
data class AirWeather(val image: PageImage, val text: String, val degree: Boolean)

/** A band of the gauge: its color (the top border), the grade's name and `~ ` its upper bound for the pollutant. */
data class AirBand(val color: String, val label: String, val bound: String)

/**
 * The gauge (`.air-std-table`): the standard's [bands] and the value label ([label] in [color], with its pointer)
 * placed by [labelPosition].
 */
data class AirGauge(val bands: List<AirBand>, val label: String, val color: String, private val grade: JsonElement?, private val value: JsonElement?,
                    private val code: String?, private val scope: AirScope) {
    /**
     * `getLabelPosition(airCodeGrade, airCodeValue)`: the label's left edge over a gauge [width] dp wide for a label
     * [labelWidth] dp wide (both whole dp, as `offsetWidth`; 0 counts as 52). 0 where the Cordova code fails or gives
     * NaN, which leaves the label at the left.
     */
    fun labelPosition(width: Double, labelWidth: Double): Double {
        val g = Js.number(grade?.takeIf { Js.present(it) })
        if (g.isNaN() || g != kotlin.math.floor(g) || code == null) return 0.0
        val x = AirQuality.labelPosition(scope.standard, code, g.toInt(), Js.number(value), width, if (labelWidth == 0.0) 52.0 else labelWidth)
        return if (x.isNaN()) 0.0 else x
    }
}

/** A cell of the daily, detail or station card: heading, the face and the text under it in [color]; [selected] has a gray background. */
data class AirCell(val heading: String, val glyph: String, val color: String?, val text: String, val selected: Boolean = false, val code: String? = null)

/**
 * What tab-air.html shows for an [AirScope], with TabCtrl's helpers: texts as AngularJS interpolates them (values as
 * they came, no rounding), then HTML white-space collapsing. [texts] are the translated catalog strings.
 */
class AirPage(private val scope: AirScope, private val texts: ChartTexts) {
    private val standard = scope.standard
    private val code = scope.aqiCode

    /** The bar title (`address`) and whether the current position's location glyph shows (unless loading). */
    val title: String = ForecastPage.collapse(Js.display(scope.address))
    val currentPosition: Boolean = Js.truthy(scope.currentPosition)
    val hasPush: Boolean = scope.hasPush == true

    /** The arrows beside the main box (`cityCount > 1`). */
    val arrows: Boolean = (scope.cityCount ?: 0) > 1

    /** The main box (`ng-if="airInfo"`). */
    val main: AirMain? = if (!Js.truthy(scope.airInfo)) null else {
        val cw = scope.currentWeather as? JsonObject
        AirMain(
            title = translate(scope.mainName),
            value = ForecastPage.collapse(Js.display(scope.mainInfo)),
            unit = AirQuality.codeUnit(code ?: "undefined"),
            grade = code == "aqi",
            color = color(scope.airCodeGrade, null),
            lead = ForecastPage.collapse(Js.display(scope.airCodeStr)),
            glyph = glyph(scope.airCodeGrade),
            advice = scope.airCodeActionGuide.takeIf { Js.truthy(it) }?.let { ForecastPage.collapse(Js.display(it)) },
            weather = AirWeather(
                image = PageImage(true, Js.display(cw?.get("skyIcon")) + ".png"),
                text = ForecastPage.collapse(Js.display(cw?.get("weather")) + " " + Js.display(cw?.get("t1h"))),
                degree = Js.truthy(scope.currentWeather),
            ),
        )
    }

    /** The gauge, always there (no bands without a standard). */
    val gauge: AirGauge = AirGauge(
        bands = standard?.grades?.map { g ->
            AirBand(g.color, translate(g.str), ForecastPage.collapse("~ " + (g.upperBound[code]?.let { Js.numberToString(it) } ?: "")))
        } ?: emptyList(),
        label = ForecastPage.collapse(Js.display(scope.airCodeValue)),
        color = AirQuality.gradeColor(standard, scope.airCodeGrade, "white"),
        grade = scope.airCodeGrade, value = scope.airCodeValue, code = code, scope = scope,
    )

    /** The hourly chart card's title (`airChart.data.length > 1`); null without the card. */
    val chartTitle: String? = scope.airChart?.takeIf { it.data.size > 1 }?.let { ForecastPage.collapse(translate(scope.hourlyChartTitle) + " (beta)") }

    /** The daily forecast card (`dayForecast.length`): the day and the face and grade text in the grade color, white without one. */
    val daily: List<AirCell>? = scope.dayForecast?.takeIf { it.isNotEmpty() }?.map { day ->
        val d = day as? JsonObject
        val grade = d?.get("grade")
        AirCell(ForecastPage.collapse(Js.display(ForecastFormat.dd(d?.get("date"))) + " " + dayLabel(d)), glyph(grade), color(grade, "white"),
            ForecastPage.collapse(Js.display(d?.get("str"))))
    }
    val dailyTitle: String = texts["LOC_DAILY_AQI_FORECAST"]

    /** The detail card (`aqiList.length > 1`): each pollutant; a tap selects it. */
    val detail: List<AirCell>? = scope.aqiList?.takeIf { it.size > 1 }?.map { item ->
        val o = item as JsonObject
        val grade = o["grade"]
        val name = (o["name"] as? JsonPrimitive)?.content
        AirCell(translate(name), glyph(grade), color(grade, null), ForecastPage.collapse(Js.display(o["value"])), selected = name == scope.airCodeName,
            code = (o["code"] as? JsonPrimitive)?.content)
    }
    val detailTitle: String = texts["LOC_DETAIL_AQI"]

    /** The info card (`airInfo.dataTime`): station, publication, standard (opens the units page), forecast and its source (O08). */
    val info: List<AirRow>? = if (!Js.truthy(scope.airInfo) || !Js.truthy((scope.airInfo as? JsonObject)?.get("dataTime"))) null else infoRows()

    /** The station card (`stnList`): each station; a tap selects it. */
    val stations: List<AirCell>? = scope.stnList?.mapIndexed { i, s ->
        val grade = s["grade"]
        AirCell(ForecastPage.collapse(Js.display(s["stationName"])), glyph(grade), color(grade, null),
            ForecastPage.collapse(Js.display(if (code == "aqi") s["str"] else s["value"])), selected = i == scope.stnIndex)
    }
    val stationsTitle: String = ForecastPage.collapse(texts["LOC_STATION"] + " (" + translate(scope.airCodeName) + ")")

    private fun infoRows(): List<AirRow> {
        val a = scope.airInfo as JsonObject
        val rows = mutableListOf<AirRow>()
        if (Js.truthy(a["stationName"])) rows += AirRow(texts["LOC_STATION"], ForecastPage.STATION, null, ForecastPage.runs(TextRun(Js.display(a["stationName"]))))
        if (Js.truthy(a["dataTime"])) rows += AirRow(texts["LOC_PUBLIC"], ForecastPage.TIME, null, ForecastPage.runs(TextRun(Js.display(a["dataTime"]))))
        rows += AirRow(texts["LOC_AIR_QUALITY_INDEX_UNIT"], ForecastPage.INFO, null,
            ForecastPage.runs(TextRun(translate(ForecastFormat.airUnitKey(scope.airUnit)) + " ", RunStyle.LINK), LINK_ARROW), PageAction.Units)
        if (Js.truthy(scope.forecastPubdate)) {
            rows += AirRow(texts["LOC_FORECAST"], ForecastPage.TIME, null, ForecastPage.runs(TextRun(Js.display(scope.forecastPubdate))))
        }
        val source = scope.forecastSource
        if (Js.truthy(source)) {
            val text = (source as? JsonPrimitive)?.takeIf { it.isString }?.content
            rows += AirRow(texts["LOC_AIR_FORECAST_SOURCE"], ForecastPage.INFO, null,
                ForecastPage.runs(TextRun((text?.uppercase() ?: "") + " ", RunStyle.LINK), LINK_ARROW), text?.let { PageAction.AirForecastInfo(it) })
        }
        return rows
    }

    /** `{{day.fromToday==0?getDayString(day.fromToday):dayToString(day.dayOfWeek)|translate}}`. */
    private fun dayLabel(d: JsonObject?): String = translate(
        if (Js.looseEquals(d?.get("fromToday"), 0.0)) ForecastFormat.dayString(d?.get("fromToday")) else ForecastFormat.dayName(d?.get("dayOfWeek"), full = false))

    /** The translate filter: a missing key shows itself; no key shows nothing. */
    private fun translate(key: String?): String = key?.let { texts[it] } ?: ""

    private fun glyph(grade: JsonElement?): String = ForecastPage.entity(AirQuality.sentimentIcon(scope.airUnit, grade))

    private fun color(grade: JsonElement?, default: String?): String? = AirQuality.gradeColor(standard, grade, default).takeIf { it.isNotEmpty() }

    companion object {
        private val LINK_ARROW = TextRun("", RunStyle.LINK_ARROW)

        /** The translation keys S05 reads, for the app to load from its catalog. */
        val KEYS = listOf(
            "LOC_AIR_STATUS", "LOC_AQI", "LOC_PM25", "LOC_PM10", "LOC_O3", "LOC_NO2", "LOC_SO2", "LOC_CO",
            "LOC_HOURLY_AQI_FORECAST", "LOC_HOURLY_AQI_INFORMATION", "LOC_DAILY_AQI_FORECAST", "LOC_DETAIL_AQI", "LOC_STATION", "LOC_PUBLIC",
            "LOC_AIR_QUALITY_INDEX_UNIT", "LOC_AIR_QUALITY_INDEX_KR", "LOC_AIR_QUALITY_INDEX_KR_WHO", "LOC_AIR_QUALITY_INDEX_US",
            "LOC_AIR_QUALITY_INDEX_CN", "LOC_FORECAST", "LOC_AIR_FORECAST_SOURCE", "LOC_GOOD", "LOC_MODERATE",
            "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS", "LOC_UNHEALTHY", "LOC_VERY_UNHEALTHY", "LOC_HAZARDOUS", "LOC_TODAY",
            "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT", "LOC_HOUR",
            "LOC_KAQ_DESCRIPTION", "LOC_AIRKOREA_DESCRIPTION", "LOC_CLOSE",
        )
    }
}
