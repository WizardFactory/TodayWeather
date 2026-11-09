package net.wizardfactory.todayweather.ui.air

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.ShellFit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S05 at font scale 1.3 (AN-06: text follows the system font scale), on a phone, a small window and a tablet, for
 * Seoul (the overall index, then 초미세먼지 and 오존 from their cells, with every card) and London (a two-line advice): no
 * text is ellipsized or cut, and none reaches past the window's sides ([ShellFit]); the gauge's band names end with an
 * ellipsis when too long, as on Cordova. The chart's texts are drawn, not laid out: the chart zooms with the font scale
 * as a whole, and the air references cover it. Images go to build/air-fit/.
 */
abstract class AirFitTest(private val lang: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val out = File(project, "build/air-fit").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f) fun phoneLargeText() = fits("phone-text-1.3")
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun smallWindowLargeText() = fits("small-window-text-1.3")
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f) fun tabletLargeText() = fits("tablet-text-1.3")
    @Test @Config(qualifiers = "+w384dp-h832dp-port") fun phone() = fits("phone")

    private fun fits(name: String) {
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val london = Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul, london), placeIndex = 1,
                units = UnitSettings.defaults("KR"), settings = Settings(startupPage = "3")))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { url, _ -> File(inputs, if ("51.51" in url) "vc-london.json" else "kma-seoul.json").readText() }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf(lang) }, { null })
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, false, session, host, "test", onExit = {})
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        val bands = hasAnyAncestor(hasTestTag(AirTags.BANDS))
        val problems = mutableListOf<String>()
        fun check(what: String) {
            // Every card in turn, the last ones scrolled into view.
            for (block in 0..6) {
                val card = rule.onAllNodesWithTagCount(AirTags.block(block))
                if (card == 0) continue
                rule.onNodeWithTag(AirTags.block(block)).performScrollTo()
                rule.waitForIdle()
                problems += ShellFit.texts(rule, "$what block $block", safe, bands)
                if (block == 0) capture("$name-$what-top")
            }
            capture("$name-$what-end")
        }
        check("seoul")
        for (code in listOf("pm25", "o3")) {
            rule.onNodeWithTag(AirTags.block(4)).performScrollTo()
            rule.onNodeWithTag(AirTags.code(code)).performScrollTo().performClick()
            rule.waitForIdle()
            check("seoul-$code")
        }
        rule.onNodeWithTag(AirTags.NEXT).performClick()
        rule.waitForIdle()
        check("london")
        assertEquals("$lang $name", emptyList<String>(), problems.distinct())
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTagCount(tag: String) =
        onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().size

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$lang-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class AirFitKoTest : AirFitTest("ko-KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class AirFitEnTest : AirFitTest("en-US")
