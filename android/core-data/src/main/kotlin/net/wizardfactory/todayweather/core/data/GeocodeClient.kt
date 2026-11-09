package net.wizardfactory.todayweather.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place

/**
 * The geocoding of the start page and the place search (`getGeoInfoByLocation` and `getGeoInfoByAddr` in
 * service.weatherutil.js, #2889): the gateway's `/geocode/v000903/coord/{lat},{long}` and `/geocode/v000903/addr/{address}`,
 * sent as the weather requests are (`_getHttp`: 10 s per attempt, three attempts 2 s apart, the first to settle decides,
 * with the WebView's `Accept-Language`). Nothing is encoded here, as in Cordova. An answer is the body as JSON
 * (`data.data`); a body that is no JSON object reads as one without fields.
 */
class GeocodeClient(private val baseUrl: String, private val http: HttpGet = OkHttpGet(WeatherRequests.TIMEOUT_MS)) {
    /** The place at [location] (already rounded to 3 decimals) with its name; null when the request fails. */
    suspend fun byLocation(location: Location, languages: List<String>): JsonObject? =
        get("$baseUrl/geocode/${WeatherRequests.VERSION}/coord/${WeatherRequests.jsNumber(location.lat)},${WeatherRequests.jsNumber(location.long)}", languages)

    /** The place of [address], without a name; null when the request fails. */
    suspend fun byAddress(address: String, languages: List<String>): JsonObject? =
        get("$baseUrl/geocode/${WeatherRequests.VERSION}/addr/$address", languages)

    private suspend fun get(url: String, languages: List<String>): JsonObject? {
        if (baseUrl.isBlank()) return null
        val headers = mapOf("Accept-Language" to WeatherRequests.acceptLanguage(languages))
        val body = firstSettled(WeatherPhotoFeed.ATTEMPTS, WeatherPhotoFeed.ATTEMPT_GAP_MS) { http.get(url, headers) }
        return body.mapCatching { NationSource.strictJson(it) as? JsonObject ?: JsonObject(emptyMap()) }.getOrNull()
    }

    companion object {
        /**
         * A `geoInfo` as a place: its `name`, `address`, `country` and `location` (when both coordinates are numbers), as
         * `saveCity` copies them.
         */
        fun place(geoInfo: JsonObject, currentPosition: Boolean): Place {
            fun text(key: String) = (geoInfo[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            val location = (geoInfo["location"] as? JsonObject)?.let { o ->
                val lat = (o["lat"] as? JsonPrimitive)?.doubleOrNull
                val long = (o["long"] as? JsonPrimitive)?.doubleOrNull
                if (lat != null && long != null) Location(lat, long) else null
            }
            return Place(currentPosition = currentPosition, disable = false, name = text("name"), address = text("address"),
                country = text("country"), location = location)
        }
    }
}
