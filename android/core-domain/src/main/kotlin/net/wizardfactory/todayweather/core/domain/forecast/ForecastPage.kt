package net.wizardfactory.todayweather.core.domain.forecast

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.ForecastText
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts

/** The unit settings the weather pages show (`Units.getUnit`). */
data class PageUnits(
    val temperature: String?, val windSpeed: String?, val pressure: String?, val distance: String?,
    val precipitation: String?, val air: String?,
)

/**
 * How a piece of a row's text is set: the row's font, `<small>` (0.8 em), `.sub-text` (13 px, #666), `<small>` in it, a
 * link, or the arrow after a link (`.colgroup-box a:after`, the Ionicons glyph U+F3D3).
 */
enum class RunStyle { PLAIN, SMALL, SUB, SUB_SMALL, LINK, LINK_ARROW }

/** A piece of a row's text; [color] is a grade color (`grade2Color`), null for the row's own color. */
data class TextRun(val text: String, val style: RunStyle = RunStyle.PLAIN, val color: String? = null)

/** An image from the theme's folders: a weather image (`weatherImgPath`) or an icon (`iconsImgPath`), by file name. */
data class PageImage(val weather: Boolean, val name: String)

/** What tapping a part of a weather page opens. */
sealed interface PageAction {
    /** S05 for a pollutant (`goAirInfoPage(code)`). */
    data class AirInfo(val code: String) : PageAction

    /** The units page (`goUnitsPage()`). */
    data object Units : PageAction

    /** The air forecast source's description (`popUpAirForecastInfo(source)`). */
    data class AirForecastInfo(val source: String) : PageAction

    /** The pollen popup (`showPollenInfo(currentWeather.today)`). */
    data class Pollen(val rows: List<PollenRow>) : PageAction

    /** An outside page (`openUrl`). */
    data class Url(val url: String) : PageAction
}

/** A pollen type of the pollen popup: translation keys and the grade text as `showPollenInfo` builds them. */
data class PollenRow(val labelKey: String, val gradeLabel: String, val infoKey: String, val adviceKey: String)

/** The header block's weather (`.main-box`): temperature, sky image and the summary lines. */
data class Hero(val temperature: String, val sky: PageImage, val summary: String, val summaryAir: String?)

/** A cell of an AQI table: heading, the sentiment glyph in the grade color, the grade text and a value under it. */
data class AqiCell(
    val heading: String, val glyph: String, val color: String?, val grade: String,
    val value: List<TextRun> = emptyList(), val action: PageAction? = null,
)

/** A row of the detail weather card (S03): an image and its text; the pollen row is a button. */
data class WeatherRow(val image: PageImage, val text: List<TextRun>, val pollen: PageAction.Pollen? = null)

/** A row of the detail AQI card (S03): label, then a glyph (in the grade color) and its text. */
data class AirRow(val label: String, val glyph: String, val color: String?, val text: List<TextRun>, val action: PageAction? = null)

/** A day of the daily detail card (S04): the calendar title and the rows under it. */
data class DayCell(val title: String, val rows: List<DayRow>)

/** A row of a day: image, value and the label under the value. */
data class DayRow(val image: PageImage, val value: List<TextRun>, val label: String)

/** A row of the legacy daily dust table (S04, `dailyAqiForecast` undefined): the day and its pollutant cells. */
data class DustRow(val weekday: String, val date: String, val dayString: String, val cells: List<AqiCell>)

/** The daily AQI card (S04): the forecast list, or the legacy rows at positions 7 and 8 of the daily chart. */
data class DailyAqi(val title: String, val cells: List<AqiCell>?, val legacyRows: List<DustRow>?)

enum class Attribution(val url: String) {
    DARK_SKY("https://darksky.net/poweredby"),
    VISUAL_CROSSING("https://www.visualcrossing.com/");

    companion object {
        const val VISUAL_CROSSING_TEXT = "Weather Data Provided by Visual Crossing"
    }
}

/**
 * What the weather page templates show for a [ForecastScope]: tab-forecast.html (S03) and tab-dailyforecast.html (S04)
 * with TabCtrl's helpers. Texts are as the WebView renders them: AngularJS interpolation, then HTML white-space
 * collapsing. [texts] are the translated catalog strings.
 */
class ForecastPage(private val scope: ForecastScope, private val units: PageUnits, private val texts: ChartTexts) {
    private val standard = AirQuality.standard(units.air)
    private val cw = scope.currentWeather as? JsonObject
    private val today = cw?.get("today") as? JsonObject
    private val arpltn = cw?.get("arpltn") as? JsonObject
    private val showArpltn = Js.truthy(scope.currentWeather) && Js.truthy(arpltn) && Js.truthy(arpltn?.get("dataTime"))

    /** The bar title (`address`) and whether the current position's location glyph shows (unless loading). */
    val title: String = collapse(Js.display(scope.address))
    val currentPosition: Boolean = Js.truthy(scope.currentPosition)
    val hasPush: Boolean = scope.hasPush == true

    /** The arrows beside the header (`cityCount > 1`). */
    val arrows: Boolean = (scope.cityCount ?: 0) > 1

    val hero: Hero? = if (!Js.truthy(scope.currentWeather)) null else Hero(
        temperature = collapse(scope.temp(cw?.get("t1h"))),
        sky = PageImage(true, Js.display(cw?.get("skyIcon")) + ".png"),
        summary = collapse(Js.display(scope.summary)),
        summaryAir = scope.summaryAir?.takeIf { Js.truthy(it) }?.let { collapse(Js.display(it)) },
    )

    /** S03's chart block (`ng-if="timeWidth"`); S04's chart is always there. */
    val showChart: Boolean = scope.type == ForecastType.MID || scope.timeWidth.let { it != null && it != 0.0 && !it.isNaN() }

    val hourlyAqiTitle: String = texts["LOC_HOURLY_AQI_FORECAST"] + " (beta)"
    val detailWeatherTitle: String = texts["LOC_DETAIL_WEATHER"]
    val detailAirTitle: String = texts["LOC_DETAIL_AQI"]

    /** The hourly AQI forecast card (S03), more than one row. */
    val hourlyAqi: List<AqiCell>? = if (scope.type != ForecastType.SHORT || !scope.showDetailWeather || !scope.showHourlyAqiForecast()) null
    else scope.hourlyAqiForecast!!.map { row ->
        val o = row as? JsonObject
        val grade = o?.get("grade")
        val date = o?.get("date")
        AqiCell(
            heading = if (date is JsonPrimitive && date.isString) collapse(substr(date.content, 11, 2) + texts["LOC_HOUR"]) else "",
            glyph = glyph(grade), color = color(grade),
            grade = collapse(o?.get("str").let { if (!Js.present(it)) "-" else Js.display(it) }),
            action = PageAction.AirInfo("aqi"),
        )
    }

    /** The current air card (S03) in place of the hourly forecast: PM2.5, PM10 and AQI, each when it has a value. */
    val currentAir: List<AqiCell>? = if (scope.type != ForecastType.SHORT || !scope.showDetailWeather || scope.showHourlyAqiForecast() ||
        !showArpltn) null
    else listOf("pm25" to "LOC_PM25", "pm10" to "LOC_PM10", "aqi" to "LOC_AQI").filter { (code) -> Js.truthy(arpltn!!["${code}Value"]) }
        .map { (code, label) ->
            val grade = arpltn!!["${code}Grade"]
            val value = fixed(arpltn["${code}Value"], 0)
            AqiCell(
                heading = texts[label], glyph = glyph(grade), color = color(grade), grade = collapse(Js.display(arpltn["${code}Str"])),
                value = if (value == null) emptyList() else if (code == "aqi") listOf(TextRun(value, RunStyle.SUB))
                else listOf(TextRun(value, RunStyle.SUB), TextRun("㎍/㎥", RunStyle.SUB_SMALL)),
                action = PageAction.AirInfo(code),
            )
        }

    /** The detail weather card (S03). */
    val detailWeather: List<WeatherRow>? = if (scope.type != ForecastType.SHORT || !scope.showDetailWeather) null else weatherRows()

    /** The detail AQI card (S03). */
    val detailAir: List<AirRow>? = if (scope.type != ForecastType.SHORT || !scope.showDetailWeather || !showArpltn) null else airRows()

    /** The daily AQI card (S04, `hasDustForecast()`). */
    val dailyAqi: DailyAqi? = if (scope.type != ForecastType.MID || !scope.hasDustForecast()) null else dailyAqi()

    /** The daily detail card (S04, `ng-if="dayChart"`): yesterday, today and tomorrow. */
    val dayDetails: List<DayCell>? = if (scope.type != ForecastType.MID || !Js.truthy(scope.dayChart)) null else dayCells()

    /** The provider attribution under the cards; S03 waits for the first apply, S04 does not. */
    val attribution: Attribution? = if (scope.type == ForecastType.SHORT && !scope.showDetailWeather) null else when {
        Js.looseEquals(scope.source, JsonPrimitive("DSF")) -> Attribution.DARK_SKY
        Js.looseEquals(scope.source, JsonPrimitive("VC")) -> Attribution.VISUAL_CROSSING
        else -> null
    }

    private fun weatherRows(): List<WeatherRow> {
        val rows = mutableListOf<WeatherRow>()
        fun icon(name: String) = PageImage(false, name)
        fun get(key: String) = cw?.get(key)
        if (Js.present(get("weatherType"))) {
            rows += WeatherRow(PageImage(true, Js.display(get("skyIcon")) + ".png"), runs(TextRun(texts["LOC_WEATHER"] + " " + Js.display(get("weather")))))
        }
        rows += WeatherRow(icon("temp_50.png"), runs(TextRun(scope.diffTempStr ?: "")))
        rows += WeatherRow(icon("humidity_${humidityBucket(get("reh"))}.png"),
            runs(TextRun(texts["LOC_HUMIDITY"] + " " + Js.display(get("reh"))), TextRun("%", RunStyle.SMALL)))
        rows += WeatherRow(icon("wind.png"), runs(TextRun(texts["LOC_WIND"] + " " + Js.display(get("wdd")) + " " + Js.display(get("wsd"))),
            TextRun(units.windSpeed.orEmpty(), RunStyle.SMALL)))
        if (Js.greater(get("visibility"), 0.0)) {
            rows += WeatherRow(icon("visibility.png"), runs(TextRun(texts["LOC_VISIBILITY"] + " " + Js.display(get("visibility"))),
                TextRun(units.distance.orEmpty(), RunStyle.SMALL)))
        }
        if (Js.truthy(get("hPa"))) {
            rows += WeatherRow(icon("pressure.png"), runs(TextRun(texts["LOC_PRESSURE"] + " " + Js.display(get("hPa"))),
                TextRun(units.pressure.orEmpty(), RunStyle.SMALL)))
        }
        if (Js.truthy(get("dspls")) && Js.greater(get("dspls"), 60.0)) {
            rows += WeatherRow(icon("discomport_index.png"), runs(TextRun(texts["LOC_DISCOMFORT_INDEX"] + " " + Js.display(get("dsplsStr")) + " "),
                TextRun("(" + Js.display(get("dspls")) + ")", RunStyle.SUB)))
        }
        if (Js.truthy(get("sensorytem"))) {
            rows += WeatherRow(icon("feels_like.png"), runs(TextRun(texts["LOC_FEELS_LIKE"] + " " + scope.temp(get("sensorytem")) + "˚")))
        }
        if (Js.truthy(get("rn1"))) {
            rows += WeatherRow(icon("precipitation.png"), runs(TextRun(texts["LOC_HOURLY_PRECIPITATION"] + " " + Js.display(get("rn1"))),
                TextRun(units.precipitation.orEmpty(), RunStyle.SMALL)))
        }
        if (Js.present(today?.get("ultrvGrade"))) {
            rows += WeatherRow(icon("ultrv.png"), runs(TextRun(texts["LOC_UV"] + " " + Js.display(today?.get("ultrvStr")) + " "),
                TextRun("(" + Js.display(today?.get("ultrv")) + ")", RunStyle.SUB)))
        }
        if (Js.present(today?.get("pollenGrade"))) {
            rows += WeatherRow(icon("pollen.png"), runs(TextRun(texts["LOC_POLLEN_RISK"] + ": " + Js.display(today?.get("pollenStr")))),
                pollen = PageAction.Pollen(ForecastFormat.pollenRows(today)!!))
        }
        if (Js.present(today?.get("fsnGrade"))) {
            rows += WeatherRow(icon("food_poisoning.png"), runs(TextRun(texts["LOC_FOOD_POISONING"] + " " + Js.display(today?.get("fsnStr")))))
        }
        for ((key, label, image) in listOf(Triple("sunrise", "LOC_SUNRISE", "sunrise.png"), Triple("sunset", "LOC_SUNSET", "sunset.png"))) {
            val value = today?.get(key)
            if (Js.truthy(value)) {
                // `sunrise.split(' ')[1]`: the time of "YYYY.MM.DD HH:MM"; anything but a string fails the whole text.
                val time = (value as? JsonPrimitive)?.takeIf { it.isString }?.let { texts[label] + " " + (it.content.split(" ").getOrNull(1) ?: "") }
                rows += WeatherRow(icon(image), runs(TextRun(time ?: "")))
            }
        }
        rows += WeatherRow(icon("time.png"), runs(TextRun(scope.updateTime ?: "")))
        return rows
    }

    private fun airRows(): List<AirRow> {
        val a = arpltn!!
        val rows = mutableListOf<AirRow>()
        for (code in listOf("pm25", "pm10", "o3", "no2", "co", "so2")) {
            if (!Js.present(a["${code}Value"])) continue
            val grade = a["${code}Grade"]
            val pm = code == "pm25" || code == "pm10"
            val value = fixed(a["${code}Value"], if (pm) 0 else 3)
            val station = a["${code}StationName"].let { if (Js.truthy(it)) " " + Js.display(it) else "" }
            rows += AirRow(texts[AirQuality.codeName(code)], glyph(grade), color(grade), runs(
                TextRun(Js.display(a["${code}Str"]) + " ", color = color(grade)),
                TextRun(if (value == null) "" else "(" + value + (if (pm) "㎍/㎥" else "ppm") + station + ")", RunStyle.SUB),
            ))
        }
        if (Js.present(a["khaiValue"])) {
            val grade = a["khaiGrade"]
            val khai = a["khaiValue"]
            val shown = Js.truthy(khai) && !Js.looseEquals(khai, -1.0)
            rows += AirRow(texts["LOC_AQI"], glyph(grade), color(grade), runs(
                TextRun(Js.display(a["khaiStr"]) + " ", color = color(grade)),
                TextRun(if (shown) fixed(khai, 0)?.let { "($it)" } ?: "" else "", RunStyle.SUB),
            ))
        }
        if (Js.truthy(a["stationName"])) rows += AirRow(texts["LOC_STATION"], STATION, null, runs(TextRun(Js.display(a["stationName"]))))
        if (Js.truthy(a["dataTime"])) rows += AirRow(texts["LOC_PUBLIC"], TIME, null, runs(TextRun(Js.display(a["dataTime"]))))
        rows += AirRow(texts["LOC_AIR_QUALITY_INDEX_UNIT"], INFO, null,
            runs(TextRun(ForecastFormat.airUnitKey(units.air)?.let { texts[it] }.orEmpty() + " ", RunStyle.LINK), LINK_ARROW_RUN), PageAction.Units)
        if (Js.truthy(scope.airForecastPubdate)) {
            rows += AirRow(texts["LOC_FORECAST"], TIME, null, runs(TextRun(Js.display(scope.airForecastPubdate))))
        }
        val source = scope.airForecastSource
        if (Js.truthy(source)) {
            val text = (source as? JsonPrimitive)?.takeIf { it.isString }?.content
            rows += AirRow(texts["LOC_AIR_FORECAST_SOURCE"], INFO, null, runs(TextRun((text?.uppercase() ?: "") + " ", RunStyle.LINK), LINK_ARROW_RUN),
                text?.let { PageAction.AirForecastInfo(it) })
        }
        return rows
    }

    private fun dailyAqi(): DailyAqi {
        val list = scope.dailyAqiForecast
        val cells = if (Js.truthy(list) && list is JsonArray && list.isNotEmpty()) list.map { day ->
            val d = day as? JsonObject
            val grade = d?.get("grade")
            AqiCell(heading = collapse(Js.display(ForecastFormat.dd(d?.get("date"))) + " " + dayLabel(d)), glyph = glyph(grade),
                color = color(grade), grade = collapse(Js.display(d?.get("str"))), action = PageAction.AirInfo("aqi"))
        } else null
        val values = (scope.dayChart as? JsonArray)?.firstOrNull()?.let { it as? JsonObject }?.get("values")
        val legacy = if (list == null && Js.truthy(values) && values is JsonArray) values.mapIndexedNotNull { i, day ->
            val d = day as? JsonObject ?: return@mapIndexedNotNull null
            val dust = d["dustForecast"]
            if ((i != 7 && i != 8) || !Js.truthy(dust)) return@mapIndexedNotNull null
            dust as? JsonObject
            val cells = listOf("pm25" to "LOC_PM25", "pm10" to "LOC_PM10", "o3" to "LOC_O3")
                .filter { (code) -> code != "o3" || Js.present((dust as? JsonObject)?.get("o3Grade")) }
                .map { (code, label) ->
                    val grade = (dust as? JsonObject)?.get("${code}Grade")
                    AqiCell(texts[label], glyph(grade), color(grade), collapse(Js.display((dust as? JsonObject)?.get("${code}Str"))),
                        action = PageAction.AirInfo(code))
                }
            val date = d["date"]
            DustRow(
                weekday = translate(ForecastFormat.dayName(d["dayOfWeek"], full = true)),
                date = if (date is JsonPrimitive && date.isString) substr(date.content, 6, 2) else "",
                dayString = translate(ForecastFormat.dayString(d["fromToday"])),
                cells = cells,
            )
        } else null
        return DailyAqi(texts["LOC_DAILY_AQI_FORECAST"], cells, legacy)
    }

    private fun dayCells(): List<DayCell> {
        val values = (scope.dayChart as? JsonArray)?.firstOrNull()?.let { it as? JsonObject }?.get("values") as? JsonArray ?: return emptyList()
        val pop = scope.hasPropertyInThreeDays(listOf("pop"))
        val uv = scope.hasPropertyInThreeDays(listOf("ultrvGrade"))
        val rain = scope.hasPropertyInThreeDays(listOf("pty", "rn1", "r06", "s06"))
        return values.filter { scope.checkDailyDetailWeather(it) }.map { day ->
            val d = day as JsonObject
            val rows = mutableListOf<DayRow>()
            fun icon(name: String) = PageImage(false, name)
            if (Js.truthy(d["reh"])) {
                rows += DayRow(icon("humidity_${humidityBucket(d["reh"])}.png"), runs(TextRun(Js.display(d["reh"])), TextRun("%", RunStyle.SMALL)),
                    texts["LOC_HUMIDITY"])
            }
            if (Js.truthy(d["wsd"])) {
                rows += DayRow(icon("wind.png"), runs(TextRun(Js.display(d["wsd"])), TextRun(units.windSpeed.orEmpty(), RunStyle.SMALL)), texts["LOC_WIND"])
            }
            if (pop) {
                rows += DayRow(icon("umbrella.png"), runs(TextRun(Js.display(d["pop"])), TextRun("%", RunStyle.SMALL)),
                    texts["LOC_PROBABILITY_OF_PRECIPITATION"])
            }
            if (uv) {
                rows += DayRow(icon("ultrv.png"), runs(TextRun(Js.display(d["ultrvStr"]) + " "), TextRun("(" + Js.display(d["ultrv"]) + ")", RunStyle.SMALL)),
                    texts["LOC_UV"])
            }
            if (Js.present(d["fsnGrade"])) rows += DayRow(icon("food_poisoning.png"), runs(TextRun(Js.display(d["fsnStr"]))), texts["LOC_FOOD_POISONING"])
            if (rain) {
                val label = if (ForecastText.rainSnowFallSymbol(d) == "snow") "LOC_DAILY_SNOWFALL" else "LOC_DAILY_PRECIPITATION"
                rows += DayRow(icon("precipitation.png"), runs(TextRun(Js.display(ForecastText.rainSnowFall(d))),
                    TextRun(units.precipitation.orEmpty(), RunStyle.SMALL)), texts[label])
            }
            DayCell(collapse(Js.display(ForecastFormat.mmdd(d["dateObj"])) + " " + dayLabel(d)), rows)
        }
    }

    /** `{{day.fromToday==0?getDayString(day.fromToday):dayToString(day.dayOfWeek)|translate}}`. */
    private fun dayLabel(d: JsonObject?): String = translate(
        if (Js.looseEquals(d?.get("fromToday"), 0.0)) ForecastFormat.dayString(d?.get("fromToday")) else ForecastFormat.dayName(d?.get("dayOfWeek"), full = false))

    /** The translate filter: a missing key shows itself; no key shows nothing. */
    private fun translate(key: String?): String = key?.let { texts[it] } ?: ""

    private fun glyph(grade: JsonElement?): String = entity(AirQuality.sentimentIcon(units.air, grade))

    private fun color(grade: JsonElement?): String? = AirQuality.gradeColor(standard, grade, null).takeIf { it.isNotEmpty() }

    companion object {
        /** Material Icons of the detail AQI card: place (`&#xE55C`), schedule and info. */
        const val STATION = ""
        const val TIME = ""
        const val INFO = ""

        /** `.colgroup-box a:after`: the Ionicons arrow after a link's text. */
        private val LINK_ARROW_RUN = TextRun("\uF3D3", RunStyle.LINK_ARROW)

        /** The translation keys the pages read, for the app to load from its catalog. */
        val KEYS = listOf(
            "LOC_HOUR", "LOC_HOURLY_AQI_FORECAST", "LOC_DAILY_AQI_FORECAST", "LOC_DETAIL_WEATHER", "LOC_DETAIL_AQI", "LOC_WEATHER",
            "LOC_HUMIDITY", "LOC_WIND", "LOC_VISIBILITY", "LOC_PRESSURE", "LOC_DISCOMFORT_INDEX", "LOC_FEELS_LIKE", "LOC_HOURLY_PRECIPITATION",
            "LOC_UV", "LOC_POLLEN_RISK", "LOC_FOOD_POISONING", "LOC_SUNRISE", "LOC_SUNSET", "LOC_PM25", "LOC_PM10", "LOC_O3", "LOC_NO2",
            "LOC_CO", "LOC_SO2", "LOC_AQI", "LOC_STATION", "LOC_PUBLIC", "LOC_FORECAST", "LOC_AIR_QUALITY_INDEX_UNIT", "LOC_AIR_FORECAST_SOURCE",
            "LOC_AIR_QUALITY_INDEX_KR", "LOC_AIR_QUALITY_INDEX_KR_WHO", "LOC_AIR_QUALITY_INDEX_US", "LOC_AIR_QUALITY_INDEX_CN",
            "LOC_PROBABILITY_OF_PRECIPITATION", "LOC_DAILY_SNOWFALL", "LOC_DAILY_PRECIPITATION",
            "LOC_SAME_AS_YESTERDAY", "LOC_THAN_YESTERDAY", "LOC_THIS_DAY_TEMP", "LOC_PREVIOUS_DAY_TEMP",
            "LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
            "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY",
            "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT",
            "LOC_SUNDAY", "LOC_MONDAY", "LOC_TUESDAY", "LOC_WEDNESDAY", "LOC_THURSDAY", "LOC_FRIDAY", "LOC_SATURDAY",
            "LOC_POLLEN_OAK", "LOC_POLLEN_PINE", "LOC_POLLEN_WEEDS", "LOC_POLLEN_OAK_INFO", "LOC_POLLEN_PINE_INFO", "LOC_POLLEN_WEEDS_INFO",
            "LOC_POLLEN_ADVICE_0", "LOC_POLLEN_ADVICE_1", "LOC_POLLEN_ADVICE_2", "LOC_POLLEN_ADVICE_3", "LOC_POLLEN_SOURCE", "LOC_CLOSE",
            "LOC_KAQ_DESCRIPTION", "LOC_AIRKOREA_DESCRIPTION",
        )

        /** `"&#xE815;"` to its character. */
        fun entity(html: String): String =
            Regex("&#x([0-9A-Fa-f]+);?").replace(html) { String(Character.toChars(it.groupValues[1].toInt(16))) }

        /** `reh ? reh - reh%10 : '00'`: the humidity image's bucket. */
        internal fun humidityBucket(reh: JsonElement?): String {
            if (!Js.truthy(reh)) return "00"
            val n = Js.number(reh)
            return Js.numberToString(n - n % 10)
        }

        /** `value.toFixed(digits)` of a number; null where it fails (anything but a number), which empties its text. */
        internal fun fixed(value: JsonElement?, digits: Int): String? {
            val p = value as? JsonPrimitive ?: return null
            if (p.isString || p == JsonNull || p.content == "true" || p.content == "false") return null
            return Js.toFixed(Js.number(p), digits)
        }

        internal fun substr(s: String, start: Int, length: Int): String = if (start >= s.length) "" else s.substring(start, minOf(s.length, start + length))

        /** HTML white-space collapsing of one text. */
        internal fun collapse(text: String): String = runs(TextRun(text)).firstOrNull()?.text ?: ""

        /** HTML white-space collapsing over a row's runs: each run of white space becomes one space, none at the ends. */
        internal fun runs(vararg runs: TextRun): List<TextRun> {
            var space = true
            val out = runs.map { run ->
                val b = StringBuilder()
                for (ch in run.text) {
                    if (ch == ' ' || ch == '\n' || ch == '\t' || ch == '\r' || ch == '\u000C') {
                        if (!space) b.append(' ')
                        space = true
                    } else {
                        b.append(ch)
                        space = false
                    }
                }
                run.copy(text = b.toString())
            }.toMutableList()
            for (i in out.indices.reversed()) {
                val trimmed = out[i].text.trimEnd(' ')
                out[i] = out[i].copy(text = trimmed)
                if (trimmed.isNotEmpty()) break
            }
            return out.filter { it.text.isNotEmpty() }
        }
    }
}

/** TabCtrl's helpers of the weather templates (controller.tabctrl.js) and `Units.getAirUnitStr`. */
object ForecastFormat {
    private val DAY_STRINGS = listOf("LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
        "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY")
    private val DAYS = listOf("LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT")
    private val FULL_DAYS = listOf("LOC_SUNDAY", "LOC_MONDAY", "LOC_TUESDAY", "LOC_WEDNESDAY", "LOC_THURSDAY", "LOC_FRIDAY", "LOC_SATURDAY")

    /** `getDayString(day)`: -3 to 3 from today, otherwise LOC_FROM_TODAY; null where the lookup finds nothing. */
    fun dayString(day: JsonElement?): String? {
        val n = Js.number(day)
        if (!(-3 <= n && n <= 3)) return DAY_STRINGS.last()
        if (day is JsonPrimitive && day.isString) return null // "0" + 3 is "03"
        val i = n + 3
        return if (i == kotlin.math.floor(i)) DAY_STRINGS[i.toInt()] else null
    }

    /** `dayToString(day)` and `dayToFullString(day)`: the weekday key at index [day] (0 is Sunday). */
    fun dayName(day: JsonElement?, full: Boolean): String? {
        val list = if (full) FULL_DAYS else DAYS
        val p = day as? JsonPrimitive ?: return null
        if (p == JsonNull) return null
        val key = if (p.isString) p.content else if (p.content == "true" || p.content == "false") return null else Js.string(p)
        val i = key.toIntOrNull()?.takeIf { it.toString() == key } ?: return null
        return list.getOrNull(i)
    }

    /** `convertMMDD(value)`: "MM/DD" of "YYYY.MM.DD HH:MM"; anything but a string as it is. */
    fun mmdd(value: JsonElement?): JsonElement? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?.let { JsonPrimitive(ForecastPage.substr(it, 5, 2) + "/" + ForecastPage.substr(it, 8, 2)) } ?: value

    /** `convertDD(value)`: the day of "YYYY-MM-DD"; anything but a string as it is. */
    fun dd(value: JsonElement?): JsonElement? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?.let { JsonPrimitive(ForecastPage.substr(it, 8, 2)) } ?: value

    /** `Units.getAirUnitStr(unit)`: the standard's translation key. */
    fun airUnitKey(airUnit: String?): String? = when (airUnit) {
        "airkorea" -> "LOC_AIR_QUALITY_INDEX_KR"
        "airkorea_who" -> "LOC_AIR_QUALITY_INDEX_KR_WHO"
        "airnow" -> "LOC_AIR_QUALITY_INDEX_US"
        "aqicn" -> "LOC_AIR_QUALITY_INDEX_CN"
        else -> null
    }

    /** `showPollenInfo(day)`: the popup's rows, null when it does not open (no pollen grade). */
    fun pollenRows(day: JsonObject?): List<PollenRow>? {
        if (day == null || day["pollenGrade"] == null) return null
        return listOf("flowerWoody" to "LOC_POLLEN_OAK", "flowerPine" to "LOC_POLLEN_PINE", "flowerWeeds" to "LOC_POLLEN_WEEDS")
            .filter { (field) -> day["${field}Grade"] != null }
            .map { (field, label) ->
                PollenRow(label, Js.display(day["${field}Str"]), label + "_INFO", "LOC_POLLEN_ADVICE_" + Js.string(day["${field}Grade"]))
            }
    }
}
