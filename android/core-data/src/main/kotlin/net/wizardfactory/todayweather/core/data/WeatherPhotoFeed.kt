package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.serialization.json.Json
import net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos

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
    private val http: HttpGet = OkHttpGet(TIMEOUT_MS),
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
        val body = firstSettled(ATTEMPTS, ATTEMPT_GAP_MS) { http.get(url, emptyMap()) }.getOrNull() ?: return null
        return runCatching { WeatherPhotos.parse(Json.parseToJsonElement(body)) }.getOrNull()
    }

    companion object {
        const val ATTEMPTS = 3
        const val ATTEMPT_GAP_MS = 2_000L
        /** `_getHttp(url, 20000)` in `loadWeatherPhotos`. */
        const val TIMEOUT_MS = 20_000L
    }
}
