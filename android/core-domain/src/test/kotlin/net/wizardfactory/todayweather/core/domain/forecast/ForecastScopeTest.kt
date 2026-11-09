package net.wizardfactory.todayweather.core.domain.forecast

import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.CorpusPlaces
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics

/**
 * ForecastScope against the scope of the Cordova ForecastCtrl (corpus/forecast.json, tools/corpus/generate.mjs): each
 * visit opens a page with its first place and applies the others as swipes; every value the templates read must
 * match after every apply, including the values an apply leaves from an earlier place.
 */
class ForecastScopeTest {
    private val corpus = File(javaClass.getResource("/corpus/forecast.json")!!.toURI()).parentFile
    private val golden = Json.parseToJsonElement(File(corpus, "forecast.json").readText()).jsonObject

    @Test
    fun visitsMatchForecastCtrl() {
        val visits = golden["visits"]!!.jsonArray.map { it.jsonObject }
        assertEquals(58, visits.size)
        for (visit in visits) {
            val name = "${visit.str("name")} ${visit.str("type")}"
            val places = visit["places"]!!.jsonArray.map { it.jsonObject }
            val records = places.map(::record)
            val units = visit["units"]!!.jsonObject
            val scope = ForecastScope(
                type = if (visit.str("type") == "mid") ForecastType.MID else ForecastType.SHORT,
                metrics = ChartMetrics(visit["width"]!!.jsonPrimitive.double, visit["height"]!!.jsonPrimitive.double),
                fahrenheit = units.str("temperatureUnit") == "F",
                photoTheme = visit.str("theme") == "photo",
                yesterday = yesterday(if (visit.str("lang") == "en") "values" else "values-ko"),
                expandShortChart = (visit["expandShortChart"] as? JsonPrimitive)?.takeIf { it != JsonNull }?.boolean,
            )
            val hasPush = { i: Int -> places[i]["hasPush"]?.jsonPrimitive?.boolean == true }
            val applied = visit["applied"]!!.jsonArray.map { it.jsonObject }
            val opened = scope.open(records.firstOrNull(), records.size, records.isNotEmpty() && hasPush(0))
            assertEquals(records.isNotEmpty(), opened, "$name: opened")
            check(applied[0], scope, records, "$name #0")
            for (i in 1 until records.size) {
                scope.apply(records[i], hasPush(i))
                check(applied[i], scope, records, "$name #$i")
            }
        }
    }

    @Test
    fun helpersMatchTabCtrl() {
        val helpers = golden["helpers"]!!.jsonObject
        fun cases(name: String) = helpers[name]!!.jsonArray.map { it.jsonObject }
        fun arg(case: JsonObject): JsonElement? = if (case["undefinedArg"]?.jsonPrimitive?.boolean == true) null else case["args"]!!.jsonArray[0]
        fun expected(case: JsonObject): String? = case["expected"]!!.let { if (it == JsonNull) null else it.jsonPrimitive.content }
        for (case in cases("getDayString")) assertEquals(expected(case), ForecastFormat.dayString(arg(case)), "getDayString $case")
        for (case in cases("dayToString")) assertEquals(expected(case), ForecastFormat.dayName(arg(case), full = false), "dayToString $case")
        for (case in cases("dayToFullString")) assertEquals(expected(case), ForecastFormat.dayName(arg(case), full = true), "dayToFullString $case")
        for (case in cases("convertMMDD")) assertEquals(case["expected"], ForecastFormat.mmdd(arg(case)), "convertMMDD $case")
        for (case in cases("convertDD")) assertEquals(case["expected"], ForecastFormat.dd(arg(case)), "convertDD $case")
        for (case in cases("currentAirUnitStr")) {
            assertEquals(expected(case), ForecastFormat.airUnitKey((arg(case) as? JsonPrimitive)?.takeIf { it != JsonNull }?.content), "airUnitStr $case")
        }
        for (case in cases("pollen")) {
            val rows = ForecastFormat.pollenRows(arg(case) as JsonObject)
            val expected = case["expected"]!!
            if (expected == JsonNull) {
                assertEquals(null, rows, "pollen $case")
                continue
            }
            val popup = expected.jsonObject
            assertEquals("LOC_POLLEN_RISK", popup.str("title"))
            assertEquals("LOC_CLOSE", popup.str("okText"))
            assertEquals(popup["rows"]!!.jsonArray.map { r ->
                val o = r.jsonObject
                PollenRow(o.str("labelKey")!!, Js.display(o["gradeLabel"]), o.str("infoKey")!!, o.str("adviceKey")!!)
            }, rows, "pollen $case")
        }
    }

    @Test
    fun placeSelectionMatchesWeatherInfo() {
        val cases = golden["cityIndex"]!!.jsonArray.map { it.jsonObject }
        assertEquals(28, cases.size)
        for (case in cases) {
            val count = case["count"]!!.jsonPrimitive.int
            val disabled = List(count) { it == 0 && case["firstDisabled"]!!.jsonPrimitive.boolean }
            val from = case["from"]!!.jsonPrimitive.int
            val name = "count $count, first disabled ${disabled[0]}, from $from"
            assertEquals(case["enabled"]!!.jsonPrimitive.int, PlaceIndex.enabledCount(disabled), "$name: enabled")
            if (from < 0) {
                assertEquals(case["first"]!!.jsonPrimitive.int, PlaceIndex.first(disabled, 0), "$name: first")
            } else {
                assertEquals(case["next"]!!.jsonPrimitive.int, PlaceIndex.next(disabled, from), "$name: next")
                assertEquals(case["previous"]!!.jsonPrimitive.int, PlaceIndex.previous(disabled, from), "$name: previous")
            }
        }
    }

    private fun check(expected: JsonObject, scope: ForecastScope, records: List<JsonObject>, name: String) {
        fun same(key: String, actual: JsonElement?) = assertEquals(expected[key], actual, "$name: $key")
        fun number(key: String, actual: Double?) {
            val e = expected[key]?.jsonPrimitive?.double
            if (e == null || actual == null) assertEquals(e, actual, "$name: $key") else assertTrue(abs(e - actual) < 1e-9, "$name: $key $e != $actual")
        }
        fun of(key: String, field: String, actual: JsonElement?) {
            val index = records.indexOfFirst { actual != null && it[field] === actual }.takeIf { it >= 0 }
            assertEquals(expected[key]?.jsonPrimitive?.int, index, "$name: $key")
        }
        same("address", scope.address)
        same("currentPosition", scope.currentPosition)
        assertEquals(expected["hasPush"]?.jsonPrimitive?.boolean, scope.hasPush, "$name: hasPush")
        same("source", scope.source)
        same("photo", scope.photo)
        assertEquals(expected["cityCount"]?.jsonPrimitive?.int, scope.cityCount, "$name: cityCount")
        number("timeWidth", scope.timeWidth)
        number("dayWidth", scope.dayWidth)
        of("currentWeatherOf", "currentWeather", scope.currentWeather)
        of("timeTableOf", "timeTable", scope.timeTable)
        of("timeChartOf", "timeChart", scope.timeChart)
        of("dayChartOf", "dayChart", scope.dayChart)
        same("hourlyAqiForecast", scope.hourlyAqiForecast)
        same("dailyAqiForecast", scope.dailyAqiForecast)
        same("airForecastPubdate", scope.airForecastPubdate)
        same("airForecastSource", scope.airForecastSource)
        assertEquals(expected.str("updateTime"), scope.updateTime, "$name: updateTime")
        number("chartShortHeight", scope.chartShortHeight)
        number("chartShortDetailHeight", scope.chartShortDetailHeight)
        number("chartMidHeight", scope.chartMidHeight)
        assertEquals(expected["showDetailWeather"]!!.jsonPrimitive.boolean, scope.showDetailWeather, "$name: showDetailWeather")
        same("summary", scope.summary)
        assertEquals(expected["hasSummaryAir"]!!.jsonPrimitive.boolean, scope.summaryAir != null, "$name: hasSummaryAir")
        same("summaryAir", scope.summaryAir)
        assertEquals(expected.str("diffTempStr"), scope.diffTempStr, "$name: diffTempStr")
        number("headerHeight", scope.metrics.headerHeight)
        number("bigFontSize", scope.metrics.bigFontSize)
        number("bigImageSize", scope.metrics.bigImageSize)
        number("smallImageSize", scope.metrics.iconSize)
        assertEquals(expected["expand"]!!.jsonPrimitive.boolean, scope.expand, "$name: expand")
        val cw = scope.currentWeather as? JsonObject
        val shown = Js.truthy(scope.currentWeather)
        assertEquals(expected["temp"]?.let(Js::display), if (shown) scope.temp(cw?.get("t1h")) else null, "$name: temp")
        assertEquals(expected["feelsLike"]?.let(Js::display), if (shown) scope.temp(cw?.get("sensorytem")) else null, "$name: feelsLike")
        assertEquals(expected["showHourlyAqiForecast"]!!.jsonPrimitive.boolean, scope.showHourlyAqiForecast(), "$name: showHourlyAqiForecast")
        if (scope.type == ForecastType.MID) {
            assertEquals(expected["hasDustForecast"]!!.jsonPrimitive.boolean, scope.hasDustForecast(), "$name: hasDustForecast")
            val values = ((scope.dayChart as? JsonArray)?.firstOrNull() as? JsonObject)?.get("values") as? JsonArray
            assertEquals(expected["dailyDetail"]?.jsonArray?.map { it.jsonPrimitive.boolean }, values?.map { scope.checkDailyDetailWeather(it) },
                "$name: dailyDetail")
            val three = expected["threeDays"]!!.jsonObject
            assertEquals(three["pop"]!!.jsonPrimitive.boolean, scope.hasPropertyInThreeDays(listOf("pop")), "$name: pop")
            assertEquals(three["ultrvGrade"]!!.jsonPrimitive.boolean, scope.hasPropertyInThreeDays(listOf("ultrvGrade")), "$name: ultrvGrade")
            assertEquals(three["rain"]!!.jsonPrimitive.boolean, scope.hasPropertyInThreeDays(listOf("pty", "rn1", "r06", "s06")), "$name: rain")
        }
    }

    private fun record(place: JsonObject): JsonObject = CorpusPlaces.record(corpus, place)

    /** The imported catalog strings (android/app/src/main/res), as GoldenCorpusTest reads them. */
    private fun yesterday(dir: String): YesterdayText {
        val xml = File(System.getProperty("tw.projectDir"), "../app/src/main/res/$dir/client_strings.xml").readText()
        fun get(key: String) = Regex("<string name=\"$key\"[^>]*>(.*?)</string>").find(xml)!!.groupValues[1]
        return YesterdayText(same = get("LOC_SAME_AS_YESTERDAY"), than = get("LOC_THAN_YESTERDAY"))
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
}
