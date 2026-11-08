package net.wizardfactory.todayweather.core.data

import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * The weather of the saved places (#2887 AC1): requests, the A01 fix, the ten-minute gate, `updateCity`'s merge (A02)
 * and place updates, failures and the cache. Responses are the AN-02 corpus captures.
 */
class WeatherRepositoryTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val seoulBody = File(corpus, "inputs/kma-seoul.json").readText()
    private val londonBody = File(corpus, "inputs/vc-london.json").readText()
    private val units = UnitSettings.defaults("KR")
    private val seoul = Place(currentPosition = false, disable = false, name = "서울", address = "대한민국 서울특별시 중구", location = Location(37.5665, 126.978))
    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.51, -0.13))
    private var now = 1_000_000L

    private fun converted(body: String) = WeatherConverter.convert(Json.parseToJsonElement(body))!!

    private fun currentOf(entry: WeatherEntry?) = entry!!.weather["currentWeather"]!!.jsonObject

    private fun repository(http: HttpGet, cache: File? = null) = WeatherRepository("https://server.test.invalid", cache, http, { now })

    /** #2887 A01: Cordova put the answer for the place it asked about on the place selected when it came. */
    @Test
    fun aResponseAppliesToThePlaceThatRequestedIt() = runTest {
        val cordova = Json.parseToJsonElement(File(corpus, "weather-info.json").readText()).jsonArray.first().jsonObject
        assertEquals("A01", cordova["anomaly"]!!.jsonPrimitive.content)
        assertEquals(0, cordova["requestedForIndex"]!!.jsonPrimitive.int)
        assertEquals(1, cordova["appliedToIndex"]!!.jsonPrimitive.int)

        val seoulAnswer = CompletableDeferred<String>()
        val repo = repository({ url, _ -> if ("37.5665" in url) seoulAnswer.await() else londonBody })
        val seoulLoad = async { repo.load(seoul, units, listOf("ko-KR"), force = true) }
        runCurrent()
        assertTrue(WeatherRepository.key(seoul) in repo.loading.value)
        // The user moves to London while Seoul's request is out; London's answer comes first.
        assertIs<LoadResult.Loaded>(repo.load(london, units, listOf("ko-KR"), force = true))
        seoulAnswer.complete(seoulBody)
        assertIs<LoadResult.Loaded>(seoulLoad.await())
        assertEquals(currentOf(WeatherEntry(converted(seoulBody), 0)), currentOf(repo.cached(seoul)))
        assertEquals(currentOf(WeatherEntry(converted(londonBody), 0)), currentOf(repo.cached(london)))
        assertFalse(WeatherRepository.key(seoul) in repo.loading.value)
    }

    @Test
    fun requestsCarryTheRouteUnitsAndAcceptLanguage() = runTest {
        val seen = mutableListOf<Pair<String, Map<String, String>>>()
        val repo = repository({ url, headers -> seen += url to headers; seoulBody })
        repo.load(seoul, units, listOf("ko-KR", "en-US"), force = true)
        assertEquals(WeatherRequests.url("https://server.test.invalid", seoul, units), seen.single().first)
        assertEquals("https://server.test.invalid/weather/v000903/coord/37.5665,126.978?temperatureUnit=C&windSpeedUnit=m/s" +
            "&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq", seen.single().first)
        assertEquals(mapOf("Accept-Language" to "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"), seen.single().second)
    }

    @Test
    fun theTenMinuteGateHoldsInMemoryOnly() = runTest {
        val cache = Files.createTempDirectory("weather").toFile()
        var calls = 0
        val repo = repository({ _, _ -> calls++; seoulBody }, cache)
        assertIs<LoadResult.Loaded>(repo.load(seoul, units, listOf("ko"), force = false))
        now += 5 * 60_000
        assertEquals(LoadResult.Skipped, repo.load(seoul, units, listOf("ko"), force = false))
        assertIs<LoadResult.Loaded>(repo.load(seoul, units, listOf("ko"), force = true), "a tab tap, the retry button or the timer")
        now += WeatherRepository.GATE_MS
        assertEquals(LoadResult.Skipped, repo.load(seoul, units, listOf("ko"), force = false), "exactly ten minutes: still fresh")
        now += 1
        assertIs<LoadResult.Loaded>(repo.load(seoul, units, listOf("ko"), force = false))
        repo.invalidate(seoul)
        assertTrue(repo.canLoad(seoul), "reloadCity")
        assertEquals(3, calls, "loads at 0, at 5 min (forced) and after 15 min")
        assertFalse(repo.canLoad(seoul.copy(disable = true)))

        // A new process shows the cached weather and loads at once (Cordova's loadTime starts null).
        val restarted = repository({ _, _ -> calls++; seoulBody }, cache)
        assertEquals(currentOf(repo.cached(seoul)), currentOf(restarted.cached(seoul)))
        assertTrue(restarted.canLoad(seoul))
        cache.deleteRecursively()
    }

    @Test
    fun aLaterRequestForTheSamePlaceWins() = runTest {
        val first = CompletableDeferred<String>()
        var call = 0
        val modified = converted(seoulBody).let { Json.parseToJsonElement(seoulBody).jsonObject }
            .let { JsonObject(it + ("current" to JsonObject(it["current"]!!.jsonObject + ("t1h" to kotlinx.serialization.json.JsonPrimitive(-5))))) }
            .toString()
        val repo = repository({ _, _ -> if (++call == 1) first.await() else modified })
        val older = async { repo.load(seoul, units, listOf("ko"), force = true) }
        runCurrent()
        assertIs<LoadResult.Loaded>(repo.load(seoul, units, listOf("ko"), force = true))
        first.complete(seoulBody)
        assertEquals(LoadResult.Superseded, older.await())
        assertEquals("-5", currentOf(repo.cached(seoul))["t1h"]!!.jsonPrimitive.content)
    }

    /** #2913 F2: a failed answer to a request a later one replaced does not count (no retry confirmation for it). */
    @Test
    fun anOlderFailureIsSuperseded() = runTest {
        val first = CompletableDeferred<String>()
        var call = 0
        // The cache runs on the test's scheduler, so no time passes and the older request makes one attempt only.
        val repo = WeatherRepository("https://server.test.invalid", null, { _, _ -> if (++call == 1) first.await() else seoulBody },
            { now }, kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        val older = async { repo.load(seoul, units, listOf("ko"), force = true) }
        runCurrent()
        assertIs<LoadResult.Loaded>(repo.load(seoul, units, listOf("ko"), force = true))
        assertEquals(2, call, "one attempt each")
        first.completeExceptionally(HttpStatusException(500))
        assertEquals(LoadResult.Superseded, older.await())
        assertEquals(currentOf(WeatherEntry(converted(seoulBody), 0)), currentOf(repo.cached(seoul)))
    }

    /**
     * #2913 F4: answers are stored one at a time. The older answer's cache write is held while a newer request is sent
     * and answered; the I/O then runs newest first, as a thread pool may. The newer answer stays in memory and in the
     * cache, because it cannot start storing before the older one has finished.
     */
    @Test
    fun aSlowerWriteOfAnOlderAnswerCannotFollowANewerOne() = runTest {
        val cache = Files.createTempDirectory("weather").toFile()
        val io = Manual()
        val newer = Json.parseToJsonElement(seoulBody).jsonObject
            .let { JsonObject(it + ("current" to JsonObject(it["current"]!!.jsonObject + ("t1h" to kotlinx.serialization.json.JsonPrimitive(-5))))) }
            .toString()
        var call = 0
        val repo = WeatherRepository("https://server.test.invalid", cache, { _, _ -> if (++call == 1) seoulBody else newer }, { now }, io)
        val older = async { repo.load(seoul, units, listOf("ko"), force = true) }
        runCurrent()
        io.runAll() // the older answer reads the cache, then queues its write
        runCurrent()
        val later = async { repo.load(seoul, units, listOf("ko"), force = true) }
        runCurrent()
        while (io.pending()) {
            io.runLast()
            runCurrent()
        }
        assertIs<LoadResult.Loaded>(later.await())
        older.await()
        assertEquals("-5", currentOf(repo.cached(seoul))["t1h"]!!.jsonPrimitive.content)
        val restarted = WeatherRepository("https://server.test.invalid", cache, { _, _ -> error("no request") }, { now }, io)
        val fromCache = async { restarted.cached(seoul) }
        runCurrent()
        while (io.pending()) {
            io.runLast()
            runCurrent()
        }
        assertEquals("-5", currentOf(fromCache.await())["t1h"]!!.jsonPrimitive.content, "the cache keeps the newer answer")
        cache.deleteRecursively()
    }

    /** A dispatcher whose tasks run when the test says, in the order it chooses. */
    private class Manual : kotlinx.coroutines.CoroutineDispatcher() {
        private val tasks = ArrayDeque<Runnable>()
        override fun dispatch(context: kotlin.coroutines.CoroutineContext, block: Runnable) { tasks += block }
        fun pending() = tasks.isNotEmpty()
        fun runLast() = tasks.removeLast().run()
        fun runAll() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }

    /** A02 (kept): `updateCity` replaces a field only when the response has a truthy value for it. */
    @Test
    fun fieldsAResponseLeavesOutKeepTheirValues() = runTest {
        val withoutAir = Json.parseToJsonElement(seoulBody).jsonObject.let { JsonObject(it - "airInfoList") }.toString()
        var body = seoulBody
        val repo = repository({ _, _ -> body })
        repo.load(seoul, units, listOf("ko"), force = true)
        val air = repo.cached(seoul)!!.weather["airInfoList"]
        body = withoutAir
        repo.load(seoul, units, listOf("ko"), force = true)
        assertEquals(air, repo.cached(seoul)!!.weather["airInfoList"])
    }

    @Test
    fun theCurrentPositionTakesTheResponsesPlaceAndOldPlacesTheirLocation() = runTest {
        val repo = repository({ _, _ -> seoulBody })
        val current = Place(currentPosition = true, disable = false, name = "이전", address = "대한민국 서울특별시", location = Location(37.56, 126.98))
        val loaded = repo.load(current, units, listOf("ko"), force = true) as LoadResult.Loaded
        assertEquals("회현동", loaded.place.name)
        assertEquals("서울특별시 중구 회현동", loaded.place.address)
        assertEquals("KR", loaded.place.country)
        val response = Json.parseToJsonElement(seoulBody).jsonObject["location"]!!.jsonObject
        assertEquals(Location(response["lat"]!!.jsonPrimitive.content.toDouble(), response["long"]!!.jsonPrimitive.content.toDouble()), loaded.place.location)

        val addressOnly = Place(currentPosition = false, disable = false, name = "회현동", address = "대한민국 서울특별시 중구 회현동")
        val updated = (repo.load(addressOnly, units, listOf("ko"), force = true) as LoadResult.Loaded).place
        assertEquals(loaded.place.location, updated.location, "an old saved place gets the response's location")
        assertEquals("회현동", updated.name)
        assertEquals(seoul, (repo.load(seoul, units, listOf("ko"), force = true) as LoadResult.Loaded).place, "a saved place keeps its own")
        assertEquals(repo.cached(addressOnly), repo.cached(updated), "found under its new key")
    }

    @Test
    fun aFailureKeepsWhatWasThere() = runTest {
        var fail = false
        val repo = repository({ _, _ -> if (fail) throw HttpStatusException(501) else seoulBody })
        repo.load(seoul, units, listOf("ko"), force = true)
        val before = repo.cached(seoul)
        fail = true
        val failed = repo.load(seoul, units, listOf("ko"), force = true)
        assertEquals(501, ((failed as LoadResult.Failed).error as HttpStatusException).code)
        assertEquals(before, repo.cached(seoul))

        val freeForm = Place(currentPosition = false, disable = false, address = "United Kingdom London Westminster Abbey Road")
        assertIs<LoadResult.Failed>(repo.load(freeForm, units, listOf("ko"), force = true))
        assertNull(repo.cached(freeForm))

        val nothing = Place(currentPosition = false, disable = false)
        assertIs<LoadResult.Failed>(repository({ _, _ -> error("no request expected") }).load(nothing, units, listOf("ko"), force = true))

        val unconvertible = repository({ _, _ -> "{}" }).load(seoul, units, listOf("ko"), force = true)
        assertIs<LoadResult.Failed>(unconvertible, "a body WeatherConverter cannot read")
    }

    @Test
    fun recordsCombineThePlaceAndItsWeather() {
        val entry = WeatherEntry(converted(seoulBody), 0)
        val record = cityRecord(seoul.copy(photo = "p.jpg"), entry)
        assertEquals("서울", record["name"]!!.jsonPrimitive.content)
        assertEquals("p.jpg", record["photo"]!!.jsonPrimitive.content)
        assertEquals("false", record["currentPosition"]!!.jsonPrimitive.content)
        assertEquals(entry.weather["dayChart"], record["dayChart"])
    }
}
