package net.wizardfactory.todayweather.ui.nation

import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.HttpStatusException
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
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The nationwide and warning pages in the app's screens (#2892):
 * - 기상특보, 전국날씨 and 전국미세먼지 close the menu and open their page, which sends its request each time it opens;
 * - back and Android back leave the pages, except while S10 or S11 loads (`$ionicLoading` disables Android back);
 * - S10's modes and S11's tabs change the labels;
 * - a failed answer leaves the names;
 * - an open page keeps its answer when the activity is recreated.
 * The real session and repository answer from a fake server with the AN-02 corpus.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class NationTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val seoulBody = File(inputs, "kma-seoul.json").readText()
    private val nationBody = File(inputs, "nation.json").readText()
    private val specialBody = File(inputs, "special.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val requests = mutableListOf<String>()
    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        val state: StateFlow<AppState> = flow
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    @After fun stop() = scope.cancel()

    /** How the server answers the nation request: the corpus, a failure, or when [late] completes. */
    private var failing = false
    private var late: CompletableDeferred<Unit>? = null

    private fun show(restoration: StateRestorationTester? = null) {
        val memory = Memory(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { url, _ -> requests += url; seoulBody }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val source = NationSource("https://server.test.invalid", HttpGet { url, _ ->
            requests += url
            late?.await()
            if (failing) throw HttpStatusException(500)
            nationBody
        }, HttpGet { url, _ -> requests += url; specialBody })
        val nation = NationLoads(source, scope, { memory.current().units }, { listOf("ko-KR") }, { "Asia/Seoul" })
        val setContent: (@androidx.compose.runtime.Composable () -> Unit) -> Unit = restoration?.let { r -> { r.setContent(it) } } ?: { rule.setContent(it) }
        setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, nation = nation)
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    private fun menu(row: MenuRow) {
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private fun menuOpen() = rule.onAllNodesWithTag(ShellTags.MENU).fetchSemanticsNodes().isNotEmpty()
    private fun pageShown() = rule.onAllNodesWithTag(NationTags.PAGE).fetchSemanticsNodes().isNotEmpty()
    private fun onPage(text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(NationTags.PAGE)), useUnmergedTree = true)
    private fun inLabel(name: String, text: String) =
        rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(NationTags.label(name))), useUnmergedTree = true)
    private fun back() = rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }.also { rule.waitForIdle() }
    private fun sent(path: String) = requests.count { path in it }

    @Test
    fun eachRowClosesTheMenuAndOpensItsPageWhichSendsItsRequest() {
        show()
        menu(MenuRow.SPECIAL_WEATHER)
        assertTrue("기상특보 closes the menu", !menuOpen())
        onPage("기상특보").assertExists()
        onPage("기상특보 2026. 11. 8. 오전 12:00:00").assertExists()
        assertEquals(1, sent("/v000903/kma/special"))
        rule.onNodeWithTag(NationTags.BACK).performClick()
        rule.waitForIdle()
        assertTrue(!pageShown())

        menu(MenuRow.NATIONAL_WEATHER)
        assertTrue(!menuOpen())
        onPage("한국").assertExists()
        inLabel("서울", "3.3").assertExists()
        assertEquals(listOf("https://server.test.invalid/v000903/nation/KR?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km" +
            "&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq"), requests.filter { "/nation/" in it })
        back()
        assertTrue(!pageShown())

        menu(MenuRow.NATIONAL_AIR)
        inLabel("서울", "12").assertExists()
        assertEquals("each opening sends the request again (cache: false)", 2, sent("/v000903/nation/KR"))
        back()
        menu(MenuRow.SPECIAL_WEATHER)
        assertEquals(2, sent("/v000903/kma/special"))
    }

    @Test
    fun modesAndTabsChangeTheLabels() {
        show()
        menu(MenuRow.NATIONAL_WEATHER)
        rule.onNodeWithTag(NationTags.mode(1)).performClick()
        rule.waitForIdle()
        inLabel("서울", "0mm").assertExists()
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        rule.waitForIdle()
        inLabel("서울", "북").assertExists()
        inLabel("서울", "2.3m/s").assertExists()
        back()

        menu(MenuRow.NATIONAL_AIR)
        rule.onNodeWithTag(NationTags.tab("pm10")).performClick()
        rule.waitForIdle()
        inLabel("서울", "25").assertExists()
        rule.onNodeWithTag(NationTags.STRIP).performTouchInput { swipeLeft() }
        rule.onNodeWithTag(NationTags.tab("co")).performClick()
        rule.waitForIdle()
        inLabel("서울", "0.438").assertExists()
    }

    @Test
    fun whileTheMapLoadsAndroidBackDoesNothing() {
        late = CompletableDeferred()
        show()
        menu(MenuRow.NATIONAL_WEATHER)
        rule.onNodeWithTag(NationTags.LOADING).assertExists()
        back()
        assertTrue("Ionic disables Android back while loading", pageShown())
        late!!.complete(Unit)
        rule.waitForIdle()
        rule.onAllNodesWithTag(NationTags.LOADING).assertCountEquals(0)
        inLabel("서울", "3.3").assertExists()
        back()
        assertTrue(!pageShown())
    }

    @Test
    fun aFailedAnswerLeavesTheNames() {
        failing = true
        show()
        menu(MenuRow.NATIONAL_WEATHER)
        rule.onAllNodesWithTag(NationTags.LOADING).assertCountEquals(0)
        inLabel("서울", "서울").assertExists()
        rule.onAllNodesWithTag(NationTags.label("서울")).assertCountEquals(1)
        rule.onNode(hasText("3.3") and hasAnyAncestor(hasTestTag(NationTags.PAGE)), useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun anOpenPageKeepsItsAnswerWhenTheActivityIsRecreated() {
        // The saved state restored, as after a configuration change; the loads live in the activity's view model.
        val restoration = StateRestorationTester(rule)
        show(restoration)
        menu(MenuRow.NATIONAL_WEATHER)
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        rule.waitForIdle()
        restoration.emulateSavedInstanceStateRestore()
        rule.waitForIdle()
        inLabel("서울", "북").assertExists()
        assertEquals("no second request", 1, sent("/v000903/nation/KR"))
    }
}
