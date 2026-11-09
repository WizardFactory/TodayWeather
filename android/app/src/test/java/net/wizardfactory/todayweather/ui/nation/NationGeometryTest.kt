package net.wizardfactory.todayweather.ui.nation

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.unit.dp
import java.io.File
import kotlin.math.abs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.domain.nation.WarningCards
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.model.NationResponse
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The parts of the native pages where the Cordova build put them (#2892 AC3), from the rects the capture recorded
 * (nation-reference/<lang>/<state>.json), within 0.5 dp:
 * - every label of S10's three modes, of the km/h wind and of S11, relative to the map;
 * - the mode buttons, the strip's tabs (also scrolled to CO) and the map;
 * - the S12 cards' tops and heights;
 * - the loading box.
 * The screenshots compare pixels; this test catches a few dp that change too few of them.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class NationGeometryTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val references = File(project, "src/test/resources/nation-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val kr = UnitSettings.defaults("KR")
    private val nation = NationPageState.Nation(NationResponse(Json.parseToJsonElement(File(inputs, "nation.json").readText()).jsonObject))
    private val failures = mutableListOf<String>()

    private var route by mutableStateOf("")
    private var state by mutableStateOf<NationPageState>(NationPageState.Loading)
    private var units by mutableStateOf(kr)
    private var generation by mutableIntStateOf(0)
    private var started = false

    private fun page(route: String, state: NationPageState, units: UnitSettings = kr) {
        this.route = route
        this.state = state
        this.units = units
        generation++
        if (!started) {
            started = true
            rule.setContent {
                val texts = forecastTexts(LocalContext.current)
                key(generation) {
                    Box(Modifier.size(384.dp, 762.dp).testTag(ROOT)) { NationScreen(this@NationGeometryTest.route, this@NationGeometryTest.state, Theme.LIGHT, "KR", this@NationGeometryTest.units, texts, onBack = {}) }
                }
            }
        }
        rule.waitForIdle()
    }

    private fun capture(state: String) = Json.parseToJsonElement(File(references, "$state.json").readText()).jsonObject
    private fun JsonObject.rect(key: String = "rect") = this[key]!!.jsonObject.let {
        Rect(it["x"]!!.jsonPrimitive.double.toFloat(), it["y"]!!.jsonPrimitive.double.toFloat(),
            (it["x"]!!.jsonPrimitive.double + it["w"]!!.jsonPrimitive.double).toFloat(), (it["y"]!!.jsonPrimitive.double + it["h"]!!.jsonPrimitive.double).toFloat())
    }
    /** Where [tag]'s node is laid out in dp, whatever clips it (the strip, the page's end). */
    private fun bounds(tag: String): Rect = rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().let {
        val d = rule.density.density
        Rect(it.positionInRoot.x / d, it.positionInRoot.y / d, (it.positionInRoot.x + it.size.width) / d, (it.positionInRoot.y + it.size.height) / d)
    }

    /** [native] against [cordova], both in dp, each edge within 0.5 dp. */
    private fun near(what: String, native: Rect, cordova: Rect, edges: String = "ltrb") {
        val d = mapOf('l' to native.left - cordova.left, 't' to native.top - cordova.top, 'r' to native.right - cordova.right, 'b' to native.bottom - cordova.bottom)
        val off = edges.filter { abs(d[it]!!) > 0.5f }
        if (off.isNotEmpty()) failures += "$what: native $native, Cordova $cordova (${off.map { "$it ${"%.2f".format(d[it])}" }})"
    }

    private fun labels(state: String) {
        val record = capture(state)
        val map = record["map"]!!.jsonObject.rect()
        val nativeMap = bounds(NationTags.MAP)
        near("$state map", nativeMap, map)
        for (l in record["labels"]!!.jsonArray.map { it.jsonObject }) {
            val name = l["name"]!!.jsonPrimitive.content
            near("$state label $name", bounds(NationTags.label(name)).translate(-nativeMap.left, -nativeMap.top), l.rect().translate(-map.left, -map.top))
        }
    }

    private fun buttons(state: String, tag: (Int) -> String) {
        capture(state)["buttons"]!!.jsonArray.map { it.jsonObject }.forEachIndexed { i, b ->
            near("$state button $i", bounds(tag(i)), b.rect())
        }
    }

    private fun checked(block: () -> Unit) {
        block()
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun weatherLabelsAndModeButtons() = checked {
        page(NationRoutes.NATION, nation)
        labels("ko-KR/nation-weather")
        buttons("ko-KR/nation-weather", NationTags::mode)
        rule.onNodeWithTag(NationTags.mode(1)).performClick()
        rule.waitForIdle()
        labels("ko-KR/nation-rain")
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        rule.waitForIdle()
        labels("ko-KR/nation-wind")
        page(NationRoutes.NATION, nation, units = kr.copy(windSpeedUnit = "km/h"))
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        rule.waitForIdle()
        labels("ko-KR/nation-wind-kph")
        page(NationRoutes.NATION, NationPageState.Nation(null))
        labels("ko-KR/nation-weather-failed")
    }

    @Test
    fun airLabelsAndTabs() = checked {
        page(NationRoutes.NATION_AIR, nation)
        labels("ko-KR/nation-air-pm2.5")
        buttons("ko-KR/nation-air-pm2.5") { NationTags.tab(listOf("pm2.5", "pm10", "o3", "no2", "so2", "co")[it]) }
        rule.onNodeWithTag(NationTags.STRIP).performTouchInput { swipeLeft() }
        rule.onNodeWithTag(NationTags.tab("co")).performClick()
        rule.waitForIdle()
        labels("ko-KR/nation-air-co")
        buttons("ko-KR/nation-air-co") { NationTags.tab(listOf("pm2.5", "pm10", "o3", "no2", "so2", "co")[it]) }
    }

    @Test
    fun warningCards() = checked {
        page(NationRoutes.WARNINGS, NationPageState.Warnings(WarningCards.cards(
            Warnings.parse(Json.parseToJsonElement(File(inputs, "special.json").readText()), "ko-KR", "Asia/Seoul"))))
        capture("ko-KR/warnings")["cards"]!!.jsonArray.map { it.jsonObject }.forEachIndexed { i, card ->
            // Each card's top and height. The cards are 2 dp wider than the window in Cordova, and each h2's 19.2 dp line
            // puts the next card 0.2 dp lower there than in whole device pixels.
            val native = bounds(NationTags.card(i))
            val cordova = card.rect()
            near("card $i top", native, cordova, edges = "t")
            near("card $i height", Rect(0f, 0f, 0f, native.height), Rect(0f, 0f, 0f, cordova.height), edges = "b")
        }
    }

    @Test
    fun loadingBox() = checked {
        page(NationRoutes.NATION, NationPageState.Loading)
        val loading = capture("ko-KR/nation-loading")["loading"]!!.jsonObject
        near("loading container", bounds(NationTags.LOADING), loading["container"]!!.jsonObject.rect())
        near("loading box", bounds(NationTags.LOADING_BOX), loading["box"]!!.jsonObject.rect())
    }

    private companion object {
        const val ROOT = "nation-geometry-root"
    }
}
