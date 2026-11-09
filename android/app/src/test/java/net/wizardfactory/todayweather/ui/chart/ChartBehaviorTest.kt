package net.wizardfactory.todayweather.ui.chart

import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Opening offsets and the expander (#2884). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
class ChartBehaviorTest {
    @get:Rule val rule = createComposeRule()
    private val project = File(System.getProperty("tw.projectDir")!!)
    private val core = File(project, "../core-domain/src/test/resources")

    private fun place() = File(core, "corpus/conversion/kma-seoul.json").readText().let { Json.parseToJsonElement(it).jsonObject }
        .let { case -> WeatherConverter.convert(Json.parseToJsonElement(File(core, "corpus/" + (case["inputFile"] as JsonPrimitive).content).readText()))!! }

    /** The charts open where the WebView scrolled them (scrollLeft in the captures, whole device pixels). */
    @Test
    fun chartsOpenAtTheCordovaOffsets() {
        val place = place()
        val texts = chartTexts(ApplicationProvider.getApplicationContext())
        for (size in listOf("360x780", "384x832", "412x892")) {
            val (w, h) = size.split("x").map { it.toDouble() }
            val captured = Json.parseToJsonElement(File(core, "chart-reference/$size/kma-seoul.json").readText()).jsonObject
            val hourly = HourlyChart.build(place, ChartMetrics(w, h), texts, "mm", "m/s")
            val daily = DailyChart.build(place, ChartMetrics(w, h), texts, "mm")
            assertEquals(size, (captured["hourly"]!!.jsonObject["scroll"]!!.jsonObject["left"]!!.jsonPrimitive.double * 2).toInt(), scrollPixels(hourly.openingOffset, 2f))
            assertEquals(size, (captured["daily"]!!.jsonObject["scroll"]!!.jsonObject["left"]!!.jsonPrimitive.double * 2).toInt(), scrollPixels(daily.openingOffset, 2f))
        }
    }

    /** New data opens at its own opening offset, as the Cordova app scrolls after every apply. */
    @Test
    fun newDataOpensAtItsOffset() {
        val texts = chartTexts(ApplicationProvider.getApplicationContext())
        val metrics = ChartMetrics(384.0, 832.0)
        val seoul = HourlyChart.build(place(), metrics, texts, "mm", "m/s")
        val case = Json.parseToJsonElement(File(core, "corpus/conversion/vc-london.json").readText()).jsonObject
        val london = HourlyChart.build(WeatherConverter.convert(Json.parseToJsonElement(
            File(core, "corpus/" + (case["inputFile"] as JsonPrimitive).content).readText()))!!, metrics, texts, "mm", "m/s")
        var chart by mutableStateOf(seoul)
        var scroll: ScrollState? = null
        rule.setContent { scroll = rememberOpeningScroll(chart, chart.openingOffset); HourlyChartView(chart, false, {}, scrollState = scroll!!) }
        rule.waitForIdle()
        assertEquals(scrollPixels(seoul.openingOffset, 2f), scroll!!.value)
        rule.runOnIdle { scroll!!.dispatchRawDelta(-200f) }
        chart = london
        rule.waitForIdle()
        assertEquals(scrollPixels(london.openingOffset, 2f), scroll!!.value)
        assertTrue(seoul.openingOffset != london.openingOffset)
    }

    @Test
    fun theExpanderTogglesTheDetailRows() {
        val chart = HourlyChart.build(place(), ChartMetrics(384.0, 832.0), chartTexts(ApplicationProvider.getApplicationContext()), "mm", "m/s")
        var expanded by mutableStateOf(false)
        rule.setContent { HourlyChartView(chart, expanded, onToggleExpanded = { expanded = !expanded }, scrollState = ScrollState(0)) }
        rule.waitForIdle()
        val collapsed = rule.onNodeWithTag(EXPANDER_TAG).fetchSemanticsNode().positionInRoot.y
        rule.onNodeWithTag(EXPANDER_TAG).performClick()
        rule.waitForIdle()
        assertTrue(expanded)
        val open = rule.onNodeWithTag(EXPANDER_TAG).fetchSemanticsNode().positionInRoot.y
        // The detail rows (54 + 2 icons) push the expander down.
        assertEquals(chart.detail.height * 2, (open - collapsed).toDouble(), 1.0)
        rule.onNodeWithTag(EXPANDER_TAG).performClick()
        rule.waitForIdle()
        assertFalse(expanded)
    }
}
