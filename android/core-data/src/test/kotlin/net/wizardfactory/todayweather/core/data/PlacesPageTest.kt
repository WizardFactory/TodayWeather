package net.wizardfactory.todayweather.core.data

import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * One visit of S02 (SearchCtrl, #2890): the bells read once, the sequential row loads through the ten-minute gate,
 * deletes and the current position's switch with their alarm removals, the first enable, find-by-location, adds from a
 * result (a Places prediction geocoded by its terms joined with commas) and O03 `search`. Devices are doubles; responses
 * are the AN-02 corpus.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PlacesPageTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val geocodeBody = File(corpus, "inputs/geocode-seoul.json").readText()
    private val addressBody = """{"country":"GB","address":"London,UK","location":{"lat":51.51,"long":-0.13}}"""
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val busan = Place(false, false, "부산광역시", "대한민국 부산광역시", "KR", Location(35.18, 129.08))
    private val alarm = Json.parseToJsonElement("""{"cityIndex":1,"id":1,"category":"alarm","enable":true}""") as JsonObject
    private val off = Json.parseToJsonElement("""{"cityIndex":2,"id":1,"category":"alarm","enable":false}""") as JsonObject

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    private class Device(var enabled: Boolean, var status: PermissionStatus, var fix: Location? = Location(37.5612, 126.9787)) : LocationAccess {
        val calls = mutableListOf<String>()
        override fun enabled() = enabled
        override fun status() = status
        override suspend fun request(): PermissionStatus { calls += "prompt"; return status }
        override suspend fun position(): Location? { calls += "position"; return fix }
        override suspend fun requestHighAccuracy() = false
    }

    private class Setup(val state: Memory, val page: PlacesPage, val requests: MutableList<String>, val removed: MutableList<Int>,
                        val events: MutableList<String>, val repository: WeatherRepository)

    private fun TestScope.setup(places: List<Place>, device: Device = Device(true, PermissionStatus.GRANTED), index: Int = 1,
                                records: List<JsonObject> = emptyList(), weather: (String) -> String = { seoulBody }): Setup {
        val requests = mutableListOf<String>()
        val removed = mutableListOf<Int>()
        val events = mutableListOf<String>()
        val state = Memory(AppState(places = places, placeIndex = index, units = UnitSettings.defaults("KR"), push = PushState(fcmToken = "t", records = records)))
        val http = HttpGet { url, _ ->
            requests += url.removePrefix("https://server.test.invalid").substringBefore('?')
            when {
                "/geocode/v000903/coord/" in url -> geocodeBody
                "/geocode/v000903/addr/" in url -> addressBody
                else -> weather(url)
            }
        }
        val telemetry = Telemetry { name, params -> if (name == "favorite_change") events += "$name:${params["action"]}" }
        val repository = WeatherRepository("https://server.test.invalid", null, http, { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko-KR") }, { null })
        val flow = StartFlow(state, repository, GeocodeClient("https://server.test.invalid", http), device, { listOf("ko-KR") }, telemetry)
        val page = PlacesPage(state, repository, session, flow, device, backgroundScope, { removed += it }, telemetry = telemetry)
        return Setup(state, page, requests, removed, events, repository)
    }

    @Test
    fun theRowsLoadInTurnThroughTheGateWithTheBellsOfTheVisit() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul, busan), records = listOf(alarm, off))
        t.page.open()
        runCurrent()
        // The disabled current position is skipped; the others load in order.
        assertEquals(listOf("/weather/v000903/coord/37.567,126.978", "/weather/v000903/coord/35.18,129.08"), t.requests)
        // Only an enabled alarm rings a bell, read once.
        assertEquals(listOf(false, true, false), t.page.hasPush.value)
        // Within ten minutes a new visit loads nothing.
        t.requests.clear()
        t.page.open()
        runCurrent()
        assertEquals(emptyList(), t.requests)
    }

    @Test
    fun aFailedRowLoadIsSilent() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul), weather = { throw IOException("offline") })
        t.page.open()
        runCurrent()
        assertNull(t.page.popup.value)
        assertEquals("서울", t.state.value.places[1].name)
    }

    @Test
    fun deletingAPlaceRemovesItsAlarmsOnlyWhenItsBellRang() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul, busan), index = 2, records = listOf(alarm, off))
        t.page.open()
        runCurrent()
        // 부산광역시's records are all off: no removal (A24), the selection resets to the first enabled place.
        t.page.delete(2)
        runCurrent()
        assertEquals(emptyList(), t.removed)
        assertEquals(listOf(null, "서울"), t.state.value.places.map { it.name })
        assertEquals(1, t.state.value.placeIndex)
        // 서울 has an enabled alarm: DELETE /push for index 1.
        t.page.delete(1)
        runCurrent()
        assertEquals(listOf(1), t.removed)
        assertEquals(listOf("favorite_change:remove", "favorite_change:remove"), t.events)
        // The current position has no delete.
        t.page.delete(0)
        assertEquals(1, t.state.value.places.size)
    }

    @Test
    fun aBellMovesWithItsRowAfterADelete() = runTest {
        val busanAlarm = Json.parseToJsonElement("""{"cityIndex":2,"id":1,"category":"alarm","enable":true}""") as JsonObject
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul, busan), records = listOf(busanAlarm))
        t.page.open()
        runCurrent()
        assertEquals(listOf(false, false, true), t.page.hasPush.value)
        // 서울 goes: 부산광역시's row keeps its bell although its record still says index 2 (A24, bells read once).
        t.page.delete(1)
        runCurrent()
        assertEquals(emptyList(), t.removed)
        assertEquals(listOf(false, true), t.page.hasPush.value)
        assertEquals(listOf(busanAlarm), t.state.value.push.records)
    }

    @Test
    fun turningTheCurrentPositionOffRemovesItsAlarmsAndTheFirstEnableFindsIt() = runTest {
        val current = Place(currentPosition = true, disable = false, name = "회현동", address = "서울특별시 중구 회현동", location = Location(37.56, 126.98))
        val zero = Json.parseToJsonElement("""{"cityIndex":0,"id":1,"category":"alert","enable":true}""") as JsonObject
        val t = setup(listOf(current, seoul), index = 0, records = listOf(zero))
        t.page.setCurrentPosition(false)
        runCurrent()
        assertTrue(t.state.value.places[0].disable)
        assertEquals(1, t.state.value.placeIndex, "the first enabled place")
        assertEquals(emptyList(), t.removed, "the bells are read when the visit opens")
        t.page.open()
        runCurrent()
        // The visit read the disabled current position's bell: switching off again sends the removal.
        t.page.setCurrentPosition(true)
        runCurrent()
        t.page.setCurrentPosition(false)
        runCurrent()
        assertEquals(listOf(0), t.removed)
    }

    @Test
    fun theFirstEnableLooksUpTheCurrentPositionAndLoadsIt() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul))
        t.page.setCurrentPosition(true)
        runCurrent()
        assertFalse(t.state.value.places[0].disable)
        assertEquals("회현동", t.state.value.places[0].name)
        assertTrue("/geocode/v000903/coord/37.561,126.979" in t.requests)
        assertTrue(t.requests.last().startsWith("/weather/v000903/coord/"))
        assertFalse(t.page.loading.value)
        // A weather failure there is silent.
        val failing = setup(listOf(Place.currentPositionPlaceholder(), seoul), weather = { throw IOException("offline") })
        failing.page.setCurrentPosition(true)
        runCurrent()
        assertNull(failing.page.popup.value)
    }

    @Test
    fun findByLocationGivesARowThatAddsAnOrdinaryPlace() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul))
        val added = mutableListOf<Unit>()
        backgroundScope.launch { t.page.added.collect { added += it } }
        t.page.findByLocation()
        runCurrent()
        assertEquals(JsonPrimitive("회현동"), t.page.found.value!!["name"])
        t.page.addFound()
        runCurrent()
        val place = t.state.value.places.last()
        assertFalse(place.currentPosition)
        assertEquals("회현동", place.name)
        assertEquals(2, t.state.value.placeIndex, "the new place is selected")
        assertEquals(1, added.size)
    }

    @Test
    fun aPredictionIsGeocodedByItsTermsAndATownByItsCoordinates() = runTest {
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul))
        t.page.addPrediction("London, UK", 0, "Lon")
        runCurrent()
        assertTrue("/geocode/v000903/addr/London,UK" in t.requests)
        assertEquals("London", t.state.value.places.last().name)
        t.requests.clear()
        t.page.addTown(Town("부산광역시", "", "", 35.18, 129.08))
        runCurrent()
        assertEquals(listOf("/weather/v000903/coord/35.18,129.08"), t.requests)
        assertEquals("부산광역시", t.state.value.places.last().name)
        // The same town again: O09, already added.
        t.page.addTown(Town("부산광역시", "", "", 35.18, 129.08))
        runCurrent()
        assertEquals(StartFlow.Outcome.Alert(StartFlow.ALREADY_ADDED), t.page.popup.value)
    }

    @Test
    fun aDeniedLookupOpensTheSearchVariantWhoseOkFindsAgain() = runTest {
        val device = Device(true, PermissionStatus.DENIED_ALWAYS)
        val t = setup(listOf(Place.currentPositionPlaceholder(), seoul), device)
        t.page.findByLocation()
        runCurrent()
        assertEquals(StartFlow.Outcome.Confirm(RetryConfirm(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"),
            listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS))), t.page.popup.value)
        device.status = PermissionStatus.GRANTED
        device.enabled = false
        t.page.retryButton(RetryButton.CLOSE, {}, {})
        t.page.findByLocation()
        runCurrent()
        val off = (t.page.popup.value as StartFlow.Outcome.Confirm).confirm
        assertEquals(listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY), off.buttons)
        device.enabled = true
        t.page.retryButton(RetryButton.RETRY, {}, {})
        runCurrent()
        assertNull(t.page.popup.value)
        assertEquals(JsonPrimitive("회현동"), t.page.found.value!!["name"])
    }
}
