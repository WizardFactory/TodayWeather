package net.wizardfactory.todayweather.ui.places

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.search.BundledTowns
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S02 in the app's screens (#2890 AC1): the rows and the bells of the visit, a row tap opening the startup page, edit
 * mode's delete and current-position switch with their alarm removals, a town added from the search, the
 * find-by-location row, O03 `search` and the empty state's focus. The real page, flow, session and repository run over
 * a fake server answering with the AN-02 corpus; the device's location is a double.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class PlacesScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val inputs = File(File(System.getProperty("tw.projectDir")!!), "../core-domain/src/test/resources/corpus/inputs")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val busan = Place(false, false, "부산광역시", "대한민국 부산광역시", "KR", Location(35.18, 129.08))
    private val alarm = Json.parseToJsonElement("""{"cityIndex":1,"id":1,"category":"alarm","enable":true}""") as JsonObject
    private val removed = mutableListOf<Int>()
    private val opened = mutableListOf<String>()

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private class Device(var status: PermissionStatus = PermissionStatus.GRANTED) : LocationAccess {
        override fun enabled() = true
        override fun status() = status
        override suspend fun request() = status
        override suspend fun position() = Location(37.5665, 126.978)
        override suspend fun requestHighAccuracy() = true
    }

    private lateinit var memory: Memory

    @After fun stop() = scope.cancel()

    private fun string(id: Int) = rule.activity.getString(id)

    private fun show(places: List<Place>, index: Int = 1, startupPage: String = "2", records: List<JsonObject> = emptyList(), device: Device = Device()) {
        memory = Memory(AppState(places = places, placeIndex = index, units = UnitSettings.defaults("KR"), settings = Settings(startupPage = startupPage),
            push = PushState(fcmToken = "t", records = records)).closeStart().copy(placeIndex = index))
        val http = HttpGet { url, _ ->
            when {
                "/geocode/" in url -> File(inputs, "geocode-seoul.json").readText()
                else -> File(inputs, "kma-seoul.json").readText()
            }
        }
        val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            val places = PlacesHost(null, { TownSearch(BundledTowns.load(context)) }) { s ->
                PlacesPage(memory, repository, session, StartFlow(memory, repository, GeocodeClient("https://server.test.invalid", http), device,
                    { listOf("ko-KR") }), device, s, removeAlarms = { removed += it })
            }
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, places = places, startTab = Tab.LOCATIONS,
                openAppSettings = { opened += "app" }, openLocationSettings = { opened += "location" })
        }
        rule.waitForIdle()
    }

    private fun modeLabel() = rule.onNodeWithTag(PlacesTags.MODE).fetchSemanticsNode().config[SemanticsProperties.Text].joinToString()

    @Test
    fun theRowsShowTheirPlacesAndTheBellsOfTheVisit() {
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan), records = listOf(alarm))
        // The disabled current position shows only in edit mode.
        rule.onNodeWithTag(PlacesTags.row(0)).assertDoesNotExist()
        rule.onNodeWithTag(PlacesTags.bell(1)).assertTextEquals(Glyphs.NOTIFICATIONS)
        rule.onNodeWithTag(PlacesTags.bell(2)).assertTextEquals(Glyphs.NOTIFICATIONS_NONE)
        rule.onNodeWithText("서울", useUnmergedTree = true).assertExists()
        assertEquals(string(R.string.LOC_EDIT), modeLabel())
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.waitForIdle()
        assertEquals(string(R.string.LOC_OK), modeLabel())
        rule.onNodeWithTag(PlacesTags.row(0)).assertExists()
        rule.onNodeWithTag(PlacesTags.TOGGLE).assertExists()
    }

    @Test
    fun aRowTapSelectsThePlaceAndOpensTheStartupPage() {
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan), startupPage = "1")
        rule.onNodeWithTag(PlacesTags.row(2)).performClick()
        rule.waitForIdle()
        assertEquals(2, memory.current().placeIndex)
        rule.onNodeWithTag(ShellTags.page(Tab.DAILY)).assertExists()
    }

    @Test
    fun editModeDeletesWithoutConfirmationAndRemovesTheAlarmsOfARingingBell() {
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan), index = 2, records = listOf(alarm))
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.delete(2)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertEquals("부산광역시 had no alarm", emptyList<Int>(), removed)
        assertEquals("the selected last place: the first enabled one", 1, memory.current().placeIndex)
        rule.onNodeWithTag(PlacesTags.delete(1)).performClick()
        rule.waitForIdle()
        assertEquals(listOf(1), removed)
        assertEquals(1, memory.current().places.size)
    }

    @Test
    fun theCurrentPositionsFirstEnableFindsAndNamesIt() {
        show(listOf(Place.currentPositionPlaceholder(), seoul))
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.onNodeWithTag(PlacesTags.TOGGLE).performClick()
        rule.waitForIdle()
        val current = memory.current().places[0]
        assertFalse(current.disable)
        assertEquals("회현동", current.name)
        // Off again: no alarm rang for it, nothing removed.
        rule.onNodeWithTag(PlacesTags.TOGGLE).performClick()
        rule.waitForIdle()
        assertTrue(memory.current().places[0].disable)
        assertEquals(emptyList<Int>(), removed)
    }

    @Test
    fun aTownFromTheSearchIsAddedAndOpens() {
        show(listOf(Place.currentPositionPlaceholder(), seoul))
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.waitForIdle()
        assertEquals(string(R.string.LOC_CANCEL), modeLabel())
        rule.onNodeWithTag(PlacesTags.INPUT).performTextInput("부산")
        rule.waitForIdle()
        rule.onAllNodesWithTag(PlacesTags.TOWN_DIVIDER).fetchSemanticsNodes().let { assertEquals(1, it.size) }
        rule.onNodeWithTag(PlacesTags.town(0)).performClick()
        rule.waitForIdle()
        val state = memory.current()
        assertEquals("부산광역시", state.places.last().name)
        assertEquals(state.places.lastIndex, state.placeIndex)
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
    }

    @Test
    fun findingByLocationGivesARowThatAddsAnOrdinaryPlace() {
        show(listOf(Place.currentPositionPlaceholder(), seoul))
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.onNodeWithTag(PlacesTags.FIND).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.GOOGLE_DIVIDER).assertExists()
        rule.onNodeWithTag(PlacesTags.FOUND).performClick()
        rule.waitForIdle()
        val added = memory.current().places.last()
        assertEquals("회현동", added.name)
        assertFalse(added.currentPosition)
    }

    /** #2925 F2, F3: with the keyboard up the button finds at once (a result tap only closes it), and the found row replaces the towns. */
    @Test
    fun findingByLocationWithTheKeyboardUpReplacesTheResults() {
        show(listOf(Place.currentPositionPlaceholder(), seoul))
        rule.onNodeWithTag(PlacesTags.INPUT).performClick().performTextInput("부산")
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.TOWN_DIVIDER).assertExists()
        rule.runOnUiThread {
            val insets = WindowInsetsCompat.Builder().setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 600))
                .setVisible(WindowInsetsCompat.Type.ime(), true).build()
            ViewCompat.dispatchApplyWindowInsets(rule.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0), insets)
        }
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.town(0)).performClick()
        rule.waitForIdle()
        assertEquals("the keyboard is up: a town tap only closes it", 2, memory.current().places.size)
        rule.onNodeWithTag(PlacesTags.FIND).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.FOUND).assertExists()
        rule.onNodeWithTag(PlacesTags.town(0)).assertDoesNotExist()
        rule.onNodeWithTag(PlacesTags.TOWN_DIVIDER).assertDoesNotExist()
        rule.onNodeWithTag(PlacesTags.INPUT).assertTextEquals("회현동")
    }

    @Test
    fun aDeniedLookupOpensTheSearchVariant() {
        show(listOf(Place.currentPositionPlaceholder(), seoul), device = Device(PermissionStatus.DENIED_ALWAYS))
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.onNodeWithTag(PlacesTags.FIND).performClick()
        rule.waitForIdle()
        val labels = rule.onAllNodesWithTag(PopupTags.BUTTON).fetchSemanticsNodes().map { it.config[SemanticsProperties.Text].joinToString() }
        assertEquals(listOf(string(R.string.LOC_CLOSE), string(R.string.LOC_SETTING)), labels)
        rule.onNodeWithText(string(R.string.LOC_SETTING), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals(listOf("app"), opened)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
    }

    @Test
    fun withNoEnabledPlaceTheInputTakesFocus() {
        show(listOf(Place.currentPositionPlaceholder()), index = 0)
        rule.mainClock.advanceTimeBy(200)
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.INPUT).assertIsFocused()
        rule.onNodeWithTag(PlacesTags.FIND).assertExists()
    }
}
