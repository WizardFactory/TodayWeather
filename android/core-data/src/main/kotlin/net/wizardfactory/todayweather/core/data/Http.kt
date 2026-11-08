package net.wizardfactory.todayweather.core.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Gets the body of a URL sent with [headers]; throws [HttpStatusException] for an error status, IOException otherwise. */
fun interface HttpGet {
    suspend fun get(url: String, headers: Map<String, String>): String
}

/** An error status, as `$http` reports it to `_retryGetHttp` (`err.code = status`). */
class HttpStatusException(val code: Int) : IOException("HTTP $code")

/**
 * [HttpGet] over OkHttp with the Cordova app's timeout of [timeoutMs] per attempt (`_getHttp(url, timeout)`: 10 s,
 * 20 s for the photo feed). Like `$http`'s timeout it bounds the whole request; OkHttp's 10-second connect, read and
 * write limits are off, so they cannot end a slower answer first. Cancelling the caller cancels the call, so a slower
 * attempt ends when another has answered.
 */
class OkHttpGet(timeoutMs: Long) : HttpGet {
    private val client = OkHttpClient.Builder()
        .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .connectTimeout(0, TimeUnit.MILLISECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    override suspend fun get(url: String, headers: Map<String, String>): String = suspendCancellableCoroutine { continuation ->
        val request = Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val body = runCatching {
                    response.use { if (it.isSuccessful) it.body.string() else throw HttpStatusException(it.code) }
                }
                body.fold(continuation::resume, continuation::resumeWithException)
            }
        })
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
