package net.wizardfactory.todayweather.core.data

import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.start.CityShortcuts
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * S01's adds (#2889 AC1): each location permission state (granted, denied once, denied permanently, a grant from the
 * prompt, location off), the failures of the position, the geocode and the weather, the city shortcuts, a Places
 * prediction and a bundled town. The device is a double; responses are the AN-02 corpus captures.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StartFlowTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val geocodeBody = File(corpus, "inputs/geocode-seoul.json").readText()
    private val base = "https://server.test.invalid"

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    /** The device: [answers] are the prompt's answers in turn. */
    private class Device(var enabled: Boolean, var status: PermissionStatus, var fix: Location? = Location(37.5612, 126.9787),
                         val answers: ArrayDeque<PermissionStatus> = ArrayDeque()) : LocationAccess {
        val calls = mutableListOf<String>()
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
            return false
        }
    }

    private class Setup(val state: Memory, val flow: StartFlow, val requests: MutableList<String>, val events: MutableList<String>,
                        val loading: MutableList<Boolean>, val updated: MutableList<Int>)

    private fun TestScope.setup(device: Device = Device(true, PermissionStatus.GRANTED), http: HttpGet? = null): Setup {
        val requests = mutableListOf<String>()
        val events = mutableListOf<String>()
        val state = Memory(AppState(places = listOf(Place.currentPositionPlaceholder()), placeIndex = -1, units = UnitSettings.defaults("KR")))
        val get = http ?: HttpGet { url, _ -> if ("/geocode/" in url) geocodeBody else seoulBody }
        val recording = HttpGet { url, h -> requests += url; get.get(url, h) }
        val telemetry = Telemetry { name, params -> if (name != "weather_fetch") events += "$name:${params.values.joinToString()}" }
        val repository = WeatherRepository(base, null, recording, { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        val updated = mutableListOf<Int>()
        val loading = mutableListOf<Boolean>()
        val flow = StartFlow(state, repository, GeocodeClient(base, recording), device, { listOf("ko-KR") }, telemetry, cityUpdated = { updated += it })
        return Setup(state, flow, requests, events, loading, updated)
    }

    @Test
    fun aGrantedPositionIsGeocodedLoadedAndNamesTheCurrentPosition() = runTest {
        val t = setup()
        assertEquals(StartFlow.Outcome.Added, t.flow.useCurrentLocation(t.loading::add))
        // Three decimals, as JavaScript prints them; the weather by the geocode's location.
        assertEquals(listOf("$base/geocode/v000903/coord/37.561,126.979",
            "$base/weather/v000903/coord/37.56,126.98?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq"),
            t.requests)
        val slot = t.state.value.places.single()
        assertTrue(slot.currentPosition && !slot.disable)
        assertEquals("회현동", slot.name)
        assertEquals("서울특별시 중구 회현동", slot.address)
        assertEquals("KR", slot.country)
        assertEquals(Location(37.56, 126.98), slot.location)
        assertEquals("KMA", slot.source)
        assertEquals(0, t.state.value.placeIndex)
        assertEquals(JsonPrimitive(1), t.state.value.cordovaExtras["startVersion"])
        assertEquals(listOf("location_permission:granted"), t.events, "no favorite_change for the current position")
        assertEquals(listOf(0), t.updated, "updateCityInfo(0)")
        assertEquals(listOf(true, false), t.loading)
    }

    @Test
    fun aFirstDenialEndsInTheDeniedConfirmAfterOnePrompt() = runTest {
        val device = Device(true, PermissionStatus.NOT_REQUESTED, answers = ArrayDeque(listOf(PermissionStatus.DENIED_ONCE)))
        val t = setup(device)
        assertEquals(StartFlow.Outcome.Confirm(RetryConfirm(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"), listOf(RetryButton.CLOSE, RetryButton.RETRY))),
            t.flow.useCurrentLocation(t.loading::add))
        assertEquals(listOf("prompt"), device.calls)
        // The overlay hides before the prompt while location services are on.
        assertEquals(listOf(true, false, false), t.loading)
        assertTrue(t.requests.isEmpty())
        assertTrue(t.state.value.places.single().disable)
        assertEquals(listOf("location_permission:denied"), t.events, "a requestable status counts as denied")
        // OK asks again: denied once is requestable.
        device.answers += PermissionStatus.DENIED_ALWAYS
        t.flow.useCurrentLocation()
        assertEquals(listOf("prompt", "prompt"), device.calls)
    }

    @Test
    fun aGrantFromThePromptRunsAgainWithoutAPopup() = runTest {
        val device = Device(true, PermissionStatus.NOT_REQUESTED, answers = ArrayDeque(listOf(PermissionStatus.GRANTED)))
        val t = setup(device)
        assertEquals(StartFlow.Outcome.Added, t.flow.useCurrentLocation())
        assertEquals(listOf("prompt", "position"), device.calls)
        assertEquals(listOf("location_permission:denied", "location_permission:granted"), t.events)
    }

    @Test
    fun aPermanentDenialAsksNothingAndPointsToTheAppSettings() = runTest {
        val device = Device(true, PermissionStatus.DENIED_ALWAYS)
        val t = setup(device)
        assertEquals(StartFlow.Outcome.Confirm(RetryConfirm(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"),
            listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS, RetryButton.RETRY))), t.flow.useCurrentLocation())
        assertTrue(device.calls.isEmpty())
    }

    @Test
    fun locationServicesOffAskToTurnThemOn() = runTest {
        val device = Device(false, PermissionStatus.GRANTED)
        val t = setup(device)
        assertEquals(StartFlow.Outcome.Confirm(RetryConfirm(listOf("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"),
            listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY))), t.flow.useCurrentLocation(t.loading::add))
        assertTrue(device.calls.isEmpty(), "no prompt, no position, no high-accuracy dialog on S01")
        assertEquals(PermissionStatus.GRANTED, t.flow.recorded)
        // Requestable with location off: the prompt with the overlay up; a grant runs again into the turn-on message.
        val requestable = Device(false, PermissionStatus.NOT_REQUESTED, answers = ArrayDeque(listOf(PermissionStatus.GRANTED)))
        val r = setup(requestable)
        val outcome = r.flow.useCurrentLocation(r.loading::add) as StartFlow.Outcome.Confirm
        assertEquals(listOf("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"), outcome.confirm.lines)
        assertEquals(listOf("prompt"), requestable.calls)
        assertEquals(listOf(true, true, false), r.loading)
    }

    @Test
    fun failuresOfThePositionAndTheGeocodeEndInTheirConfirms() = runTest {
        val noFix = setup(Device(true, PermissionStatus.GRANTED, fix = null))
        assertEquals(RetryConfirm(listOf("LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION", "LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI"), listOf(RetryButton.CLOSE, RetryButton.RETRY)),
            (noFix.flow.useCurrentLocation() as StartFlow.Outcome.Confirm).confirm)
        val noGeocode = setup(http = HttpGet { url, _ -> if ("/geocode/" in url) throw IOException("offline") else seoulBody })
        assertEquals(listOf("LOC_FAIL_TO_GET_LOCATION_INFORMATION"), (noGeocode.flow.useCurrentLocation() as StartFlow.Outcome.Confirm).confirm.lines)
        assertTrue(noGeocode.state.value.places.single().disable)
    }

    @Test
    fun aWeatherFailureAfterThePositionLeavesTheCurrentPositionDisabled() = runTest {
        val failed = setup(http = HttpGet { url, _ -> if ("/geocode/" in url) geocodeBody else throw IOException("offline") })
        assertEquals(StartFlow.Outcome.Alert(StartFlow.FAILED_WEATHER), failed.flow.useCurrentLocation())
        assertTrue(failed.state.value.places.single().disable)
        assertNull(failed.state.value.cordovaExtras["startVersion"], "S01 stays")
        // A body that does not convert reads "already added" (kept); the current position is disabled again.
        val unreadable = setup(http = HttpGet { url, _ -> if ("/geocode/" in url) geocodeBody else "{}" })
        assertEquals(StartFlow.Outcome.Alert(StartFlow.ALREADY_ADDED), unreadable.flow.useCurrentLocation())
        assertTrue(unreadable.state.value.places.single().disable)
    }

    @Test
    fun aShortcutLoadsByItsCoordinatesAndIsAddedAfterTheCurrentPosition() = runTest {
        val t = setup()
        val seoul = CityShortcuts.forScreenHeight(800.0).first()
        assertEquals(StartFlow.Outcome.Added, t.flow.addShortcut(seoul))
        assertEquals(listOf("$base/weather/v000903/coord/37.567,126.978?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq"),
            t.requests, "no geocode")
        val s = t.state.value
        assertEquals(2, s.places.size)
        assertTrue(s.places[0].disable, "the current position stays disabled")
        assertEquals(Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978), source = "KMA"), s.places[1])
        assertEquals(1, s.placeIndex)
        assertEquals(JsonPrimitive(1), s.cordovaExtras["startVersion"])
        assertEquals(listOf("favorite_change:add"), t.events)
        // The same place again is already added.
        assertEquals(StartFlow.Outcome.Alert(StartFlow.ALREADY_ADDED), t.flow.addShortcut(seoul))
        assertEquals(2, t.state.value.places.size)
    }

    @Test
    fun aPredictionIsGeocodedByItsFullTextAndNamedByItsTerm() = runTest {
        val body = """{"country":"KR","address":"대한민국 서울특별시 중구 회현동","location":{"lat":37.558,"long":126.978}}"""
        val t = setup(http = HttpGet { url, _ -> if ("/geocode/" in url) body else seoulBody })
        assertEquals(StartFlow.Outcome.Added, t.flow.addPrediction("대한민국 서울특별시 중구 회현동", 14, "회현"))
        assertEquals("$base/geocode/v000903/addr/대한민국 서울특별시 중구 회현동", t.requests.first(), "the full text, not encoded here")
        val added = t.state.value.places[1]
        assertEquals("회현동", added.name)
        assertEquals("대한민국 서울특별시 중구 회현동", added.address)
        assertEquals(Location(37.558, 126.978), added.location)
        // A failed address geocode shows nothing and loads nothing.
        val failed = setup(http = HttpGet { url, _ -> if ("/geocode/" in url) throw IOException("offline") else seoulBody })
        assertEquals(StartFlow.Outcome.None, failed.flow.addPrediction("대한민국 서울특별시", 5, "서울"))
        assertFalse(failed.requests.any { "/weather/" in it })
    }

    @Test
    fun aTownIsAddedWithSearchCtrlsAddressWithoutAGeocode() = runTest {
        val t = setup()
        assertEquals(StartFlow.Outcome.Added, t.flow.addTown(Town("경기도", "수원시장안구", "파장동", 37.3, 127.0)))
        assertFalse(t.requests.any { "/geocode/" in it })
        assertEquals(Place(false, false, "파장동", "대한민국 경기도 수원시 장안구 파장동", "KR", Location(37.3, 127.0), source = "KMA"), t.state.value.places[1])
    }
}
