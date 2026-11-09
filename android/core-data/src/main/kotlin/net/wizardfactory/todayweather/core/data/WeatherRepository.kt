package net.wizardfactory.todayweather.core.data

import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/** A place's weather fields as `updateCity` keeps them (`currentWeather`, `timeChart`, `dayChart`, …) and when they came. */
data class WeatherEntry(val weather: JsonObject, val loadedAt: Long)

sealed interface LoadResult {
    /** The response applied to the place that requested it; [place] carries what the response changed in it. */
    data class Loaded(val key: String, val entry: WeatherEntry, val place: Place) : LoadResult

    /** Loaded less than ten minutes ago in this process (`canLoadCity`), or disabled. */
    data object Skipped : LoadResult

    /** A later request for the same place was sent; its answer counts. */
    data object Superseded : LoadResult

    /**
     * No weather: the place has neither coordinates nor address, the request failed, or the body did not convert.
     * [network]: the request failed (an error with a status for `updateWeatherData`).
     */
    data class Failed(val error: Throwable?, val network: Boolean = false) : LoadResult
}

/**
 * The weather of the saved places (#2887): the requests of `getWeatherByGeoInfo`, the response conversion and the
 * city updates of `WeatherInfo`. A response applies to the place that requested it, whichever place is selected when
 * it arrives (the A01 fix): entries are keyed by the place ([key]) and only the latest request of a key applies; an
 * answer to an older request, a failure included, is [LoadResult.Superseded], and answers are stored one at a time.
 * The rest is the Cordova behavior: fields a response leaves out keep their old value (A02), the ten-minute gate
 * lives in memory only, and a failure keeps what was there. Entries are cached in [cacheDir] as Cordova saved the
 * weather with the city, so a cold start shows them while it loads.
 */
class WeatherRepository(
    private val baseUrl: String,
    private val cacheDir: File?,
    private val http: HttpGet = OkHttpGet(WeatherRequests.TIMEOUT_MS),
    private val clock: () -> Long = System::currentTimeMillis,
    /** Where the file cache is read and written. */
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** `weather_fetch`, as `getWeatherByGeoInfo` reports each request. */
    private val telemetry: Telemetry = Telemetry.NONE,
) {
    private val entries = MutableStateFlow<Map<String, WeatherEntry>>(emptyMap())
    private val running = MutableStateFlow<Set<String>>(emptySet())
    private val loadTimes = HashMap<String, Long>()
    private val latestRequest = HashMap<String, Long>()
    private var requests = 0L
    private val commits = Mutex()

    /** Entries by place key, as loaded or read from the cache in this process. */
    val weather: StateFlow<Map<String, WeatherEntry>> = entries.asStateFlow()

    /** Keys of the places with a request in flight (the title's spinner). */
    val loading: StateFlow<Set<String>> = running.asStateFlow()

    /** `canLoadCity`: a disabled place never; otherwise not loaded in this process, or more than ten minutes ago. */
    fun canLoad(place: Place): Boolean {
        if (place.disable) return false
        val loaded = synchronized(this) { loadTimes[key(place)] } ?: return true
        return clock() - loaded > GATE_MS
    }

    /** `reloadCity`: the next gated load of [place] runs. */
    fun invalidate(place: Place) = synchronized(this) { loadTimes.remove(key(place)) }

    /** Every place's next gated load runs (S08 changes reset `loadTime` of every city). */
    fun invalidateAll() = synchronized(this) { loadTimes.clear() }

    /** The weather [place] has: from this process, else from the cache. */
    suspend fun cached(place: Place): WeatherEntry? {
        val key = key(place)
        entries.value[key]?.let { return it }
        val entry = readCache(key) ?: return null
        entries.update { if (key in it) it else it + (key to entry) }
        return entries.value[key]
    }

    /**
     * Loads [place] unless the gate stops it ([force] bypasses the gate, as a tab tap, the retry button and the timer
     * do). [languages] are the app's language tags for `Accept-Language`.
     */
    suspend fun load(place: Place, units: UnitSettings, languages: List<String>, force: Boolean): LoadResult {
        if (place.disable || (!force && !canLoad(place))) return LoadResult.Skipped
        val started = clock()
        val url = WeatherRequests.url(baseUrl, place, units) ?: run {
            fetched("invalid_input", started)
            return LoadResult.Failed(IllegalArgumentException("no location or address"))
        }
        val key = key(place)
        val request = synchronized(this) { (++requests).also { latestRequest[key] = it } }
        running.update { it + key }
        val headers = mapOf("Accept-Language" to WeatherRequests.acceptLanguage(languages))
        val body = try {
            firstSettled(WeatherPhotoFeed.ATTEMPTS, WeatherPhotoFeed.ATTEMPT_GAP_MS) { http.get(url, headers) }
        } finally {
            synchronized(this) { if (latestRequest[key] == request) running.update { it - key } }
        }
        // `$http` parses the body as `JSON.parse` does (the server answers with a JSON content type) and rejects it when it
        // cannot.
        val parsed = body.mapCatching { NationSource.strictJson(it) }
        fetched(if (parsed.isFailure) "network_error" else "success", started)
        // An answer to a request a later one replaced counts for nothing, a failure included.
        if (!latest(key, request)) return LoadResult.Superseded
        val converted = parsed.mapCatching { WeatherConverter.convert(it) }
        val city = converted.getOrNull() ?: return LoadResult.Failed(converted.exceptionOrNull() ?: body.exceptionOrNull(), network = body.isFailure)
        // One answer at a time is stored, and only while it is the latest of its place, so a slower write of an
        // older answer cannot follow a newer one in memory or in the cache.
        return commits.withLock {
            if (!latest(key, request)) return@withLock LoadResult.Superseded
            val previous = cached(place)
            val entry = WeatherEntry(merge(previous?.weather, city), clock())
            val updated = updatePlace(place, city)
            val newKey = key(updated)
            synchronized(this) {
                loadTimes[key] = entry.loadedAt
                // A place that gets its coordinates from the response is found under its new key from now on.
                if (newKey != key) loadTimes[newKey] = entry.loadedAt
            }
            entries.update { it + (key to entry) + (newKey to entry) }
            writeCache(key, entry)
            if (newKey != key) writeCache(newKey, entry)
            LoadResult.Loaded(key, entry, updated)
        }
    }

    private fun latest(key: String, request: Long) = synchronized(this) { latestRequest[key] == request }

    private fun fetched(outcome: String, started: Long) = telemetry.track("weather_fetch", mapOf("outcome" to outcome, "duration_ms" to clock() - started))

    private suspend fun readCache(key: String): WeatherEntry? = withContext(io) {
        val file = cacheFile(key) ?: return@withContext null
        if (!file.isFile) return@withContext null
        runCatching {
            val o = Json.parseToJsonElement(file.readText()) as JsonObject
            WeatherEntry(o["weather"] as JsonObject, (o["loadedAt"] as JsonPrimitive).content.toLong())
        }.getOrNull()
    }

    private suspend fun writeCache(key: String, entry: WeatherEntry) = withContext(io) {
        val file = cacheFile(key) ?: return@withContext
        runCatching {
            file.parentFile?.mkdirs()
            // A file of its own, renamed over the entry: a reader sees the old entry or the new one, never half.
            val temp = File.createTempFile(file.nameWithoutExtension, ".tmp", file.parentFile)
            try {
                temp.writeText(JsonObject(mapOf("loadedAt" to JsonPrimitive(entry.loadedAt), "weather" to entry.weather)).toString())
                if (!temp.renameTo(file)) temp.delete()
            } finally {
                if (temp.exists()) temp.delete()
            }
        }
    }

    private fun cacheFile(key: String): File? = cacheDir?.let { dir ->
        val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        File(dir, "$name.json")
    }

    companion object {
        const val GATE_MS = 10 * 60 * 1000L

        /** The weather fields `updateCity` replaces, each only when the response's value is truthy (A02). */
        private val WEATHER_FIELDS = listOf("currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "source", "airInfo", "airInfoList")

        /** Which place a request and its entry belong to: the current position, else its coordinates, else its address. */
        fun key(place: Place): String {
            val location = place.location
            return when {
                place.currentPosition -> "current"
                location != null && location.lat != 0.0 -> "coord:${WeatherRequests.jsNumber(location.lat)},${WeatherRequests.jsNumber(location.long)}"
                else -> "addr:${place.address.orEmpty()}"
            }
        }

        /** `updateCity`'s weather fields: the previous ones, replaced by the converted response's truthy values. */
        fun merge(previous: JsonObject?, converted: JsonObject): JsonObject {
            val fields = LinkedHashMap<String, JsonElement>()
            previous?.forEach { (k, v) -> if (k in WEATHER_FIELDS) fields[k] = v }
            for (field in WEATHER_FIELDS) converted[field]?.takeIf(::truthy)?.let { fields[field] = it }
            return JsonObject(fields)
        }

        /**
         * `updateCity`'s place fields: the current position takes the response's name, country, address and location;
         * a saved place without a usable location takes the response's (old saved cities, #1971).
         */
        fun updatePlace(place: Place, converted: JsonObject): Place {
            val location = converted["location"]?.takeIf(::truthy)?.let(::location)
            if (place.currentPosition) {
                return place.copy(
                    name = converted.text("name") ?: place.name,
                    country = converted.text("country") ?: place.country,
                    address = converted.text("address") ?: place.address,
                    location = location ?: place.location,
                )
            }
            val own = place.location
            val hasLocation = own != null && own.lat != 0.0
            return if (!hasLocation && location != null && location.lat != 0.0) place.copy(location = location) else place
        }

        private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { truthy(it) }?.contentOrNull

        private fun location(value: JsonElement): Location? {
            val o = value as? JsonObject ?: return null
            val lat = (o["lat"] as? JsonPrimitive)?.doubleOrNull ?: return null
            val long = (o["long"] as? JsonPrimitive)?.doubleOrNull ?: return null
            return Location(lat, long)
        }

        /** JavaScript truthiness of a JSON value: not null, false, 0, NaN or "". */
        fun truthy(value: JsonElement): Boolean = when (value) {
            is JsonNull -> false
            is JsonPrimitive -> when {
                value.isString -> value.content.isNotEmpty()
                value.booleanOrNull != null -> value.booleanOrNull!!
                else -> value.doubleOrNull.let { it != null && it != 0.0 && !it.isNaN() }
            }
            else -> true
        }
    }
}

/** The weather a place shows: its entry's fields with the place's own (`cities[index]` of the Cordova app). */
fun cityRecord(place: Place, entry: WeatherEntry?): JsonObject {
    val fields = LinkedHashMap<String, JsonElement>()
    entry?.weather?.forEach { (k, v) -> fields[k] = v }
    place.name?.let { fields["name"] = JsonPrimitive(it) }
    place.address?.let { fields["address"] = JsonPrimitive(it) }
    place.country?.let { fields["country"] = JsonPrimitive(it) }
    place.location?.let { fields["location"] = JsonObject(mapOf("lat" to JsonPrimitive(it.lat), "long" to JsonPrimitive(it.long))) }
    fields["currentPosition"] = JsonPrimitive(place.currentPosition)
    place.photo?.let { fields["photo"] = JsonPrimitive(it) }
    return JsonObject(fields)
}
