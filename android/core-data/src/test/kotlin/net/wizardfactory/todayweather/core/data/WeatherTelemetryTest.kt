package net.wizardfactory.todayweather.core.data

import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * The weather events of the Cordova build (#2894): `weather_fetch` of `getWeatherByGeoInfo` (the request: `success`,
 * `network_error` for a failed request or a body `$http` cannot parse as the server's JSON, `invalid_input` without
 * coordinates or address) and `weather_load` of TabCtrl's `updateWeatherData` (`success`, `network_error` for an
 * error with a status, `invalid_response` otherwise), each with its duration in milliseconds.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WeatherTelemetryTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val seoul = Place(currentPosition = false, disable = false, name = "서울", address = "대한민국 서울특별시 중구", location = Location(37.5665, 126.978))

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    private fun TestScope.events(place: Place = seoul, http: HttpGet): Pair<WeatherSession, MutableList<Pair<String, Map<String, Any>>>> {
        val events = mutableListOf<Pair<String, Map<String, Any>>>()
        val telemetry = Telemetry { name, params -> events += name to params }
        val state = Memory(AppState(places = listOf(place), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, http, { testScheduler.currentTime },
            StandardTestDispatcher(testScheduler), telemetry)
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko-KR") }, { null }, telemetry = telemetry,
            clock = { testScheduler.currentTime }) { 0.5 }
        return session to events
    }

    private fun TestScope.load(place: Place = seoul, http: HttpGet): List<Pair<String, Map<String, Any>>> {
        val (session, events) = events(place, http)
        session.reload(WeatherSession.Sender.INIT)
        advanceTimeBy(60_000)
        return events
    }

    private fun event(name: String, outcome: String, ms: Long) = name to mapOf<String, Any>("outcome" to outcome, "duration_ms" to ms)

    @Test
    fun aLoadedPlaceReportsTheRequestAndTheLoad() = runTest {
        val events = load(http = { _, _ -> kotlinx.coroutines.delay(1_234); seoulBody })
        assertEquals(listOf(event("weather_fetch", "success", 1_234), event("weather_load", "success", 1_234)), events)
    }

    @Test
    fun aFailedRequestIsANetworkError() = runTest {
        assertEquals(listOf(event("weather_fetch", "network_error", 0), event("weather_load", "network_error", 0)),
            load(http = { _, _ -> throw HttpStatusException(503) }))
        assertEquals(listOf(event("weather_fetch", "network_error", 0), event("weather_load", "network_error", 0)),
            load(http = { _, _ -> throw IOException("timeout") }))
    }

    @Test
    fun aPlaceWithoutCoordinatesOrAddressIsInvalidInput() = runTest {
        val nowhere = Place(currentPosition = false, disable = false, name = "?")
        assertEquals(listOf(event("weather_fetch", "invalid_input", 0), event("weather_load", "invalid_response", 0)),
            load(nowhere, http = { _, _ -> error("no request expected") }))
    }

    @Test
    fun anAnswerThatDoesNotConvertIsAnInvalidResponse() = runTest {
        // `$http` rejects a body it cannot parse (the server answers with a JSON content type), without a status.
        assertEquals(listOf(event("weather_fetch", "network_error", 0), event("weather_load", "invalid_response", 0)),
            load(http = { _, _ -> " {\"current\": " }))
        assertEquals(listOf(event("weather_fetch", "network_error", 0), event("weather_load", "invalid_response", 0)),
            load(http = { _, _ -> "<html>busy</html>" }))
        assertEquals(listOf(event("weather_fetch", "success", 0), event("weather_load", "invalid_response", 0)),
            load(http = { _, _ -> "{}" }))
    }

    @Test
    fun aGatedLoadReportsNothingAndAReplacedAnswerOnlyItsRequest() = runTest {
        val first = CompletableDeferred<String>()
        var calls = 0
        val (session, events) = events(http = { _, _ -> if (++calls == 1) first.await() else seoulBody })
        session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        first.complete(seoulBody)
        runCurrent()
        assertEquals(listOf(event("weather_fetch", "success", 0), event("weather_load", "success", 0), event("weather_fetch", "success", 0)),
            events, "the newer request applies; the older answer only completed its request")
        session.reload(WeatherSession.Sender.RESUME)
        runCurrent()
        assertEquals(3, events.size, "within ten minutes a resume loads nothing")
    }
}
