package net.wizardfactory.todayweather.core.data

import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer

/**
 * The photo feed loads like `loadWeatherPhotos` (#2886): `_retryGetHttp`'s overlapping attempts 2 s apart, the
 * first attempt to settle deciding; one load per process, shared while it runs and repeated after a failure.
 */
class WeatherPhotoFeedTest {
    private val feedBody = Json.parseToJsonElement(File(javaClass.getResource("/corpus/photos.json")!!.toURI()).readText())
        .jsonObject["feeds"]!!.jsonArray.first().jsonObject["feed"]!!.toString()

    @Test
    fun aSlowRequestGetsTwoMoreAttemptsTwoSecondsApart() = runTest {
        val started = mutableListOf<Long>()
        val result = firstSettled(3, 2_000) {
            started += currentTime
            delay(20_000) // the per-attempt timeout
            throw IOException("timeout")
        }
        assertEquals(listOf(0L, 2_000L, 4_000L), started)
        assertEquals(20_000L, currentTime, "the first attempt's failure decides")
        assertEquals("timeout", result.exceptionOrNull()!!.message)
    }

    @Test
    fun aFastFailureEndsTheLoadWithoutRetrying() = runTest {
        var attempts = 0
        val result = firstSettled(3, 2_000) {
            attempts++
            delay(100)
            throw IOException("refused")
        }
        assertEquals(1, attempts)
        assertEquals(100L, currentTime)
        assertNull(result.getOrNull())
    }

    @Test
    fun theFirstAttemptToAnswerWinsAndTheOthersAreCancelled() = runTest {
        val cancelled = mutableListOf<Int>()
        var attempts = 0
        val result = firstSettled(3, 2_000) {
            val n = ++attempts
            try {
                if (n == 1) delay(3_000) else awaitCancellation()
                "body $n"
            } catch (e: kotlinx.coroutines.CancellationException) {
                cancelled += n
                throw e
            }
        }
        assertEquals("body 1", result.getOrNull())
        assertEquals(2, attempts, "the second attempt started at 2 s; the third never did")
        assertEquals(listOf(2), cancelled)
    }

    @Test
    fun oneLoadIsSharedRepeatedAfterAFailureAndKeptAfterASuccess() = runTest {
        var calls = 0
        val answer = CompletableDeferred<String>()
        val feed = WeatherPhotoFeed("https://photos.test.invalid/list.json", backgroundScope) { _ ->
            calls++
            if (calls == 1) throw IOException("offline") else answer.await()
        }
        assertNull(feed.load(), "the first load fails")
        assertEquals(1, calls)
        val first = async { feed.load() }
        val second = async { feed.load() }
        testScheduler.runCurrent()
        answer.complete(feedBody)
        val photos = assertNotNull(first.await())
        assertSame(photos, second.await())
        assertEquals(2, calls, "the second and third loads shared one request")
        assertSame(photos, feed.load())
        assertEquals(2, calls, "a loaded feed is kept")
        assertEquals("https://photos.test.invalid/sun-1.jpg", photos.find("sun", 0.0))
    }

    @Test
    fun withoutAUrlNothingIsRequested() = runTest {
        var calls = 0
        val feed = WeatherPhotoFeed("", backgroundScope) { calls++; feedBody }
        assertNull(feed.load())
        assertEquals(0, calls)
    }

    @Test
    fun theFeedComesOverHttpAndAnErrorStatusFails() = runBlocking {
        val server = MockWebServer()
        server.start()
        server.enqueue(MockResponse.Builder().code(200).body(feedBody).build())
        server.enqueue(MockResponse.Builder().code(404).build())
        val url = server.url("/photos/list.json").toString()
        assertEquals(feedBody, HttpPhotoFeedGet().get(url))
        assertEquals("/photos/list.json", server.takeRequest().target)
        val failure = runCatching { HttpPhotoFeedGet().get(url) }.exceptionOrNull()
        assertEquals("HTTP 404", failure?.message)
        server.close()
    }
}
