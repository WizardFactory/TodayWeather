package net.wizardfactory.todayweather.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.model.NationResponse
import net.wizardfactory.todayweather.core.storage.UnitSettings

/** What a page's request gave: the answer, or nothing after a failure. */
sealed interface PageLoad<out T> {
    data class Loaded<T>(val value: T) : PageLoad<T>

    /** The request failed: an error status, no answer in time, or an answer the page cannot read. */
    data class Failed(val error: Throwable?) : PageLoad<Nothing>
}

/**
 * The requests of the nationwide pages and the warnings (#2892), with path version `v000903` (AN-06) and the
 * `Accept-Language` of a WebView:
 * - `getNationWeather(Util.region)` for S10 and S11;
 * - `getData` of KmaSpecialCtrl for S12.
 * Each page sends its request when it opens (the Cordova states have `cache: false`). Without a server URL nothing is
 * sent and the request fails.
 */
class NationSource(
    private val baseUrl: String,
    private val nationHttp: HttpGet = OkHttpGet(NATION_TIMEOUT_MS),
    private val specialHttp: HttpGet = OkHttpGet(SPECIAL_TIMEOUT_MS),
) {
    /**
     * `getNationWeather(region)`: `_getHttp(url, 20000)`, so up to three attempts 2 s apart; the first to settle
     * decides, a failure included. The callback reads `data.weather` and `data.air`, so a body that is not a JSON
     * object fails, as the TypeError there leaves the page without values.
     */
    suspend fun nation(region: String, units: UnitSettings, languages: List<String>): PageLoad<NationResponse> {
        if (baseUrl.isBlank()) return PageLoad.Failed(IllegalStateException("no server URL"))
        val url = nationUrl(baseUrl, region, units)
        val headers = mapOf("Accept-Language" to WeatherRequests.acceptLanguage(languages))
        val body = firstSettled(WeatherPhotoFeed.ATTEMPTS, WeatherPhotoFeed.ATTEMPT_GAP_MS) { nationHttp.get(url, headers) }
        return body.mapCatching { NationResponse(strictJson(it) as? JsonObject ?: throw IllegalArgumentException("not an object")) }
            .fold({ PageLoad.Loaded(it) }, { PageLoad.Failed(it) })
    }

    /**
     * `getData(url)` of KmaSpecialCtrl: one GET with `$http`'s 3 s timeout and `responseType: 'json'`. A body that is
     * not JSON reads as null, as the WebView gives it, and shows no card.
     */
    suspend fun special(languages: List<String>): PageLoad<JsonElement> {
        if (baseUrl.isBlank()) return PageLoad.Failed(IllegalStateException("no server URL"))
        val headers = mapOf("Accept-Language" to WeatherRequests.acceptLanguage(languages))
        return try {
            val body = specialHttp.get(specialUrl(baseUrl), headers)
            PageLoad.Loaded(runCatching { strictJson(body) }.getOrDefault(JsonNull))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            PageLoad.Failed(e)
        }
    }

    companion object {
        private val NUMBER = Regex("""-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?""")

        /**
         * `JSON.parse`: kotlinx reads a bare word as a value, which JSON does not allow; such a body is no JSON, as
         * Angular's `fromJson` and the WebView's `responseType: 'json'` find.
         */
        internal fun strictJson(body: String): JsonElement = Json.parseToJsonElement(body).also { check(valid(it)) { "not JSON" } }

        private fun valid(e: JsonElement): Boolean = when (e) {
            is JsonObject -> e.values.all(::valid)
            is kotlinx.serialization.json.JsonArray -> e.all(::valid)
            JsonNull -> true
            is kotlinx.serialization.json.JsonPrimitive -> e.isString || e.content == "true" || e.content == "false" || NUMBER.matches(e.content)
        }

        /** `_getHttp(url, 20000)` of `getNationWeather`. */
        const val NATION_TIMEOUT_MS = 20_000L

        /** `$http({timeout: 3000})` of KmaSpecialCtrl. */
        const val SPECIAL_TIMEOUT_MS = 3_000L

        /** `clientConfig.serverUrl + '/v000903/nation/' + nationCode + _getUnitsParams()`. */
        fun nationUrl(baseUrl: String, region: String, units: UnitSettings): String =
            "$baseUrl/${WeatherRequests.VERSION}/nation/$region${WeatherRequests.unitsQuery(units)}"

        /** `_makeQueryUrl`: `clientConfig.serverUrl + '/v000903/kma/special'`. */
        fun specialUrl(baseUrl: String): String = "$baseUrl/${WeatherRequests.VERSION}/kma/special"
    }
}
