package net.wizardfactory.todayweather.ui.air

import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
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
 * S05 in the app's screens (#2888 AC1, AC2): the Air tab with Seoul's three stations from a fake server answering
 * with the AN-02 corpus, through the real session and repository. A station's tap shows its values and a load returns
 * to the first; a detail cell selects its pollutant at the top of the page; S03's air cells open S05 on their
 * pollutant, which stays across the weather tabs until the Locations tab (air-reference/navigation.json); the
 * forecast source opens O08; the current weather opens S03.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class AirTabTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val seoulBody = File(inputs, "kma-seoul.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val requests = mutableListOf<String>()
    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        val state: StateFlow<AppState> = flow
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private lateinit var memory: Memory
    private lateinit var session: WeatherSession

    @After fun stop() = scope.cancel()

    /** The app on Seoul (the current position off) opening on [startupPage]; the server answers with [body]. */
    private fun show(startupPage: String = "3", body: String = seoulBody) {
        memory = Memory(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
            units = UnitSettings.defaults("KR"), settings = Settings(startupPage = startupPage)))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { url, _ -> requests += url; body },
            io = Dispatchers.Unconfined)
        session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {})
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    private fun label(value: String) = rule.onNode(hasText(value) and hasAnyAncestor(hasTestTag(AirTags.LABEL)), useUnmergedTree = true)
    private fun box(text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(AirTags.HEADER)), useUnmergedTree = true)

    @Test
    fun seoulShowsItsStationsAndAnotherStationShowsItsValues() {
        show()
        box("대기상태").assertExists()
        box("좋음").assertExists()
        label("40").assertExists()
        rule.onNodeWithText("측정소 (통합대기)", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(AirTags.station(0)).assertIsSelected()
        // performScrollTo scrolls only the closest scrolling parent (the cells' row): bring the card up first.
        rule.onNodeWithTag(AirTags.STATIONS).performScrollTo()
        rule.onNodeWithTag(AirTags.station(1)).performClick()
        rule.waitForIdle()
        label("47").assertExists()
        rule.onNodeWithTag(AirTags.station(1)).assertIsSelected()
        rule.onNodeWithTag(AirTags.station(0)).assertIsNotSelected()
        rule.onNode(hasText("한강대로", substring = true) and hasAnyAncestor(hasTestTag(AirTags.INFO)), useUnmergedTree = true).assertExists()
        // The page went to the top: the header shows again.
        rule.onNodeWithTag(AirTags.HEADER).assertIsDisplayed()

        // Tapping the selected Air tab loads again: back to the nearest station.
        rule.mainClock.advanceTimeBy(1000)
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        assertEquals("the tab tap loaded again", 2, requests.size)
        rule.onNodeWithTag(AirTags.station(0)).assertIsSelected()
        label("40").assertExists()
    }

    @Test
    fun aDetailCellSelectsItsPollutant() {
        show()
        rule.onNodeWithTag(AirTags.block(4)).performScrollTo()
        rule.onNodeWithTag(AirTags.code("pm25")).performClick()
        rule.waitForIdle()
        box("초미세먼지").assertExists()
        box("12㎍/㎥").assertExists()
        label("12").assertExists()
        rule.onNodeWithTag(AirTags.code("pm25")).assertIsSelected()
        rule.onNodeWithTag(AirTags.code("aqi")).assertIsNotSelected()
        rule.onNodeWithText("측정소 (초미세먼지)", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(AirTags.HEADER).assertIsDisplayed()
        assertEquals("a cell tap loads nothing", 1, requests.size)
    }

    @Test
    fun theWeatherPagesOpenS05OnTheirPollutantUntilTheLocationsTab() {
        // Without the hourly AQI forecast S03 shows the current air card, whose cells link their pollutant.
        val body = Json.parseToJsonElement(seoulBody).jsonObject.let { root ->
            val list = (root["airInfoList"] as kotlinx.serialization.json.JsonArray).map { station ->
                val o = station.jsonObject
                val pollutants = o["pollutants"]!!.jsonObject
                JsonObject(o + ("pollutants" to JsonObject(pollutants + ("aqi" to JsonObject(pollutants["aqi"]!!.jsonObject - "hourly")))))
            }
            JsonObject(root + ("airInfoList" to kotlinx.serialization.json.JsonArray(list))).toString()
        }
        show(startupPage = "0", body = body)
        // The current air card's cell (the detail rows below name it too).
        rule.onAllNodes(hasText("초미세먼지") and hasAnyAncestor(hasTestTag(ForecastTags.PAGE)), useUnmergedTree = true)[0].performScrollTo().performClick()
        rule.waitForIdle()
        box("초미세먼지").assertExists()
        rule.onNodeWithTag(AirTags.code("pm25")).assertIsSelected()
        // The weather tabs keep `?code=pm25`: S05 opens on it again.
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        box("초미세먼지").assertExists()
        // A detail tap changes only the page: the link's pollutant comes back on the next visit.
        rule.onNodeWithTag(AirTags.block(4)).performScrollTo()
        rule.onNodeWithTag(AirTags.code("o3")).performScrollTo().performClick()
        rule.waitForIdle()
        box("오존").assertExists()
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        box("초미세먼지").assertExists()
        // The Locations tab clears it.
        rule.onNodeWithTag(ShellTags.tab(Tab.LOCATIONS)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        box("대기상태").assertExists()
    }

    @Test
    fun theForecastSourceOpensItsPopupAndTheWeatherOpensS03() {
        show()
        rule.onNodeWithText("AIRKOREA", substring = true, useUnmergedTree = true).performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.SOURCE_DIALOG).assertExists()
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_AIRKOREA_DESCRIPTION)).assertExists()
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_CLOSE)).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithTag(WeatherTabTags.SOURCE_DIALOG).assertCountEquals(0)

        rule.onNodeWithTag(AirTags.WEATHER).performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ForecastTags.PAGE).assertExists()
        rule.onAllNodesWithTag(AirTags.PAGE).assertCountEquals(0)
    }
}
