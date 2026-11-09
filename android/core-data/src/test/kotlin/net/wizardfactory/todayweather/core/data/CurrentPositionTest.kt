package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * TabCtrl's own lookup of the current position (`updateCurrentPosition` in `loadWeatherData`, #2889), O03 of type
 * `forecast`, O02's choice (`startPopup`) and `locationOn`. The device is a double; responses are the AN-02 corpus.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CurrentPositionTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val londonBody = File(corpus, "inputs/vc-london.json").readText()
    private val current = Place(currentPosition = true, disable = false, name = "이전", address = "대한민국 서울특별시", location = Location(37.56, 126.98))
    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.51, -0.13))

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    private class Device(var enabled: Boolean, var status: PermissionStatus, var answer: PermissionStatus = PermissionStatus.DENIED_ONCE,
                         highAccuracy: Boolean = false) : LocationAccess {
        /** The high-accuracy dialog's answer; a user answers after the immediate failures. */
        val highAccuracy = CompletableDeferred<Boolean>().apply { if (highAccuracy) complete(true) }
        val calls = mutableListOf<String>()
        var fix: CompletableDeferred<Location?> = CompletableDeferred(Location(37.5701, 126.9822))
        override fun enabled() = enabled
        override fun status() = status
        override suspend fun request(): PermissionStatus {
            calls += "prompt"
            status = answer
            return answer
        }
        override suspend fun position(): Location? {
            calls += "position"
            return fix.await()
        }
        override suspend fun requestHighAccuracy(): Boolean {
            calls += "highAccuracy"
            return highAccuracy.await()
        }
    }

    private class Setup(val state: Memory, val session: WeatherSession, val requests: MutableList<String>, val events: MutableList<String>,
                        val updated: MutableList<Int>)

    private fun TestScope.setup(device: Device, places: List<Place> = listOf(current, london), index: Int = 0): Setup {
        val requests = mutableListOf<String>()
        val events = mutableListOf<String>()
        val updated = mutableListOf<Int>()
        val state = Memory(AppState(places = places, placeIndex = index, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, { url, _ -> requests += url; if ("51.51" in url) londonBody else seoulBody },
            { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        val telemetry = Telemetry { name, params -> if (name == "location_permission") events += "${params["outcome"]}" }
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko-KR") }, { null }, telemetry = telemetry, random = { 0.5 },
            location = device, cityUpdated = { updated += it })
        return Setup(state, session, requests, events, updated)
    }

    private fun coord(lat: String, long: String) =
        "https://server.test.invalid/weather/v000903/coord/$lat,$long?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq"

    @Test
    fun aNewFixReplacesTheSavedLocationAndLoadsAgain() = runTest {
        val t = setup(Device(true, PermissionStatus.GRANTED))
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        // The saved place first, then the rounded fix.
        assertEquals(listOf(coord("37.56", "126.98"), coord("37.57", "126.982")), t.requests)
        assertNull(t.session.positionRetry.value)
        // The fix is saved, then the response's location (the corpus answers 37.56, 126.98 for any request) replaces it.
        assertEquals("회현동", t.state.value.places[0].name)
        assertEquals(listOf("granted"), t.events)
        assertFalse(t.session.locating.value)
        assertTrue(0 in t.updated, "updateCityInfo(0) after the update")
    }

    @Test
    fun theSameFixLoadsNothingMore() = runTest {
        val device = Device(true, PermissionStatus.GRANTED)
        device.fix = CompletableDeferred(Location(37.5604, 126.9799))
        val t = setup(device)
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(listOf(coord("37.56", "126.98")), t.requests)
    }

    @Test
    fun aFixAfterAnotherPlaceWasSelectedIsSavedButNotLoaded() = runTest {
        val device = Device(true, PermissionStatus.GRANTED)
        device.fix = CompletableDeferred()
        val t = setup(device)
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertTrue(t.session.locating.value, "the title's spinner turns while the position is looked up")
        t.state.value = t.state.value.copy(placeIndex = 1)
        device.fix.complete(Location(37.6, 127.0))
        runCurrent()
        assertEquals(Location(37.6, 127.0), t.state.value.places[0].location)
        assertEquals(listOf(coord("37.56", "126.98")), t.requests)
    }

    @Test
    fun locationOffUsesTheSavedPlaceOrAsksForHighAccuracy() = runTest {
        val saved = Device(false, PermissionStatus.GRANTED)
        val s = setup(saved)
        s.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertTrue(saved.calls.isEmpty())
        assertNull(s.session.positionRetry.value)
        assertEquals(listOf("denied"), s.events, "location off counts as denied")
        // No saved place: the high-accuracy dialog; declined, the turn-on message with Search first (nothing recorded yet).
        val none = Device(false, PermissionStatus.GRANTED)
        val n = setup(none, listOf(Place(currentPosition = true, disable = false), london))
        n.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(listOf("highAccuracy"), none.calls)
        // The saved place cannot load (O03 weather); the declined dialog's confirmation replaces it.
        assertTrue(n.session.retry.value)
        none.highAccuracy.complete(false)
        runCurrent()
        assertFalse(n.session.retry.value)
        assertEquals(RetryConfirm(listOf("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"), listOf(RetryButton.SEARCH, RetryButton.RETRY)),
            n.session.positionRetry.value)
        // Turned on: silent; `locationOn` reloads.
        val accepted = Device(false, PermissionStatus.GRANTED, highAccuracy = true)
        val a = setup(accepted, listOf(Place(currentPosition = true, disable = false), london))
        a.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertNull(a.session.positionRetry.value)
    }

    @Test
    fun thePromptAndTheDenialsOpenTheirVariants() = runTest {
        val asked = Device(true, PermissionStatus.NOT_REQUESTED)
        val a = setup(asked)
        a.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(listOf("prompt"), asked.calls)
        assertEquals(RetryConfirm(listOf("LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY"), listOf(RetryButton.CLOSE, RetryButton.RETRY)),
            a.session.positionRetry.value)
        val always = setup(Device(true, PermissionStatus.DENIED_ALWAYS))
        always.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(RetryConfirm(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"), listOf(RetryButton.SEARCH, RetryButton.APP_SETTINGS)),
            always.session.positionRetry.value)
        // A grant settles silently.
        val granted = setup(Device(true, PermissionStatus.NOT_REQUESTED, answer = PermissionStatus.GRANTED))
        granted.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertNull(granted.session.positionRetry.value)
        val noFix = Device(true, PermissionStatus.GRANTED)
        // `CompletableDeferred(null)` would be the parent overload: an answer that never comes.
        noFix.fix = CompletableDeferred<Location?>().apply { complete(null) }
        val f = setup(noFix)
        f.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(listOf("LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION", "LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI"), f.session.positionRetry.value!!.lines)
    }

    @Test
    fun reloadsWaitWhileThePositionConfirmIsOpen() = runTest {
        val device = Device(true, PermissionStatus.DENIED_ALWAYS)
        val t = setup(device)
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        val before = t.requests.size
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        assertEquals(before, t.requests.size)
        t.session.confirmPositionRetry()
        runCurrent()
        assertEquals(before + 1, t.requests.size, "OK reloads")
        // Search disables the current position and selects the next place.
        t.session.searchInsteadOfPosition()
        assertTrue(t.state.value.places[0].disable)
        assertEquals(1, t.state.value.placeIndex)
        assertNull(t.session.positionRetry.value)
    }

    @Test
    fun theStartChoiceEnablesTheCurrentPositionAndLooksItUp() = runTest {
        // `data.autoSearch` starts as location services were when the weather pages opened.
        assertFalse(setup(Device(false, PermissionStatus.GRANTED)).session.autoSearch.value)
        val device = Device(true, PermissionStatus.GRANTED)
        val t = setup(device, listOf(Place.currentPositionPlaceholder()), index = -1)
        assertTrue(t.session.autoSearch.value)
        t.session.openStartPopup()
        assertTrue(t.session.startPopup.value)
        // Back answers nothing: the Locations tab, the places unchanged.
        assertFalse(t.session.startChoice(ok = false))
        assertFalse(t.session.startPopup.value)
        t.session.openStartPopup()
        t.session.chooseAutoSearch(false)
        assertFalse(t.session.startChoice(ok = true))
        runCurrent()
        assertTrue(t.state.value.places[0].disable, "search: nothing changes here")
        // The choice stays for the next opening.
        t.session.openStartPopup()
        assertFalse(t.session.autoSearch.value)
        t.session.chooseAutoSearch(true)
        assertTrue(t.session.startChoice(ok = true))
        runCurrent()
        assertFalse(t.state.value.places[0].disable)
        assertEquals(0, t.state.value.placeIndex)
        // The saved place has no location: its load fails at once (O03 weather); the lookup's fix loads, and the
        // response names the current position and gives its location (`updateCity`).
        assertTrue(t.session.retry.value)
        assertEquals(listOf(coord("37.57", "126.982")), t.requests)
        assertEquals(Location(37.56, 126.98), t.state.value.places[0].location)
        assertEquals("회현동", t.state.value.places[0].name)
    }

    @Test
    fun locationOnReloadsOnlyTheSelectedCurrentPosition() = runTest {
        val t = setup(Device(false, PermissionStatus.GRANTED), index = 1)
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        val before = t.requests.size
        t.session.reload(WeatherSession.Sender.LOCATION_ON)
        runCurrent()
        assertEquals(before, t.requests.size, "London is not the current position")
        t.state.value = t.state.value.copy(placeIndex = 0)
        t.session.reload(WeatherSession.Sender.LOCATION_ON)
        runCurrent()
        assertEquals(before + 1, t.requests.size)
    }
}
