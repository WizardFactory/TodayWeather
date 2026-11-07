package net.wizardfactory.todayweather.core.data

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.wizardfactory.todayweather.core.storage.PushRequest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Sends push API requests; returns the HTTP status, or null when the request did not complete. */
fun interface PushTransport {
    suspend fun send(request: PushRequest): Int?
}

/**
 * [PushTransport] over HTTP to the legacy server at [baseUrl], with the Cordova app's 10-second timeout.
 * Failures are not retried: the Cordova app does not retry either, and the list is posted again on the
 * next start.
 */
class HttpPushTransport(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build(),
) : PushTransport {
    override suspend fun send(request: PushRequest): Int? = withContext(Dispatchers.IO) {
        val body = request.body.toString().toRequestBody("application/json".toMediaType())
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + request.path).method(request.method, body)
        request.headers.filterKeys { it != "Content-Type" }.forEach { (k, v) -> builder.header(k, v) }
        runCatching { client.newCall(builder.build()).execute().use { it.code } }.getOrNull()
    }
}
