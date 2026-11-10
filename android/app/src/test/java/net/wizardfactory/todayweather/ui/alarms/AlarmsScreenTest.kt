package net.wizardfactory.todayweather.ui.alarms

import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.datastore.core.DataStoreFactory
import java.nio.file.Files
import java.util.Collections
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import net.wizardfactory.todayweather.AppStateHolder
import net.wizardfactory.todayweather.core.data.PushSync
import net.wizardfactory.todayweather.core.data.PushTransport
import net.wizardfactory.todayweather.core.storage.AppStateSerializer
import net.wizardfactory.todayweather.core.storage.PushRequest
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import android.view.ViewGroup
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import java.io.File
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.AlertIntro
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.AlarmPage
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.NotificationAccess
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushRecords
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.notify.PushMessage
import net.wizardfactory.todayweather.search.BundledTowns
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.places.PlacesHost
import net.wizardfactory.todayweather.ui.places.PlacesTags
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.PopupTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S09 in the app's screens (#2893): the bells open it for their place, Cancel and Save with O11, O12 and O13, the picker,
 * Android back, the bells of a new S02 visit after a save, O06 over the tabs and O07 one message at a time. The page,
 * session and repository run over a fake server and an in-memory state; notifications are a double.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class AlarmsScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val inputs = File(File(System.getProperty("tw.projectDir")!!), "../core-domain/src/test/resources/corpus/inputs")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val zone = TimeZone.getTimeZone("Asia/Seoul")
    private var savedZone: TimeZone? = null
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val busan = Place(false, false, "부산광역시", "대한민국 부산광역시", "KR", Location(35.18, 129.08))
    private val places = listOf(Place.currentPositionPlaceholder(), seoul, busan)
    private val saves = mutableListOf<Pair<Int, List<JsonObject>>>()
    private val settingsOpened = mutableListOf<String>()
    private val answers = mutableListOf<Boolean>()
    private val messages = MutableSharedFlow<PushMessage>(extraBufferCapacity = 4)
    private lateinit var memory: Memory

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private class Access(var on: Boolean = true) : NotificationAccess {
        val calls = mutableListOf<String>()
        override val available = true
        override fun enabled(): Boolean { calls += "has"; return on }
        override suspend fun request(): Boolean { calls += "grant"; return on }
    }

    private object Device : LocationAccess {
        override fun enabled() = true
        override fun status() = PermissionStatus.GRANTED
        override suspend fun request() = PermissionStatus.GRANTED
        override suspend fun position() = Location(37.5665, 126.978)
        override suspend fun requestHighAccuracy() = true
    }

    private val access = Access()

    @Before fun zone() {
        savedZone = TimeZone.getDefault()
        TimeZone.setDefault(zone)
    }

    @After fun stop() {
        scope.cancel()
        savedZone?.let(TimeZone::setDefault)
    }

    private fun string(id: Int) = rule.activity.getString(id)

    private fun records(index: Int, start: Double, end: Double) = listOf(
        PushRecords.newAlert(1, index, start, end, places, System.currentTimeMillis(), zone),
        PushRecords.newAlarm(2, index, 7 * 3600 + 40 * 60, listOf(false, true, true, true, true, true, false), places, System.currentTimeMillis(), zone))

    private fun show(push: PushState = PushState(fcmToken = "t"), index: Int = 1, tab: Tab = Tab.HOURLY, intro: Boolean = false) {
        memory = Memory(AppState(places = places, placeIndex = index, units = UnitSettings.defaults("KR"), push = push).closeStart().copy(placeIndex = index))
        val http = HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }
        val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val alarms = AlarmsHost { s, openSettings ->
            // The page changed the state; the post would send the place's list as stored.
            AlarmPage(memory, access, post = { i -> saves += i to memory.current().push.records.filter { PushRecords.cityIndex(it) == i } },
                openSettings = openSettings, scope = s)
        }
        val alertIntro = object : AlertIntro {
            private var shown = false
            override fun due() = intro && !shown.also { shown = true }
            override fun answer(enable: Boolean) { answers += enable }
        }
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            val placesHost = PlacesHost(null, { TownSearch(BundledTowns.load(context)) }) { s ->
                PlacesPage(memory, repository, session, StartFlow(memory, repository, GeocodeClient("https://server.test.invalid", http), Device,
                    { listOf("ko-KR") }), Device, s, removeAlarms = {})
            }
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, startTab = tab, places = placesHost, alarms = alarms,
                messages = messages, alertIntro = alertIntro, openAppSettings = { settingsOpened += "app" })
        }
        rule.waitForIdle()
    }

    private fun popupTitle() = rule.onAllNodesWithTag(PopupTags.POPUP).fetchSemanticsNodes().size

    @Test
    fun theHeaderBellOpensS09ForTheSelectedPlaceAndCancelAsksFirst() {
        show(index = 2)
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.PAGE).assertExists()
        rule.onNode(hasText("부산광역시") and hasAnyAncestor(hasTestTag(AlarmsTags.PAGE)), useUnmergedTree = true).assertExists()
        assertEquals(listOf("grant", "has"), access.calls)
        // The defaults are edits: Cancel opens O12 ("Save"); its Close leaves without saving.
        rule.onNodeWithTag(AlarmsTags.CANCEL).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Save", useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_CLOSE), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.PAGE).assertDoesNotExist()
        assertEquals(emptyList<Pair<Int, List<JsonObject>>>(), saves)
    }

    @Test
    fun aRowBellOpensS09ForItsPlaceAndASaveLightsItsBell() {
        show(index = 2, tab = Tab.LOCATIONS)
        rule.onNodeWithTag(PlacesTags.bell(1)).assertTextEquals(Glyphs.NOTIFICATIONS_NONE)
        rule.onNodeWithTag(PlacesTags.bell(1)).performClick()
        rule.waitForIdle()
        // `setCityIndex(fav)`: the place of the row is selected.
        assertEquals(1, memory.current().placeIndex)
        rule.onNode(hasText("서울") and hasAnyAncestor(hasTestTag(AlarmsTags.PAGE)), useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        assertEquals(listOf(1), saves.map { it.first })
        assertEquals(listOf("alert", "alarm", "alarm"), saves.single().second.map { (it["category"] as JsonPrimitive).content })
        // Back on S02, a new visit reads the bells (`cache: false`): the row's bell rings.
        rule.onNodeWithTag(AlarmsTags.PAGE).assertDoesNotExist()
        rule.onNodeWithTag(PlacesTags.bell(1)).assertTextEquals(Glyphs.NOTIFICATIONS)
    }

    /** Holds the first request until [release]; records every request. */
    private class HeldTransport : PushTransport {
        val sent: MutableList<PushRequest> = Collections.synchronizedList(mutableListOf())
        val firstArrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        override suspend fun send(request: PushRequest): Int {
            sent += request
            if (sent.size == 1) {
                firstArrived.complete(Unit)
                release.await()
            }
            return 200
        }
    }

    /**
     * Review F1: while a registration holds the push lock (a unit change's post in flight), an S09 save shows on S02 at
     * once, so the row's bell rings and deleting the place removes its records and sends `DELETE /push` after the posts
     * before it. The app's own writer ([AppStateHolder]) and [PushSync] run over a store file.
     */
    @Test
    fun aSaveShowsOnS02WhileAnotherRegistrationIsSentAndItsPlacesDeleteRemovesIt() {
        val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val file = Files.createTempDirectory("alarms").resolve("app_state.json").toFile()
            val store = DataStoreFactory.create(AppStateSerializer, scope = io) { file }
            val busanAlarm = PushRecords.newAlarm(2, 2, 6 * 3600, List(7) { true }, places, System.currentTimeMillis(), zone)
            runBlocking {
                store.updateData {
                    AppState(places = places, placeIndex = 2, units = UnitSettings.defaults("KR"), push = PushState(fcmToken = "t", records = listOf(busanAlarm)))
                        .closeStart().copy(placeIndex = 2)
                }
            }
            val holder = AppStateHolder(store, io, CompletableDeferred(AppState()).also { it.complete(AppState()) })
            runBlocking { withTimeout(5_000) { holder.state.first { it != null } } }
            val transport = HeldTransport()
            val sync = PushSync(holder.dataStore, transport) { PushRegistration.Context("device", "ko-KR", "2.0.0", UnitSettings.defaults("KR"), 0, zone) }
            io.launch { sync.updateUnits() }
            runBlocking { withTimeout(5_000) { transport.firstArrived.await() } }

            val http = HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }
            val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
            val session = WeatherSession(repository, scope, holder, { listOf("ko-KR") }, { null })
            val alarms = AlarmsHost { s, openSettings ->
                AlarmPage(holder, access, post = { i -> io.launch { sync.postPlace(i) } }, openSettings = openSettings, scope = s)
            }
            rule.setContent {
                val state by holder.state.collectAsState()
                val entries by repository.weather.collectAsState()
                val loading by repository.loading.collectAsState()
                val retry by session.retry.collectAsState()
                val context = LocalContext.current
                val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
                val placesHost = PlacesHost(null, { TownSearch(BundledTowns.load(context)) }) { s ->
                    PlacesPage(holder, repository, session, StartFlow(holder, repository, GeocodeClient("https://server.test.invalid", http), Device,
                        { listOf("ko-KR") }), Device, s, removeAlarms = { i -> io.launch { sync.removeCity(i) } })
                }
                state?.let {
                    AppContent(it, entries, loading, retry, session, host, "test", onExit = {}, startTab = Tab.LOCATIONS, places = placesHost,
                        alarms = alarms, messages = messages, openAppSettings = {})
                }
            }
            rule.waitForIdle()
            rule.onNodeWithTag(PlacesTags.bell(1)).assertTextEquals(Glyphs.NOTIFICATIONS_NONE)
            rule.onNodeWithTag(PlacesTags.bell(1)).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(AlarmsTags.PAGE).assertDoesNotExist()
            assertEquals("the unit change's post still holds the lock", 1, transport.sent.size)
            rule.onNodeWithTag(PlacesTags.bell(1)).assertTextEquals(Glyphs.NOTIFICATIONS)
            rule.onNodeWithTag(PlacesTags.MODE).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(PlacesTags.delete(1)).performClick()
            rule.waitForIdle()
            transport.release.complete(Unit)
            runBlocking { withTimeout(5_000) { while (transport.sent.size < 3) delay(10) } }
            assertEquals(listOf("POST /v000903/push-list", "POST /v000903/push-list", "DELETE /v000903/push"),
                transport.sent.map { "${it.method} ${it.path}" })
            runBlocking { withTimeout(5_000) { while (holder.state.value!!.push.records.any { r -> PushRecords.cityIndex(r) == 1 }) delay(10) } }
            assertEquals(listOf(busanAlarm), runBlocking { store.data.first() }.push.records)
        } finally {
            io.cancel()
        }
    }

    /** Review F4: a handle follows one drag across several hours; its own changes do not restart the gesture. */
    @Test
    fun aDragMovesItsHandleHourByHour() {
        show()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.BAR).assertContentDescriptionEquals("7 — 22")
        fun at(width: Int, height: Int, handle: Float, hour: Int) = Offset(handle / 2 + (width - handle) * hour / 24f, height / 2f)
        rule.onNodeWithTag(AlarmsTags.BAR).performTouchInput { down(at(width, height, 16.dp.toPx(), 7)) }
        rule.waitForIdle()
        for (hour in listOf(8, 10, 12)) {
            rule.onNodeWithTag(AlarmsTags.BAR).performTouchInput { moveTo(at(width, height, 16.dp.toPx(), hour)) }
            rule.waitForIdle()
        }
        rule.onNodeWithTag(AlarmsTags.BAR).performTouchInput { up() }
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.BAR).assertContentDescriptionEquals("12 — 22")
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        val alert = memory.current().push.records.single { PushRecords.category(it) == "alert" }
        assertEquals(12 * 3600, PushRecords.localSeconds(alert["startTime"], zone))
    }

    @Test
    fun androidBackLeavesWithoutTheConfirmation() {
        show()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.PAGE).assertDoesNotExist()
        assertEquals(0, popupTitle())
        assertTrue(saves.isEmpty())
    }

    @Test
    fun thePickerAddsAnAlarmByItsArrowsAndSet() {
        show()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.ADD).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("08 : 00 AM", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(AlarmsTags.up(0)).performClick()
        rule.onNodeWithTag(AlarmsTags.up(1)).performClick()
        rule.onNodeWithTag(AlarmsTags.up(2)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("09 : 05 PM", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(AlarmsTags.PICKER_SET).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.row(2)).assertExists()
        rule.onNodeWithText("21:05", useUnmergedTree = true).assertExists()
        // Delete on a row hides it.
        rule.onNodeWithTag(AlarmsTags.row(0)).performClick()
        rule.onNodeWithTag(AlarmsTags.PICKER_DELETE).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.row(0)).assertDoesNotExist()
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        assertEquals(listOf(false, true, true), saves.single().second.drop(1).map { (it["enable"] as JsonPrimitive).content.toBoolean() })
    }

    /** On a device the shell draws S09 under the status bar: its popups cover the page, not another inset below it. */
    @Test
    fun thePopupsCoverThePageUnderTheStatusBar() {
        show()
        rule.runOnUiThread {
            val insets = WindowInsetsCompat.Builder().setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, 60, 0, 0)).build()
            ViewCompat.dispatchApplyWindowInsets(rule.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0), insets)
        }
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.ADD).performClick()
        rule.waitForIdle()
        val page = rule.onNodeWithTag(AlarmsTags.PAGE).getUnclippedBoundsInRoot()
        val backdrop = rule.onNodeWithTag(AlarmsTags.PICKER_BACKDROP).getUnclippedBoundsInRoot()
        assertTrue("the status bar's inset applies: ${page.top}", page.top.value > 0f)
        assertEquals(page.top.value, backdrop.top.value, 0.5f)
        assertEquals(page.bottom.value, backdrop.bottom.value, 0.5f)
    }

    @Test
    fun equalHoursRefuseTheSave() {
        show(PushState(fcmToken = "t", records = records(1, 9.0, 9.0)))
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME), useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_CLOSE), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AlarmsTags.PAGE).assertExists()
        assertTrue(saves.isEmpty())
    }

    @Test
    fun notificationsOffShowO11AndItsSettingsOpenTheAppsPage() {
        access.on = false
        show()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Permission", useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_SETTING), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals(listOf("app"), settingsOpened)
        // Save is refused with O11 again; nothing saved.
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Permission", useUnmergedTree = true).assertExists()
        assertTrue(saves.isEmpty())
    }

    @Test
    fun theAlertIntroductionShowsOnceAndItsAnswersGoOn() {
        show(PushState(fcmToken = "t", records = records(1, 7.0, 22.0), needsAlertIntro = true), intro = true)
        rule.mainClock.advanceTimeBy(600)
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.LOC_WEATHER_ALERT), useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_OK), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), answers)
        assertEquals(0, popupTitle())
    }

    @Test
    fun foregroundMessagesShowOneAtATime() {
        show()
        messages.tryEmit(PushMessage("서울 맑음 3˚", "내일 아침 -1˚, 낮 9˚", emptyMap(), "1", false))
        messages.tryEmit(PushMessage(null, "only a body", emptyMap(), "2", false))
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.LOC_WEATHER), useUnmergedTree = true).assertExists()
        rule.onNodeWithText("서울 맑음 3˚\n내일 아침 -1˚, 낮 9˚", substring = true, useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_OK), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("only a body", substring = true, useUnmergedTree = true).assertExists()
        rule.onNodeWithText(string(R.string.LOC_OK), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals(0, popupTitle())
    }
}
