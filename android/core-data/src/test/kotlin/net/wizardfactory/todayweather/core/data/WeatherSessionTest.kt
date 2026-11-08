package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * TabCtrl's loading of the weather pages (#2887 AC1): which reloads run and when, the refresh timer, the swipes, the
 * retry confirmation and what a response saves to its place. Responses are the AN-02 corpus captures.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WeatherSessionTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val londonBody = File(corpus, "inputs/vc-london.json").readText()
    private val current = Place(currentPosition = true, disable = false, name = "이전", address = "대한민국 서울특별시", location = Location(37.56, 126.98))
    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.51, -0.13))
    private val feed = WeatherPhotos.parse(Json.parseToJsonElement("""[
        {"tags": ["moon", "bigcloud"], "twUrls": {"regular": "https://photos.test.invalid/moon-1.jpg"}},
        {"tags": ["moon", "bigcloud"], "twUrls": {"regular": "https://photos.test.invalid/moon-2.jpg"}}]"""))

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    private class Setup(val state: Memory, val session: WeatherSession, val requests: MutableList<String>)

    private fun TestScope.setup(
        interval: String = "0",
        index: Int = 0,
        photos: WeatherPhotos? = null,
        http: HttpGet? = null,
    ): Setup {
        val requests = mutableListOf<String>()
        val state = Memory(AppState(places = listOf(current, london), placeIndex = index, units = UnitSettings.defaults("KR"),
            settings = Settings(refreshInterval = interval)))
        val get = http ?: HttpGet { url, _ -> if ("51.51" in url) londonBody else seoulBody }
        val repository = WeatherRepository("https://server.test.invalid", null, { url, h -> requests += url; get.get(url, h) },
            { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko-KR") }, { photos }) { 0.5 }
        return Setup(state, session, requests)
    }

    @Test
    fun theAppOpenAndATabTapLoadAtOnceAResumeWaitsForTheGate() = runTest {
        val t = setup()
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        assertEquals(2, t.requests.size, "init and the tab tap bypass the gate")
        t.session.reload(WeatherSession.Sender.RESUME)
        t.session.reload(WeatherSession.Sender.SEARCH)
        runCurrent()
        assertEquals(2, t.requests.size, "within ten minutes a resume loads nothing")
        advanceTimeBy(WeatherRepository.GATE_MS + 1)
        t.session.reload(WeatherSession.Sender.RESUME)
        runCurrent()
        assertEquals(3, t.requests.size)
    }

    @Test
    fun swipesMoveThroughThePlacesAndLoadThroughTheGate() = runTest {
        val t = setup()
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        t.session.next()
        runCurrent()
        assertEquals(1, t.state.value.placeIndex)
        assertTrue("51.51" in t.requests.last(), "London has not loaded yet")
        t.session.previous()
        runCurrent()
        assertEquals(0, t.state.value.placeIndex)
        assertEquals(2, t.requests.size, "the current position loaded a moment ago")

        // One enabled place: swipes do nothing.
        t.state.value = t.state.value.copy(places = listOf(current.copy(disable = true), london), placeIndex = 1)
        t.session.next()
        t.session.previous()
        runCurrent()
        assertEquals(1, t.state.value.placeIndex)
    }

    @Test
    fun aFailureAsksToRetryAndBlocksReloadsUntilAnswered() = runTest {
        var fail = true
        val t = setup(http = { url, _ -> if (fail) throw HttpStatusException(500) else if ("51.51" in url) londonBody else seoulBody })
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertTrue(t.session.retry.value)
        t.session.reload(WeatherSession.Sender.TAB)
        t.session.reload(WeatherSession.Sender.TIMER)
        runCurrent()
        assertEquals(1, t.requests.size, "the failed first attempt decides; reloads wait for the answer")
        t.session.closeRetry()
        assertFalse(t.session.retry.value)
        runCurrent()
        assertEquals(1, t.requests.size, "close loads nothing")

        fail = false
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        assertFalse(t.session.retry.value)
        fail = true
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        assertTrue(t.session.retry.value)
        fail = false
        val before = t.requests.size
        t.session.confirmRetry()
        runCurrent()
        assertFalse(t.session.retry.value)
        assertEquals(before + 1, t.requests.size, "OK reloads at once")
    }

    @Test
    fun theRefreshTimerRestartsWithEveryLoad() = runTest {
        val t = setup(interval = "30")
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        advanceTimeBy(20 * 60_000)
        t.session.reload(WeatherSession.Sender.TAB)
        runCurrent()
        advanceTimeBy(20 * 60_000)
        runCurrent()
        assertEquals(2, t.requests.size, "the tab tap restarted the 30-minute timer")
        advanceTimeBy(10 * 60_000 + 1)
        runCurrent()
        assertEquals(3, t.requests.size, "30 minutes after the last load")

        // A changed interval only restarts the timer.
        t.state.value = t.state.value.copy(settings = Settings(refreshInterval = "60"))
        t.session.reload(WeatherSession.Sender.REFRESH_INTERVAL)
        advanceTimeBy(59 * 60_000)
        runCurrent()
        assertEquals(3, t.requests.size)
        advanceTimeBy(60_001)
        runCurrent()
        assertEquals(4, t.requests.size)

        val manual = setup(interval = "0")
        manual.session.reload(WeatherSession.Sender.INIT)
        advanceTimeBy(24 * 60 * 60_000)
        runCurrent()
        assertEquals(1, manual.requests.size, "manual: no timer")
    }

    @Test
    fun aResponseUpdatesThePlaceThatAskedEvenAfterASwipe() = runTest {
        val seoulAnswer = CompletableDeferred<String>()
        val t = setup(photos = feed, http = { url, _ -> if ("51.51" in url) londonBody else seoulAnswer.await() })
        t.session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        t.session.next()
        runCurrent()
        seoulAnswer.complete(seoulBody)
        runCurrent()
        val (here, there) = t.state.value.places
        assertEquals("회현동", here.name, "the current position takes the response's name")
        assertEquals("서울특별시 중구 회현동", here.address)
        assertEquals("KR", here.country)
        assertEquals("https://photos.test.invalid/moon-1.jpg", here.photo, "findWeatherPhoto for its sky")
        assertEquals("KMA", here.source)
        assertEquals("런던", there.name, "London keeps its own name")
        assertEquals("VC", there.source)
        assertEquals(1, t.state.value.placeIndex)
    }

    @Test
    fun theFeedGivesPhotosToPlacesWithoutOne() = runTest {
        var photos: WeatherPhotos? = null
        val requests = mutableListOf<String>()
        val state = Memory(AppState(places = listOf(current, london), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, { url, _ -> requests += url; seoulBody },
            { testScheduler.currentTime }, StandardTestDispatcher(testScheduler))
        var feedLoads = 0
        val session = WeatherSession(repository, backgroundScope, state, { listOf("ko") }, { photos }, { feedLoads++ }) { 0.5 }
        session.reload(WeatherSession.Sender.INIT)
        runCurrent()
        assertEquals(null, state.value.places[0].photo, "no feed yet: no photo")
        assertEquals(1, feedLoads, "a weather update without the feed loads it (`_getPhoto`)")
        photos = feed
        session.photosLoaded()
        assertEquals("https://photos.test.invalid/moon-1.jpg", state.value.places[0].photo)
        assertEquals(null, state.value.places[1].photo, "London has no weather yet")
    }
}
