package net.wizardfactory.todayweather.ui.nation

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.toSize
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellFit
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The nationwide and warning pages at font scale 1.3 (AN-06: text follows the system font scale), on a phone, a
 * small window and a tablet, with the wind in km/h (the longest values): S10 in its three modes, S11 in its six tabs
 * and S12 scrolled to its end.
 * - No text is cut or reaches past the window's sides ([ShellFit]). The mode buttons end with an ellipsis by design
 *   (`text-overflow: ellipsis`), as English does at any size.
 * - Every map label lies inside the window where it is laid out (the labels may overlap each other at fixed positions,
 *   as on the Cordova map).
 * - No line of S12 crowds the one above it: baselines at least 1.1 times the larger font apart.
 * Images go to build/nation-fit/.
 */
abstract class NationFitTest(private val lang: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val out = File(project, "build/nation-fit").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    // AN-18 AC4: window-size coverage; real multi-window is checked separately on device.
    // AN-18c: all existing states at each parity display size, in both language subclasses.
    @Test @Config(qualifiers = "+w384dp-h832dp-port", fontScale = 1f)
    fun parity384() = fits("parity-384x832")
    @Test @Config(qualifiers = "+w360dp-h780dp-port", fontScale = 1f)
    fun parity360() = fits("parity-360x780")
    @Test @Config(qualifiers = "+w412dp-h892dp-port", fontScale = 1f)
    fun parity412() = fits("parity-412x892")
    @Test @Config(qualifiers = "+w320dp-h694dp-port", fontScale = 1f)
    fun parity320() = fits("parity-320x694")

    @Test @Config(qualifiers = "+w800dp-h1280dp-port", fontScale = 1.3f) fun tabletPortraitLargeText() = fits("tabletPortraitLargeText")
    @Test @Config(qualifiers = "+w841dp-h701dp-land", fontScale = 1.3f) fun foldableOpenLargeText() = fits("foldableOpenLargeText")
    @Test @Config(qualifiers = "+w701dp-h841dp-port", fontScale = 1.3f) fun foldableOpenRotatedLargeText() = fits("foldableOpenRotatedLargeText")
    @Test @Config(qualifiers = "+w411dp-h797dp-port", fontScale = 1.3f) fun foldableClosedLargeText() = fits("foldableClosedLargeText")
    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f) fun foldableClosedRotatedLargeText() = fits("foldableClosedRotatedLargeText")
    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f) fun phoneLandscapeLargeText() = fits("phoneLandscapeLargeText")
    @Test @Config(qualifiers = "+w640dp-h800dp-port", fontScale = 1.3f) fun splitHalfLargeText() = fits("splitHalfLargeText")
    @Test @Config(qualifiers = "+w421dp-h701dp-port", fontScale = 1.3f) fun foldableSplitLargeText() = fits("foldableSplitLargeText")

    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f) fun phoneLargeText() = fits("phone-text-1.3")
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun smallWindowLargeText() = fits("small-window-text-1.3")
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f) fun tabletLargeText() = fits("tablet-text-1.3")
    @Test @Config(qualifiers = "+w384dp-h832dp-port") fun phone() = fits("phone")

    private fun fits(name: String) {
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
                units = UnitSettings.defaults("KR").copy(windSpeedUnit = "km/h")))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf(lang) }, { null })
        val nation = NationLoads(NationSource("https://server.test.invalid", HttpGet { _, _ -> File(inputs, "nation.json").readText() },
            HttpGet { _, _ -> File(inputs, "special.json").readText() }), scope, { memory.current().units }, { listOf(lang) }, { "Asia/Seoul" })
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, false, session, host, "test", onExit = {}, nation = nation)
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        val buttons = hasAnyAncestor(hasTestTag(NationTags.mode(0)) or hasTestTag(NationTags.mode(1)) or hasTestTag(NationTags.mode(2)))
        val problems = mutableListOf<String>()
        val density = rule.density
        // A node's bounds where it is laid out, whatever clips it, in the root's pixels.
        fun laidOut(node: SemanticsNode) = androidx.compose.ui.geometry.Rect(node.positionInRoot, node.size.toSize())
        fun check(what: String) {
            rule.waitForIdle()
            problems += ShellFit.texts(rule, what, safe, designed = buttons)
            if (what.startsWith("nation")) {
                rule.onAllNodes(SemanticsMatcher("a map label") { it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("nation-label-") == true })
                    .fetchSemanticsNodes().forEach { node ->
                        val b = laidOut(node)
                        if (b.left < safe.left - 0.5f || b.right > safe.right + 0.5f) problems += "$what: ${node.config[SemanticsProperties.TestTag]} at $b past $safe"
                    }
            }
            if (what.startsWith("warnings")) {
                val lines = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text) and hasAnyAncestor(hasTestTag(NationTags.WARNINGS)),
                    useUnmergedTree = true).fetchSemanticsNodes().mapNotNull { node ->
                    val layouts = mutableListOf<TextLayoutResult>()
                    node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
                    layouts.firstOrNull()?.let { l ->
                        val size = with(density) { l.layoutInput.style.fontSize.toPx() }
                        Triple(laidOut(node), node.positionInRoot.y + l.firstBaseline, size)
                    }
                }.sortedBy { it.second }
                lines.zipWithNext().forEach { (a, b) ->
                    val sameColumn = a.first.left < b.first.right && b.first.left < a.first.right
                    if (sameColumn && b.second - a.second < 1.1f * maxOf(a.third, b.third) - 0.5f) {
                        problems += "$what: baselines ${a.second} and ${b.second} closer than 1.1 × ${maxOf(a.third, b.third)} px"
                    }
                }
            }
            capture("$name-$what")
        }
        fun open(row: MenuRow) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
            rule.waitForIdle()
        }
        fun back() {
            rule.onNodeWithTag(NationTags.BACK).performClick()
            rule.waitForIdle()
        }

        open(MenuRow.NATIONAL_WEATHER)
        for (mode in 0..2) {
            rule.onNodeWithTag(NationTags.mode(mode)).performClick()
            check("nation-$mode")
        }
        back()
        open(MenuRow.NATIONAL_AIR)
        for (type in listOf("pm2.5", "pm10", "o3", "no2", "so2", "co")) {
            if (type == "co") rule.onNodeWithTag(NationTags.STRIP).performTouchInput { swipeLeft() }
            rule.onNodeWithTag(NationTags.tab(type)).performClick()
            check("nation-air-$type")
        }
        back()
        open(MenuRow.SPECIAL_WEATHER)
        check("warnings")
        repeat(40) { rule.onNodeWithTag(NationTags.WARNINGS).performTouchInput { swipeUp() } }
        check("warnings-end")
        assertEquals("$lang $name", emptyList<String>(), problems.distinct())
    }

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$lang-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR")
class NationFitKoTest : NationFitTest("ko-KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rKR")
class NationFitEnTest : NationFitTest("en-KR")
