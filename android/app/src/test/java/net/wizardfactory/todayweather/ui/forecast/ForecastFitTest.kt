package net.wizardfactory.todayweather.ui.forecast

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.captureToImage
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.chart.EXPANDER_TAG
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
 * S03 and S04 at font scale 1.3 (AN-06: text follows the system font scale), on a phone, a small window and a tablet,
 * for Seoul (every Korean card) and London: no text is ellipsized or cut, and none reaches past the window's sides
 * ([ShellFit]). The charts' texts are drawn, not laid out: the charts zoom with the font scale as a whole, and the
 * chart references cover them. Images go to build/forecast-fit/.
 */
abstract class ForecastFitTest(private val lang: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val out = File(project, "build/forecast-fit").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    // AN-18 AC4: window-size coverage; real multi-window is checked separately on device.
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
        val london = Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul, london), placeIndex = 1,
                units = UnitSettings.defaults("KR"), expandShortChart = true))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { url, _ -> if ("51.51" in url) File(inputs, "vc-london.json").readText() else pollenFixture() }, io = Dispatchers.Unconfined)
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
        val problems = mutableListOf<String>()
        for (place in listOf("seoul", "london")) {
            for (tab in listOf(Tab.HOURLY, Tab.DAILY)) {
                rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
                rule.waitForIdle()
                problems += ShellFit.texts(rule, "$place $tab", safe)
                capture("$name-$place-${tab.state}")
                for (index in 0..8) {
                    val card = ForecastTags.block(index)
                    if (rule.onAllNodes(hasTestTag(card)).fetchSemanticsNodes().isNotEmpty()) {
                        rule.onNodeWithTag(card).performScrollTo()
                        problems += ShellFit.texts(rule, "$place $tab card $index", safe)
                    }
                }
                if (place == "seoul" && tab == Tab.HOURLY) {
                    rule.onNodeWithTag(ForecastTags.POLLEN).performScrollTo().performClick()
                    rule.waitForIdle()
                    problems += ShellFit.texts(rule, "pollen", null)
                    rule.onNode(hasText(rule.activity.getString(R.string.LOC_CLOSE)) and hasAnyAncestor(hasTestTag(WeatherTabTags.POLLEN_DIALOG))).performClick()
                }
                if (tab == Tab.HOURLY) rule.onNodeWithTag(EXPANDER_TAG).performScrollTo()
            }
            rule.onNodeWithTag(ForecastTags.NEXT).performClick()
            rule.waitForIdle()
        }
        assertEquals("$lang $name", emptyList<String>(), problems)
    }

    private fun pollenFixture(): String {
        val body = Json.parseToJsonElement(File(inputs, "kma-seoul.json").readText()).jsonObject
        val mid = body.getValue("midData").jsonObject
        val days = mid.getValue("dailyData").jsonArray.map { day ->
            JsonObject(day.jsonObject + mapOf("pollenGrade" to JsonPrimitive(2), "pollenStr" to JsonPrimitive("높음"),
                "flowerPineGrade" to JsonPrimitive(2), "flowerPineStr" to JsonPrimitive("높음")))
        }
        return JsonObject(body + ("midData" to JsonObject(mid + ("dailyData" to JsonArray(days))))).toString()
    }

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$lang-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class ForecastFitKoTest : ForecastFitTest("ko-KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class ForecastFitEnTest : ForecastFitTest("en-US")
