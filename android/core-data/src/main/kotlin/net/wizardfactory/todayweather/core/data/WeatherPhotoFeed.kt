package net.wizardfactory.todayweather.core.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Gets the body of a URL, or throws. */
fun interface PhotoFeedGet {
    suspend fun get(url: String): String
}

/**
 * [PhotoFeedGet] over HTTP with the Cordova app's 20-second timeout per attempt (`_getHttp(url, 20000)`). Cancelling
 * the caller cancels the call, so a slower attempt ends when another has answered.
 */
class HttpPhotoFeedGet(
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build(),
) : PhotoFeedGet {
    override suspend fun get(url: String): String = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(Request.Builder().url(url).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val body = runCatching {
                    response.use { if (it.isSuccessful) it.body.string() else throw IOException("HTTP ${it.code}") }
                }
                body.fold(continuation::resume, continuation::resumeWithException)
            }
        })
    }
}

/**
 * The weather photo feed of the photo theme (#2886, `loadWeatherPhotos` in service.weatherutil.js): loaded once per
 * process like `window.weatherPhotos`. A load that runs is shared, not repeated; after a failure the next [load]
 * (an app open, a network that comes back, a weather update) tries again; after a success the feed is kept. Without
 * a [url] (the private build input TW_WEATHER_PHOTOS_URL) nothing is requested, as in Cordova builds from the
 * template configuration.
 */
class WeatherPhotoFeed(
    private val url: String,
    private val scope: CoroutineScope,
    private val feed: PhotoFeedGet = HttpPhotoFeedGet(),
) {
    @Volatile var photos: WeatherPhotos? = null
        private set

    private var running: Deferred<WeatherPhotos?>? = null

    /** The feed, loading it unless it is loaded; null without a URL or after a failed load. */
    suspend fun load(): WeatherPhotos? {
        photos?.let { return it }
        val load = synchronized(this) { running ?: scope.async { fetch() }.also { running = it } }
        val result = load.await()
        synchronized(this) {
            if (running === load) running = null
            if (result != null) photos = result
        }
        return result
    }

    private suspend fun fetch(): WeatherPhotos? {
        if (url.isBlank()) return null
        val body = firstSettled(ATTEMPTS, ATTEMPT_GAP_MS) { feed.get(url) }.getOrNull() ?: return null
        return runCatching { WeatherPhotos.parse(Json.parseToJsonElement(body)) }.getOrNull()
    }

    companion object {
        const val ATTEMPTS = 3
        const val ATTEMPT_GAP_MS = 2_000L
    }
}

/**
 * `_retryGetHttp`: starts [attempt], and another [gapMs] later while none has settled, up to [attempts]; the first
 * attempt to settle decides, a failure included. The others are cancelled, and must end when cancelled: the result
 * returns once they have.
 */
internal suspend fun <T> firstSettled(attempts: Int, gapMs: Long, attempt: suspend () -> T): Result<T> = coroutineScope {
    val first = CompletableDeferred<Result<T>>()
    launch {
        for (i in 0 until attempts) {
            if (i > 0) delay(gapMs)
            if (first.isCompleted) break
            launch {
                val outcome = try {
                    Result.success(attempt())
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Result.failure(e)
                }
                first.complete(outcome)
            }
        }
    }
    try {
        first.await()
    } finally {
        coroutineContext.cancelChildren()
    }
}
