package net.wizardfactory.todayweather.ui.start

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.espresso.Espresso
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.Telemetry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.core.storage.startShows
import net.wizardfactory.todayweather.search.Prediction
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.nation.NationTags
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
 * S01 and the current position's popups in the app's screens (#2889 AC1): the access notice, a city shortcut, a
 * place prediction, 현재위치 날씨보기 with location granted, denied once, denied permanently, approximate only and
 * location services off, the add alert, Android back, and over the tabs O02 with no enabled place and O03's position
 * variant. The real flow, session and repository run over a fake server answering with the AN-02 corpus; the device's
 * location and the place search are doubles.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class StartScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val inputs = File(File(System.getProperty("tw.projectDir")!!), "../core-domain/src/test/resources/corpus/inputs")
    private val seoulBody = File(inputs, "kma-seoul.json").readText()
    private val geocodeBody = File(inputs, "geocode-seoul.json").readText()
    private val addressBody = """{"country":"KR","address":"대한민국 서울특별시 중구 회현동","location":{"lat":37.56,"long":126.98}}"""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val requests = mutableListOf<String>()
    private val opened = mutableListOf<String>()
    private val events = mutableListOf<String>()
    private var exits = 0

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    /** The device's location: the prompt answers with [answers] in turn, the next one waiting until it is given. */
    private class Device(var enabled: Boolean, var status: PermissionStatus, var fix: Location? = Location(37.5612, 126.9787),
                         val answers: ArrayDeque<PermissionStatus> = ArrayDeque()) : LocationAccess {
        val calls = mutableListOf<String>()
        val highAccuracy = CompletableDeferred<Boolean>()
        override fun enabled() = enabled
        override fun status() = status
        override suspend fun request(): PermissionStatus {
            calls += "prompt"
            status = answers.removeFirst()
            return status
        }
        override suspend fun position(): Location? {
            calls += "position"
            return fix
        }
        override suspend fun requestHighAccuracy(): Boolean {
            calls += "highAccuracy"
            return highAccuracy.await()
        }
    }

    private lateinit var memory: Memory

    @After fun stop() = scope.cancel()

    private fun string(id: Int) = rule.activity.getString(id)

    private fun http(weather: suspend () -> String = { seoulBody }) = HttpGet { url, _ ->
        requests += url
        when {
            "/geocode/v000903/coord/" in url -> geocodeBody
            "/geocode/v000903/addr/" in url -> addressBody
            else -> weather()
        }
    }

    /** S01 of a new install over [device], with [predictions] for the search box. */
    private fun start(device: Device, weather: suspend () -> String = { seoulBody }, predictions: List<Prediction> = emptyList()) {
        memory = Memory(AppState(places = listOf(Place.currentPositionPlaceholder()), placeIndex = -1, units = UnitSettings.defaults("KR")))
        val get = http(weather)
        val repository = WeatherRepository("https://server.test.invalid", null, get, io = Dispatchers.Unconfined)
        val telemetry = Telemetry { name, params -> events += "$name:${params.values.joinToString()}" }
        val flow = StartFlow(memory, repository, GeocodeClient("https://server.test.invalid", get), device, { listOf("ko-KR") }, telemetry)
        val page = StartPage(flow, scope)
        rule.setContent {
            val state by memory.flow.collectAsState()
            if (state.startShows) {
                StartScreen(page, { predictions }, { TownSearch(emptyList()) }, onExit = { exits++ }, openAppSettings = { opened += "app" },
                    openLocationSettings = { opened += "location" })
            }
        }
        rule.waitForIdle()
    }

    private fun closeNotice() {
        rule.onNodeWithText(string(R.string.LOC_NEEDS_ACCESS_TO)).assertExists()
        rule.onNodeWithTag(PopupTags.BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
    }

    private fun tapLocation() {
        rule.onNodeWithTag(StartTags.LOCATION).performClick()
        rule.waitForIdle()
    }

    /** O04 open with [lines] and the buttons [buttons], left to right. */
    private fun assertConfirm(lines: List<Int>, buttons: List<Int>) {
        rule.onNodeWithText(string(R.string.LOC_ERROR)).assertExists()
        rule.onNodeWithText(lines.joinToString("\n") { string(it) }).assertExists()
        val labels = rule.onAllNodesWithTag(PopupTags.BUTTON).fetchSemanticsNodes().map { it.config[SemanticsProperties.Text].joinToString() }
        assertEquals(buttons.map { string(it) }, labels)
    }

    private fun tapButton(id: Int) {
        rule.onNodeWithText(string(id), useUnmergedTree = true).performClick()
        rule.waitForIdle()
    }

    @Test
    fun theNoticeOpensOnEntryAndAShortcutAddsItsCity() {
        start(Device(true, PermissionStatus.GRANTED))
        // O01 over the page, then the 17 shortcuts of a 832 dp screen and 현재위치 날씨보기.
        closeNotice()
        rule.onAllNodesWithTag(StartTags.CHIPS).assertCountEquals(1)
        rule.onNodeWithTag(StartTags.chip(16)).assertExists()
        rule.onNodeWithTag(StartTags.chip(17)).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.chip(0)).performClick()
        rule.waitForIdle()
        // `OnGetWeather`: the weather by the shortcut's coordinates, then the city added and S01 closed on it.
        assertEquals(listOf("/weather/v000903/coord/37.567,126.978"), requests.map { it.removePrefix("https://server.test.invalid").substringBefore('?') })
        val state = memory.current()
        assertEquals(listOf("서울", "대한민국 서울특별시"), listOf(state.places[1].name, state.places[1].address))
        assertEquals(1, state.placeIndex)
        assertFalse(state.startShows)
        assertTrue("favorite_change:add" in events)
    }

    @Test
    fun grantedLocationAddsTheCurrentPosition() {
        val device = Device(true, PermissionStatus.GRANTED)
        start(device)
        closeNotice()
        tapLocation()
        assertEquals(listOf("position"), device.calls)
        // The fix rounded, geocoded, its weather loaded; slot 0 enabled, named from the geocode and selected.
        assertTrue(requests.first().endsWith("/geocode/v000903/coord/37.561,126.979"))
        val state = memory.current()
        assertEquals("회현동", state.places[0].name)
        assertFalse(state.places[0].disable)
        assertEquals(0, state.placeIndex)
        assertFalse(state.startShows)
        assertTrue("location_permission:granted" in events)
    }

    /** Android 12+'s approximate access is granted access (the native app's difference): its coarse fix is used. */
    @Test
    fun approximateLocationOnlyIsUsed() {
        val device = Device(true, PermissionStatus.NOT_REQUESTED, fix = Location(37.56, 126.98), answers = ArrayDeque(listOf(PermissionStatus.GRANTED)))
        start(device)
        closeNotice()
        tapLocation()
        // The prompt's grant runs the attempt again at once, without a popup.
        assertEquals(listOf("prompt", "position"), device.calls)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertFalse(memory.current().startShows)
        assertEquals(listOf("location_permission:denied", "location_permission:granted"), events.filter { it.startsWith("location_permission") })
    }

    @Test
    fun aDenialShowsTheDeniedConfirmAndOkAsksAgain() {
        val device = Device(true, PermissionStatus.NOT_REQUESTED, answers = ArrayDeque(listOf(PermissionStatus.DENIED_ONCE, PermissionStatus.DENIED_ALWAYS)))
        start(device)
        closeNotice()
        tapLocation()
        // Denied once: 위치 서비스에 대한 사용이 거부되었습니다, Close and OK.
        assertConfirm(listOf(R.string.LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED), listOf(R.string.LOC_CLOSE, R.string.LOC_OK))
        tapButton(R.string.LOC_OK)
        // OK prompts again; a permanent denial adds the app-info hint and Settings to the app's page.
        assertEquals(listOf("prompt", "prompt"), device.calls)
        assertConfirm(listOf(R.string.LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED, R.string.LOC_OPENS_THE_APP_INFO_PAGE),
            listOf(R.string.LOC_CLOSE, R.string.LOC_SETTING, R.string.LOC_OK))
        tapButton(R.string.LOC_SETTING)
        assertEquals(listOf("app"), opened)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertTrue(memory.current().startShows)
    }

    @Test
    fun aPermanentDenialAsksNothing() {
        val device = Device(true, PermissionStatus.DENIED_ALWAYS)
        start(device)
        closeNotice()
        tapLocation()
        assertEquals(emptyList<String>(), device.calls)
        assertConfirm(listOf(R.string.LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED, R.string.LOC_OPENS_THE_APP_INFO_PAGE),
            listOf(R.string.LOC_CLOSE, R.string.LOC_SETTING, R.string.LOC_OK))
        tapButton(R.string.LOC_CLOSE)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertEquals(emptyList<String>(), opened)
    }

    @Test
    fun locationServicesOffOfferTheLocationSettings() {
        val device = Device(false, PermissionStatus.GRANTED)
        start(device)
        closeNotice()
        tapLocation()
        // S01 never shows the high-accuracy dialog (D37): the turn-on message with Settings to the location settings.
        assertEquals(emptyList<String>(), device.calls)
        assertConfirm(listOf(R.string.LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION),
            listOf(R.string.LOC_CLOSE, R.string.LOC_SETTING, R.string.LOC_OK))
        tapButton(R.string.LOC_SETTING)
        assertEquals(listOf("location"), opened)
        // Back on with location on, OK finds the position.
        device.enabled = true
        tapLocation()
        assertFalse(memory.current().startShows)
    }

    @Test
    fun noPositionOffersARetry() {
        val device = Device(true, PermissionStatus.GRANTED, fix = null)
        start(device)
        closeNotice()
        tapLocation()
        assertConfirm(listOf(R.string.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION, R.string.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI),
            listOf(R.string.LOC_CLOSE, R.string.LOC_OK))
        device.fix = Location(37.5612, 126.9787)
        tapButton(R.string.LOC_OK)
        assertFalse(memory.current().startShows)
    }

    @Test
    fun aWeatherFailureShowsTheAlertAndKeepsTheStartPage() {
        start(Device(true, PermissionStatus.GRANTED), weather = { throw IOException("offline") })
        closeNotice()
        rule.onNodeWithTag(StartTags.chip(1)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.LOC_FAIL_TO_GET_WEATHER_INFO)).assertExists()
        tapButton(R.string.LOC_OK)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertTrue(memory.current().startShows)
        assertEquals(1, memory.current().places.size)
    }

    @Test
    fun aPredictionReplacesTheShortcutsAndAddsItsPlace() {
        start(Device(true, PermissionStatus.GRANTED), predictions = listOf(Prediction("대한민국 서울특별시 중구 회현동", 14)))
        closeNotice()
        rule.onNodeWithTag(StartTags.INPUT).performTextInput("회현")
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        // The rows and the Google divider replace the shortcuts and the button.
        rule.onNodeWithTag(StartTags.CHIPS).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.LOCATION).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.ATTRIBUTION).assertExists()
        // The keyboard is not up in Robolectric: a tap selects at once.
        rule.onNodeWithTag(StartTags.result(0)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("/geocode/v000903/addr/대한민국 서울특별시 중구 회현동", "/weather/v000903/coord/37.56,126.98"),
            requests.map { it.removePrefix("https://server.test.invalid").substringBefore('?') })
        val added = memory.current().places[1]
        assertEquals(listOf("회현동", "대한민국 서울특별시 중구 회현동"), listOf(added.name, added.address))
        assertFalse(memory.current().startShows)
    }

    @Test
    fun cancelBringsTheShortcutsBack() {
        start(Device(true, PermissionStatus.GRANTED), predictions = listOf(Prediction("London, UK", 0)))
        closeNotice()
        rule.onNodeWithTag(StartTags.CANCEL).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.INPUT).performTextInput("Lon")
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        rule.onNodeWithTag(StartTags.CHIPS).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.CANCEL).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(StartTags.CHIPS).assertExists()
        rule.onNodeWithTag(StartTags.LOCATION).assertExists()
    }

    @Test
    fun backLeavesTheAppAfterClosingThePopup() {
        start(Device(true, PermissionStatus.GRANTED))
        Espresso.pressBack()
        rule.waitForIdle()
        assertEquals("back closes O01 first", 0, exits)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        Espresso.pressBackUnconditionally()
        rule.waitForIdle()
        assertEquals(1, exits)
    }

    /** The weather pages with [places] after S01 (`startVersion` stored), over [device]. */
    private fun tabs(places: List<Place>, index: Int, device: Device): WeatherSession {
        memory = Memory(AppState(places = places, placeIndex = index, units = UnitSettings.defaults("KR")).closeStart().copy(placeIndex = index))
        val repository = WeatherRepository("https://server.test.invalid", null, http(), io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null }, location = device)
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, startTab = Tab.HOURLY,
                openAppSettings = { opened += "app" }, openLocationSettings = { opened += "location" })
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
        return session
    }

    @Test
    fun withNoEnabledPlaceTheWeatherPagesAskHowToStart() {
        val device = Device(true, PermissionStatus.GRANTED)
        val session = tabs(listOf(Place.currentPositionPlaceholder()), -1, device)
        // Hourly opened without a place: O02, with location on preset to the second row (A07: 지역 검색으로 시작 is `true`).
        rule.onNodeWithTag(LocationPopupTags.START_CHOICE).assertExists()
        rule.onNodeWithTag(LocationPopupTags.startChoice(true)).assertIsSelected()
        // Back answers "search": the Locations tab, nothing enabled.
        Espresso.pressBack()
        rule.waitForIdle()
        rule.onNodeWithTag(LocationPopupTags.START_CHOICE).assertDoesNotExist()
        rule.onNodeWithTag(ShellTags.page(Tab.LOCATIONS)).assertExists()
        // A weather tab tapped asks again; OK with the preset value enables the current position on Hourly and loads it.
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.page(Tab.LOCATIONS)).assertExists()
        rule.onNodeWithTag(LocationPopupTags.START_CHOICE_OK).performClick()
        rule.waitForIdle()
        assertFalse(memory.current().places[0].disable)
        assertEquals(0, memory.current().placeIndex)
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
        assertTrue(device.calls.contains("position"))
        assertFalse(session.startPopup.value)
    }

    @Test
    fun aDeniedCurrentPositionOffersSearchOrSettings() {
        val device = Device(true, PermissionStatus.DENIED_ALWAYS)
        val current = Place(currentPosition = true, disable = false, name = "회현동", address = "대한민국 서울특별시 중구 회현동", location = Location(37.56, 126.98))
        tabs(listOf(current, Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))), 0, device)
        // O03 `forecast`, denied always: the hint, Search and Settings, no retry.
        rule.onNodeWithText(listOf(R.string.LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED, R.string.LOC_OPENS_THE_APP_INFO_PAGE)
            .joinToString("\n") { string(it) }).assertExists()
        rule.onAllNodesWithTag(PopupTags.BUTTON).assertCountEquals(2)
        tapButton(R.string.LOC_SEARCH)
        // Search disables the current position, selects the next place and opens the Locations tab.
        assertTrue(memory.current().places[0].disable)
        assertEquals(1, memory.current().placeIndex)
        rule.onNodeWithTag(ShellTags.page(Tab.LOCATIONS)).assertExists()
    }

    /** O17 on S01: the loading overlay shows while the chosen place's weather loads, and Android back waits for it. */
    @Test
    fun theLoadingOverlayShowsWhileAPlaceLoads() {
        val answer = CompletableDeferred<String>()
        start(Device(true, PermissionStatus.GRANTED), weather = { answer.await() })
        closeNotice()
        rule.onNodeWithTag(NationTags.LOADING).assertDoesNotExist()
        rule.onNodeWithTag(StartTags.chip(0)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(NationTags.LOADING).assertExists()
        Espresso.pressBackUnconditionally()
        rule.waitForIdle()
        assertEquals("back waits for the load", 0, exits)
        answer.complete(seoulBody)
        rule.waitForIdle()
        rule.onNodeWithTag(NationTags.LOADING).assertDoesNotExist()
        assertFalse(memory.current().startShows)
    }

    /** With the keyboard up a tap on a result only closes the keyboard (`cordova.plugins.Keyboard.isVisible()`); without it the tap adds. */
    @Test
    fun aTapWhileTheKeyboardIsUpOnlyClosesIt() {
        start(Device(true, PermissionStatus.GRANTED), predictions = listOf(Prediction("대한민국 서울특별시 중구 회현동", 14)))
        closeNotice()
        rule.onNodeWithTag(StartTags.INPUT).performTextInput("회현")
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        keyboard(up = true)
        rule.onNodeWithTag(StartTags.result(0)).performClick()
        rule.waitForIdle()
        assertEquals("nothing is added", emptyList<String>(), requests)
        assertTrue(memory.current().startShows)
        rule.onNodeWithTag(StartTags.result(0)).assertExists()
        keyboard(up = false)
        rule.onNodeWithTag(StartTags.result(0)).performClick()
        rule.waitForIdle()
        assertEquals(2, requests.size)
        assertFalse(memory.current().startShows)
    }

    /** S01 hides the banner while it shows and its close shows it again (`setShowAds`); the tabs load after it. Without S01 nothing changes. */
    @Test
    fun theBannerHidesOnTheStartPageAndShowsAfterIt() = runBlocking {
        val open = AppState()
        assertTrue(open.startShows)
        val states = MutableStateFlow<AppState?>(null)
        val calls = mutableListOf<Boolean>()
        val after = async { hideBannerWhileStartShows(states, calls::add) }
        yield()
        assertEquals(emptyList<Boolean>(), calls)
        states.value = open
        yield()
        assertEquals(listOf(false), calls)
        states.value = open.closeStart()
        assertEquals(open.closeStart(), after.await())
        assertEquals(listOf(false, true), calls)
        val none = mutableListOf<Boolean>()
        assertEquals(open.closeStart(), hideBannerWhileStartShows(MutableStateFlow(open.closeStart()), none::add))
        assertEquals(emptyList<Boolean>(), none)
    }

    /**
     * The keyboard [up] or down, as the window's insets tell the page. Robolectric has no keyboard, and insets given to
     * its window do not reach the page, so they go to the page's view directly, as MainActivity's edge-to-edge window passes them on.
     */
    private fun keyboard(up: Boolean) {
        rule.runOnUiThread {
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, if (up) 600 else 0))
                .setVisible(WindowInsetsCompat.Type.ime(), up)
                .build()
            ViewCompat.dispatchApplyWindowInsets(rule.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0), insets)
        }
        rule.waitForIdle()
    }
}
