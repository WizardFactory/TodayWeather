package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * The settings pages' changes (#2891 AC1) against what the Cordova `radioList` and `RadioCtrl` do (corpus/settings.json,
 * every choice of every list from the Korean defaults): what is saved, the push list posted with the new units, and the
 * selected place's weather loaded at once in them, also within the ten-minute gate; the refresh interval's timer; the
 * weather request against the one the Cordova build sent (settings-reference/ko-KR/requests.json).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsActionsTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val settings = Json.parseToJsonElement(File(corpus, "settings.json").readText()).jsonObject
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val seoul = Place(currentPosition = false, disable = false, name = "회현동", address = "대한민국 서울특별시 중구 회현동", location = Location(37.56, 126.98))
    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.51, -0.13))

    /** The state as the screens see it, with every save recorded in [log]. */
    private class Memory(var value: AppState, val log: MutableList<String>) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) {
            val before = value
            value = update(value)
            if (value.units != before.units) log += "save units ${unitsJson(value.units)}"
            if (value.settings != before.settings) log += "save settingsInfo ${settingsJson(value.settings)}"
        }
    }

    private class Setup(val state: Memory, val actions: SettingsActions, val session: WeatherSession, val requests: MutableList<String>, val log: MutableList<String>)

    /** Seoul selected and loaded (the gate is closed for ten minutes), London after it; [fail] answers with an error. */
    private fun TestScope.setup(interval: String = "0", fail: () -> Boolean = { false }): Setup {
        val log = mutableListOf<String>()
        val requests = mutableListOf<String>()
        val state = Memory(AppState(places = listOf(seoul, london), placeIndex = 0, units = UnitSettings.defaults("KR"),
            settings = Settings(refreshInterval = interval)), log)
        val repository = WeatherRepository("https://server.test.invalid", null, { url, _ ->
            requests += url
            log += "load ${url.substringAfter("/coord/")}"
            if (fail()) throw HttpStatusException(500) else seoulBody
        }, { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko-KR") }, { null })
        val actions = SettingsActions(state, session) { log += "Push.updateUnits ${unitsJson(state.value.units)}" }
        session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        requests.clear()
        log.clear()
        return Setup(state, actions, session, requests, log)
    }

    @Test
    fun everyChoiceIsSavedPostedAndLoadedAsCordovaDoes() = runTest {
        var choices = 0
        for (list in settings["lists"]!!.jsonArray.map { it.jsonObject }) {
            val name = list["name"]!!.jsonPrimitive.content
            for (choice in list["choices"]!!.jsonArray.map { it.jsonObject }) {
                val value = choice["value"]!!.jsonPrimitive.content
                val t = setup()
                t.actions.choose(name, value)
                runCurrent()
                val units = t.state.value.units
                val query = "?" + UnitSettings.KEYS.joinToString("&") { "$it=${units.value(it)}" } + "&airForecastSource=kaq"
                assertEquals(expected(choice["trace"]!!.jsonArray, "37.56,126.98$query"), t.log, "$name $value")
                val stored = choice["stored"]!!.jsonObject
                assertEquals(stored["units"], unitsJson(t.state.value.units), "$name $value: saved units")
                assertEquals(stored["settingsInfo"], settingsJson(t.state.value.settings), "$name $value: saved settingsInfo")
                choices++
            }
        }
        assertEquals(24, choices, "every value but the saved one of the six units and three settings")
    }

    /**
     * The Cordova trace in the native order of effects: the save, the push list with the units saved, and the load the
     * reset of every city's load time and the `resume` reload make (the timer restart of the refresh interval and the
     * air standard's event have no request; the timer is checked below, the standard goes to the pages as state).
     */
    private fun expected(trace: JsonArray, load: String): List<String> = trace.map { it.jsonArray }.mapNotNull { e ->
        val what = e[0].jsonPrimitive.content
        when {
            what == "TwStorage.set" -> "save ${e[1].jsonPrimitive.content} ${e[2]}"
            what == "Push.updateUnits" -> "Push.updateUnits ${e[1]}"
            what == "\$broadcast" && e[2].let { it is JsonPrimitive && it.content == "resume" } -> "load $load"
            else -> null
        }
    }

    @Test
    fun theWeatherRequestIsTheOneTheCordovaBuildSent() = runTest {
        val capture = Json.parseToJsonElement(File("../app/src/test/resources/settings-reference/ko-KR/requests.json").readText()).jsonObject
        val sent = capture["requests"]!!.jsonArray.map { it.jsonObject }.filter { it["step"]!!.jsonPrimitive.content == "choose temperatureUnit F" }
        assertEquals(listOf("POST", "GET"), sent.map { it["method"]!!.jsonPrimitive.content }, "the push list, then the weather in °F")
        val t = setup()
        t.actions.choose("temperatureUnit", "F")
        runCurrent()
        assertEquals(listOf(sent[1]["url"]!!.jsonPrimitive.content.replace("<server>", "https://server.test.invalid")), t.requests)
        assertEquals("F", sent[0]["body"]!!.jsonArray[0].jsonObject["units"]!!.jsonObject["temperatureUnit"]!!.jsonPrimitive.content)
    }

    @Test
    fun theRefreshIntervalRestartsItsTimerWhenItsListOpensAndWhenChosen() = runTest {
        val t = setup(interval = "30")
        advanceTimeBy(20 * 60_000L)
        t.actions.opened("refreshInterval")
        advanceTimeBy(10 * 60_000L + 1)
        assertEquals(emptyList(), t.requests, "opening the list set its value and restarted the timer")
        advanceTimeBy(20 * 60_000L)
        assertEquals(1, t.requests.size, "30 minutes after the list opened")
        t.actions.opened("startupPage")
        t.actions.opened("theme")
        t.actions.choose("refreshInterval", "60")
        runCurrent()
        assertEquals(2, t.requests.size, "the choice loads at once")
        advanceTimeBy(59 * 60_000L)
        assertEquals(2, t.requests.size)
        advanceTimeBy(60_000L + 1)
        assertEquals(3, t.requests.size, "then an hour later")
        t.actions.choose("refreshInterval", "0")
        runCurrent()
        advanceTimeBy(13 * 3_600_000L)
        assertEquals(4, t.requests.size, "manual: no timer")
    }

    @Test
    fun withTheRetryConfirmationOpenAChoiceIsSavedButNothingLoads() = runTest {
        var fail = false
        val t = setup { fail }
        fail = true
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        assertTrue(t.session.retry.value)
        t.requests.clear()
        t.log.clear()
        t.actions.choose("temperatureUnit", "F")
        runCurrent()
        assertEquals(listOf("save units ${unitsJson(t.state.value.units)}", "Push.updateUnits ${unitsJson(t.state.value.units)}"), t.log)
        assertEquals(emptyList(), t.requests, "`reloadEvent` stops while the confirmation is open")
    }

    @Test
    fun theSavedUnitIsNotSavedOrPostedAgain() = runTest {
        val t = setup()
        t.actions.choose("temperatureUnit", "C")
        runCurrent()
        assertEquals(1, t.log.size, "`setUnit` returns false: no save, no push; the reset and the reload still run")
        assertTrue(t.log.single().startsWith("load "))
    }

    private companion object {
        fun unitsJson(u: UnitSettings) = JsonObject(UnitSettings.KEYS.associateWith { JsonPrimitive(u.value(it)) })
        fun settingsJson(s: Settings) = JsonObject(listOf("startupPage", "refreshInterval", "theme").associateWith { JsonPrimitive(s.value(it)) })
    }
}
