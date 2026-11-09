package net.wizardfactory.todayweather.core.data

import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * The requests of the nationwide and warning pages (#2892 AC1): the URLs and headers the Cordova build sent
 * (nation-reference/ko-KR/requests.json), the answers the pages read, and the empty and failed answers.
 */
class NationSourceTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val nationBody = File(corpus, "inputs/nation.json").readText()
    private val specialBody = File(corpus, "inputs/special.json").readText()
    private val kr = UnitSettings.defaults("KR")
    private val capture = Json.parseToJsonElement(File("../app/src/test/resources/nation-reference/ko-KR/requests.json").readText())
        .jsonObject["requests"]!!.jsonArray.map { it.jsonObject }

    /** A server that records each request and answers with [answer]. */
    private class Fake(val answer: suspend (String) -> String) : HttpGet {
        val requests = mutableListOf<Pair<String, Map<String, String>>>()
        override suspend fun get(url: String, headers: Map<String, String>): String {
            requests += url to headers
            return answer(url)
        }
    }

    @Test
    fun theRequestsAreTheCordovaOnes() = runTest {
        val nation = Fake { nationBody }
        val special = Fake { specialBody }
        val source = NationSource("https://server", nation, special)
        source.nation("KR", kr, listOf("ko-KR"))
        source.special(listOf("ko-KR"))
        fun sent(step: String) = capture.single { it["step"]!!.jsonPrimitive.content == step }["url"]!!.jsonPrimitive.content
            .replace("<server>", "https://server")
        assertEquals(sent("open nation-air"), nation.requests.single().first)
        assertEquals(sent("open warnings"), special.requests.single().first)
        assertEquals("ko-KR,ko;q=0.9", nation.requests.single().second["Accept-Language"])
        assertEquals("ko-KR,ko;q=0.9", special.requests.single().second["Accept-Language"])
    }

    @Test
    fun theUnitsGoInTheNationQuery() = runTest {
        val nation = Fake { nationBody }
        NationSource("https://server", nation, Fake { "" }).nation("KR", kr.copy(windSpeedUnit = "km/h"), listOf("ko-KR"))
        val sent = capture.first { it["step"]!!.jsonPrimitive.content == "wind speed km/h" && "/nation/" in it["url"]!!.jsonPrimitive.content }
        assertEquals(sent["url"]!!.jsonPrimitive.content.replace("<server>", "https://server"), nation.requests.single().first)
    }

    @Test
    fun aNationAnswerHasItsCitiesAndProvinces() = runTest {
        val load = NationSource("https://server", Fake { nationBody }, Fake { "" }).nation("KR", kr, listOf("ko-KR"))
        val response = assertIs<PageLoad.Loaded<*>>(load).value as net.wizardfactory.todayweather.core.model.NationResponse
        assertEquals(15, response.weather.size)
        assertEquals(17, response.air.size)
    }

    @Test
    fun emptyNationAnswersLoadWithoutCities() = runTest {
        for (body in listOf("""{"nation":"KR","weather":[],"air":[]}""", "{}")) {
            val load = NationSource("https://server", Fake { body }, Fake { "" }).nation("KR", kr, listOf("ko-KR"))
            val response = assertIs<PageLoad.Loaded<*>>(load, body).value as net.wizardfactory.todayweather.core.model.NationResponse
            assertTrue(response.weather.isEmpty() && response.air.isEmpty(), body)
        }
    }

    @Test
    fun failedNationAnswersFail() = runTest {
        // An error status, no connection, a body that is not JSON, and JSON that is not an object (`data.weather`
        // throws in the Cordova callback, which leaves the page without values).
        val answers = listOf<suspend (String) -> String>({ throw HttpStatusException(500) }, { throw IOException("refused") },
            { "<html>" }, { "{\"weather\": [abc]}" }, { "[]" }, { "null" })
        for ((i, answer) in answers.withIndex()) {
            assertIs<PageLoad.Failed>(NationSource("https://server", Fake(answer), Fake { "" }).nation("KR", kr, listOf("ko-KR")), "answer $i")
        }
    }

    @Test
    fun aLateNationAnswerGetsTwoMoreAttemptsTwoSecondsApart() = runTest {
        // An answer later than 4 s (the capture's 4 s answer came after the third request): three requests, at 0, 2
        // and 4 s; the first to answer decides.
        val started = mutableListOf<Long>()
        val nation = Fake { started += currentTime; delay(4_500); nationBody }
        val load = NationSource("https://server", nation, Fake { "" }).nation("KR", kr, listOf("ko-KR"))
        assertIs<PageLoad.Loaded<*>>(load)
        assertEquals(listOf(0L, 2_000L, 4_000L), started)
        assertEquals(capture.count { it["step"]!!.jsonPrimitive.content == "open nation (late answer)" }, nation.requests.size)
        assertEquals(4_500L, currentTime)
    }

    @Test
    fun warningAnswersLoadAsTheWebViewReadsThem() = runTest {
        fun special(body: String) = runBlocking { NationSource("https://server", Fake { "" }, Fake { body }).special(listOf("ko-KR")) }
        assertEquals(3, (assertIs<PageLoad.Loaded<*>>(special(specialBody)).value as JsonArray).size)
        assertEquals(JsonArray(emptyList()), assertIs<PageLoad.Loaded<*>>(special("[]")).value)
        // `responseType: 'json'`: a body that is not JSON reads as null, and the page shows no card.
        for (body in listOf("<html>", "[abc]", "{\"a\": tru}")) assertEquals(JsonNull, assertIs<PageLoad.Loaded<*>>(special(body)).value, body)
    }

    @Test
    fun failedWarningAnswersFailWithoutRetrying() = runTest {
        for (answer in listOf<suspend (String) -> String>({ throw HttpStatusException(500) }, { throw IOException("refused") })) {
            val special = Fake(answer)
            assertIs<PageLoad.Failed>(NationSource("https://server", Fake { "" }, special).special(listOf("ko-KR")))
            assertEquals(1, special.requests.size, "one attempt, as \$http makes")
        }
    }

    @Test
    fun theWarningRequestGivesUpAfterThreeSeconds() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse.Builder().body("[]").headersDelay(5, TimeUnit.SECONDS).build())
            server.start()
            val begin = System.nanoTime()
            val load = NationSource(server.url("").toString().removeSuffix("/")).special(listOf("ko-KR"))
            val seconds = (System.nanoTime() - begin) / 1e9
            assertIs<PageLoad.Failed>(load)
            assertTrue(seconds in 2.9..4.5, "gave up after $seconds s")
        }
    }

    @Test
    fun withoutAServerUrlNothingIsRequested() = runTest {
        val nation = Fake { nationBody }
        val special = Fake { specialBody }
        val source = NationSource("", nation, special)
        assertIs<PageLoad.Failed>(source.nation("KR", kr, listOf("ko-KR")))
        assertIs<PageLoad.Failed>(source.special(listOf("ko-KR")))
        assertTrue(nation.requests.isEmpty() && special.requests.isEmpty())
    }

    @Test
    fun theTimeoutsAreTheCordovaOnes() {
        assertEquals(20_000L, NationSource.NATION_TIMEOUT_MS) // _getHttp(url, 20000)
        assertEquals(3_000L, NationSource.SPECIAL_TIMEOUT_MS) // $http({timeout: 3000})
    }
}
