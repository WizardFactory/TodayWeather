package net.wizardfactory.todayweather.ui.forecast

import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.ui.shell.PopupTags
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onRoot
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import android.location.LocationManager
import android.provider.Settings
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.HttpStatusException
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.location.LocationGlyph
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The weather tabs in the app's screens (#2887 AC1): the selected place's page and title, swipes and arrows, the
 * tab tap reload, the spinner, the retry confirmation, the pollen popup, the expander and a late response (A01),
 * with the real session and repository over a fake server answering with the AN-02 corpus.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class WeatherTabTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val seoulBody = File(inputs, "kma-seoul.json").readText()
    private val londonBody = File(inputs, "vc-london.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val requests = mutableListOf<String>()

    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
    private val london = Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        val state: StateFlow<AppState> = flow
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private lateinit var memory: Memory
    private lateinit var repository: WeatherRepository
    private lateinit var session: WeatherSession

    @After fun stop() = scope.cancel()

    private fun show(
        answer: suspend (String) -> String = { url -> if ("51.51" in url) londonBody else seoulBody },
        places: List<Place>? = null,
        index: Int = 1,
    ) {
        // The current position is off, as when location was never allowed: Seoul and London are saved places.
        memory = Memory(AppState(places = places ?: listOf(Place.currentPositionPlaceholder(), seoul, london), placeIndex = index,
            units = UnitSettings.defaults("KR")))
        repository = WeatherRepository("https://server.test.invalid", null, HttpGet { url, _ -> requests += url; answer(url) },
            io = Dispatchers.Unconfined)
        session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        // The activity's glyph: a tap with location off clears the selected place's gate, as MainActivity's does.
        val glyph = LocationGlyph(rule.activity) { memory.current().let { s -> s.places.getOrNull(s.placeIndex)?.let(repository::invalidate) } }
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next,
                { expand -> memory.change { it.copy(expandShortChart = expand) } }, onLocationGlyph = glyph::tap, locationEnabled = glyph::enabled)
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {})
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    /**
     * #2890 AC3: only the header block switches places; a sideways drag on the hourly chart or the daily chart scrolls
     * that chart and keeps the place, as the Cordova charts scrolled beside the swipe area (`md-page-header`).
     */
    @Test
    fun aChartDragScrollsTheChartAndKeepsThePlace() {
        show()
        for (tab in listOf(Tab.HOURLY, Tab.DAILY)) {
            if (tab == Tab.DAILY) {
                rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
                rule.waitForIdle()
            }
            val selected = memory.current().placeIndex
            val chart = rule.onNode(hasAnyAncestor(hasTestTag(ForecastTags.block(1))) and
                SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange))
            fun offset() = chart.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange].value()
            val start = offset()
            rule.onNodeWithTag(ForecastTags.block(1)).performTouchInput { swipeLeft(durationMillis = 100) }
            rule.waitForIdle()
            assertEquals("$tab: a chart drag left keeps the place", selected, memory.current().placeIndex)
            assertTrue("$tab: the drag scrolled the chart", offset() > start)
            rule.onNodeWithTag(ForecastTags.block(1)).performTouchInput { swipeRight(durationMillis = 100) }
            rule.waitForIdle()
            assertEquals("$tab: a chart drag right keeps the place", selected, memory.current().placeIndex)
            rule.onNodeWithTag(ForecastTags.HEADER).performTouchInput { swipeLeft(durationMillis = 100) }
            rule.waitForIdle()
            assertTrue("$tab: a header swipe switches", memory.current().placeIndex != selected)
        }
    }

    @Test
    fun theSelectedPlaceShowsAndSwipesAndArrowsSwitchPlaces() {
        show()
        rule.onNodeWithText("회현동", useUnmergedTree = true).assertExists()
        rule.onNodeWithText("어제보다 -2˚, 구름많음", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(ForecastTags.NEXT).performClick()
        rule.waitForIdle()
        assertEquals(2, memory.current().placeIndex)
        rule.onNodeWithText("런던", useUnmergedTree = true).assertExists()
        rule.onNodeWithText("Weather Data Provided by Visual Crossing", useUnmergedTree = true).assertExists()
        // The current position is off: next from London is Seoul again.
        rule.onNodeWithTag(ForecastTags.HEADER).performTouchInput { swipeLeft(durationMillis = 100) }
        rule.waitForIdle()
        assertEquals(1, memory.current().placeIndex)
        rule.onNodeWithTag(ForecastTags.HEADER).performTouchInput { swipeRight(durationMillis = 100) }
        rule.waitForIdle()
        assertEquals(2, memory.current().placeIndex)
        assertEquals("one request each: the gate held the swipe back to Seoul", 2, requests.size)
    }

    @Test
    fun tappingTheSelectedTabReloadsAndShowsTheSpinner() {
        val pending = CompletableDeferred<String>()
        show(answer = { url -> if (requests.size == 2) pending.await() else if ("51.51" in url) londonBody else seoulBody })
        rule.onAllNodesWithTag(WeatherTabTags.SPINNER, useUnmergedTree = true).assertCountEquals(0)
        rule.mainClock.advanceTimeBy(1000)
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitForIdle()
        assertEquals("the tab tap loads at once", 2, requests.size)
        rule.onNodeWithTag(WeatherTabTags.SPINNER, useUnmergedTree = true).assertExists()
        pending.complete(seoulBody)
        rule.waitForIdle()
        rule.onAllNodesWithTag(WeatherTabTags.SPINNER, useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun aFailedLoadAsksToRetry() {
        var fail = true
        show(answer = { url -> if (fail) throw HttpStatusException(500) else if ("51.51" in url) londonBody else seoulBody })
        rule.onNodeWithTag(RETRY_DIALOG).assertExists()
        rule.onNodeWithTag(PopupTags.POPUP).assertWidthIsEqualTo(250.dp)
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_FAIL_TO_GET_WEATHER_INFO)).assertExists()
        fail = false
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_OK)).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithTag(RETRY_DIALOG).assertCountEquals(0)
        assertEquals(2, requests.size)
        rule.onNodeWithText("어제보다 -2˚, 구름많음", useUnmergedTree = true).assertExists()
    }

    @Test
    fun thePollenRowOpensItsPopupAndTheExpanderIsSaved() {
        val withPollen = Json.parseToJsonElement(seoulBody).jsonObject.let { body ->
            val days = (body["midData"] as JsonObject)["dailyData"] as kotlinx.serialization.json.JsonArray
            val today = days.indexOfFirst { (it as JsonObject)["date"]?.let { d -> (d as JsonPrimitive).content == "20261108" } == true }
            val pollenDay = JsonObject((days[today] as JsonObject) + mapOf("pollenGrade" to JsonPrimitive(2), "pollenStr" to JsonPrimitive("높음"),
                "flowerPineGrade" to JsonPrimitive(2), "flowerPineStr" to JsonPrimitive("높음")))
            val midData = JsonObject((body["midData"] as JsonObject) + ("dailyData" to kotlinx.serialization.json.JsonArray(days.toMutableList().also { it[today] = pollenDay })))
            JsonObject(body + ("midData" to midData)).toString()
        }
        show(answer = { withPollen })
        rule.onNodeWithTag(ForecastTags.POLLEN).performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.POLLEN_DIALOG).assertExists()
        rule.onNodeWithTag(WeatherTabTags.POLLEN_DIALOG).assertHeightIsEqualTo(
            rule.onRoot().getUnclippedBoundsInRoot().let { it.bottom - it.top })
        rule.onNodeWithTag(PopupTags.POPUP).assertWidthIsEqualTo(300.dp)
        rule.onNodeWithText("${rule.activity.getString(R.string.LOC_POLLEN_PINE)}: 높음").assertExists()
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_CLOSE)).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithTag(WeatherTabTags.POLLEN_DIALOG).assertCountEquals(0)

        rule.onNodeWithTag(net.wizardfactory.todayweather.ui.chart.EXPANDER_TAG).performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue("expandShortChart is saved", memory.current().expandShortChart)
    }

    @Test
    fun aLateResponseStaysWithItsPlace() {
        val seoulAnswer = CompletableDeferred<String>()
        show(answer = { url -> if ("51.51" in url) londonBody else seoulAnswer.await() })
        rule.onNodeWithTag(ForecastTags.NEXT).performClick()
        rule.waitForIdle()
        seoulAnswer.complete(seoulBody)
        rule.waitForIdle()
        rule.onNodeWithText("런던", useUnmergedTree = true).assertExists()
        rule.onAllNodesWithTag(ForecastTags.HEADER).assertCountEquals(1)
        rule.onNodeWithText("어제보다 -1˚, 구름적음", useUnmergedTree = true).assertExists()
        val seoulTemp = runBlocking { repository.cached(seoul) }!!.weather["currentWeather"]!!.jsonObject["t1h"]
        assertEquals("Seoul's answer went to Seoul", JsonPrimitive(3.3), seoulTemp)
    }

    /** The current position's header glyph (tab-forecast.html, `isLocationEnabled()`): `location_on` or `location_off`, as each draw finds it. */
    @Test
    fun theLocationGlyphFollowsTheLocationSetting() {
        location(on = false)
        show(places = listOf(here, london), index = 0)
        assertEquals(setOf(" $LOCATION_OFF"), glyphs())
        location(on = true)
        rule.onNodeWithTag(ForecastTags.NEXT).performClick()
        rule.waitForIdle()
        assertEquals("only the current position has it", emptySet<String>(), glyphs())
        // Back on the current position the header is drawn again, with the setting as it is now.
        rule.onNodeWithTag(ForecastTags.NEXT).performClick()
        rule.waitForIdle()
        assertEquals(0, memory.current().placeIndex)
        assertEquals(setOf(" $LOCATION_ON"), glyphs())
    }

    /**
     * `switchToLocationSettings()`: with location off a tap opens the location settings, and the place loads again when
     * the app comes back; with location on it does nothing and the return waits for the ten-minute gate.
     */
    @Test
    fun aGlyphTapWithLocationOffOpensTheSettingsAndReloadsOnReturn() {
        location(on = false)
        show(places = listOf(here, london), index = 0)
        assertEquals(1, requests.size)
        rule.onNodeWithTag(WeatherTabTags.LOCATION).performClick()
        rule.waitForIdle()
        assertEquals(Settings.ACTION_LOCATION_SOURCE_SETTINGS, shadowOf(rule.activity).nextStartedActivity?.action)
        session.reload(WeatherSession.Sender.RESUME)
        rule.waitForIdle()
        assertEquals("the return loads the place again", 2, requests.size)

        location(on = true)
        rule.onNodeWithTag(WeatherTabTags.LOCATION).performClick()
        rule.waitForIdle()
        assertNull("location on: no hand-off", shadowOf(rule.activity).nextStartedActivity)
        session.reload(WeatherSession.Sender.RESUME)
        rule.waitForIdle()
        assertEquals("the gate holds the return", 2, requests.size)
    }

    /** O08 from S03's source row (`popUpAirForecastInfo`): the AirKorea text, or the KAQ text for a `kaq` source. */
    @Test
    fun theAirSourceRowOpensItsDialogForEitherSource() {
        val kaqBody = Json.parseToJsonElement(seoulBody).jsonObject.let { body ->
            val list = body["airInfoList"] as kotlinx.serialization.json.JsonArray
            val first = JsonObject((list[0] as JsonObject) + ("forecastSource" to JsonPrimitive("kaq")))
            JsonObject(body + ("airInfoList" to kotlinx.serialization.json.JsonArray(listOf(first) + list.drop(1)))).toString()
        }
        var kaq = false
        show(answer = { if (kaq) kaqBody else seoulBody })
        for ((source, text) in listOf("AIRKOREA" to R.string.LOC_AIRKOREA_DESCRIPTION, "KAQ" to R.string.LOC_KAQ_DESCRIPTION)) {
            if (source == "KAQ") {
                kaq = true
                rule.mainClock.advanceTimeBy(1000)
                rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
                rule.waitForIdle()
            }
            rule.onNodeWithText("$source ", substring = true, useUnmergedTree = true).performScrollTo().performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(WeatherTabTags.SOURCE_DIALOG).assertExists()
        rule.onNodeWithTag(WeatherTabTags.SOURCE_DIALOG).assertHeightIsEqualTo(
            rule.onRoot().getUnclippedBoundsInRoot().let { it.bottom - it.top })
            rule.onNodeWithTag(PopupTags.POPUP).assertWidthIsEqualTo(250.dp)
            rule.onNodeWithText(rule.activity.getString(text)).assertExists()
            rule.onNodeWithText(rule.activity.getString(R.string.LOC_CLOSE)).performClick()
            rule.waitForIdle()
            rule.onAllNodesWithTag(WeatherTabTags.SOURCE_DIALOG).assertCountEquals(0)
        }
    }

    private val here = Place(true, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private fun location(on: Boolean) = shadowOf(rule.activity.getSystemService(LocationManager::class.java)).setLocationEnabled(on)

    /** The texts of the header's location glyph; none while it does not show. */
    private fun glyphs(): Set<String> =
        rule.onAllNodes(hasAnyAncestor(hasTestTag(WeatherTabTags.LOCATION)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Text), useUnmergedTree = true)
            .fetchSemanticsNodes().flatMap { node -> node.config[SemanticsProperties.Text].map { it.text } }.toSet()
}
