package net.wizardfactory.todayweather.core.storage

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The rollback hand-back (AN-17, #2896): what a fallback Cordova build, shipped with a higher versionCode when the native
 * release must be rolled back, reads of the state the user left in the native app. The native app writes it into the
 * Cordova suite ([CordovaMigration.SUITE]) on every state change; the fallback build prefers it over its stale WebView
 * storage when [MARKER] says so (`client/www/js/service.storage.js`).
 *
 * Contract, schema 1: [MARKER] holds `{"schema":1,"generation":N,"writer":"native"|"cordova","complete":true,"keys":[…]}`;
 * each of [KEYS] holds the text the Cordova app itself writes (`TwStorage.set`'s JSON; the consent as `Monetization`
 * stores it), or is absent when the state has none, so a deleted place or alarm cannot come back. `generation` grows by
 * one at each hand-over; the fallback build claims the state with `writer: cordova`, after which the native start
 * migrates its storage again ([claimedByCordova], [MigrationRunner]).
 */
object CordovaHandBack {
    /** The marker's suite key: the leading `_` keeps it out of the migration's suite read and Cordova's restore list. */
    const val MARKER = "_twHandBack"
    const val SCHEMA = 1
    const val NATIVE = "native"
    const val CORDOVA = "cordova"

    /** `Monetization`'s consent key, which the Cordova app keeps in WebView storage only. */
    const val CONSENT = "twAnalyticsConsentV1"

    /** The keys a hand-back owns; `pushData` (legacy alarms, converted into `pushData2`) is always removed. */
    val KEYS = listOf("cities", "cityIndex", "cityList", "units", "settingsInfo", "pushData2", "pushData", "expandShortChart",
        "startVersion", "appVersion", "disableUpdateInfo", CONSENT)

    /** Defaults written too: Cordova reads every member of `settingsInfo`. */
    private val json = Json { encodeDefaults = true }

    /** The weather caches `createCity` leaves empty; the native app does not keep them ([CordovaMigration]). */
    private val EMPTY_CACHES = listOf("currentWeather", "timeTable", "timeChart", "dayTable", "dayChart")

    /**
     * The Cordova text of each of [KEYS] for [state] and the stored consent choice [consent] (`"true"`, `"false"` or
     * none); null removes the key.
     */
    fun texts(state: AppState, consent: String?): Map<String, String?> {
        val cities = state.places.map(::city)
        return linkedMapOf(
            "cities" to JsonArray(cities).toString(),
            "cityIndex" to state.placeIndex.toString(),
            "cityList" to cityList(cities).toString(),
            "units" to json.encodeToString(UnitSettings.serializer(), state.units),
            "settingsInfo" to json.encodeToString(Settings.serializer(), state.settings),
            "pushData2" to pushData2(state.push).toString(),
            "pushData" to null,
            "expandShortChart" to state.expandShortChart.toString(),
            "startVersion" to state.cordovaExtras["startVersion"]?.toString(),
            "appVersion" to state.cordovaExtras["appVersion"]?.toString(),
            "disableUpdateInfo" to state.cordovaExtras["disableUpdateInfo"]?.toString(),
            CONSENT to consent?.takeIf { it == "true" || it == "false" },
        )
    }

    /**
     * A city record as the Cordova app keeps it: the record it had ([Place.cordova]) with the caches empty, and the
     * native fields over it; a field the native app has no value for keeps the record's key empty, or stays absent.
     */
    private fun city(place: Place): JsonObject {
        val out = linkedMapOf<String, JsonElement>()
        place.cordova?.let(out::putAll)
        EMPTY_CACHES.forEach { out[it] = JsonNull }
        fun put(key: String, value: JsonElement?) {
            if (value != null) out[key] = value else if (key in out) out[key] = JsonNull
        }
        put("currentPosition", JsonPrimitive(place.currentPosition))
        put("disable", JsonPrimitive(place.disable))
        put("name", place.name?.let(::JsonPrimitive))
        put("address", place.address?.let(::JsonPrimitive))
        put("country", place.country?.let(::JsonPrimitive))
        put("location", place.location?.let { buildJsonObject { put("lat", it.lat); put("long", it.long) } })
        put("source", place.source?.let(::JsonPrimitive))
        put("photo", place.photo?.let(::JsonPrimitive))
        return JsonObject(out)
    }

    /** `WeatherInfo._saveCitiesPreference`: the enabled places' summary with their index. */
    private fun cityList(cities: List<JsonObject>): JsonObject = buildJsonObject {
        put("cityList", buildJsonArray {
            cities.forEachIndexed { index, city ->
                if ((city["disable"] as? JsonPrimitive)?.booleanOrNull == true) return@forEachIndexed
                add(buildJsonObject {
                    (city["name"] as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.let { put("name", it) }
                    put("currentPosition", city["currentPosition"] ?: JsonNull)
                    put("address", city["address"] ?: JsonNull)
                    put("location", city["location"] ?: JsonNull)
                    put("country", city["country"] ?: JsonNull)
                    put("index", index)
                })
            }
        })
    }

    /** `Push.pushData` as `savePushInfo` stores it. */
    private fun pushData2(push: PushState): JsonObject = buildJsonObject {
        put("registrationId", push.registrationId?.let(::JsonPrimitive) ?: JsonNull)
        put("type", push.type)
        put("category", push.category)
        put("fcmToken", push.fcmToken?.let(::JsonPrimitive) ?: JsonNull)
        put("pushList", JsonArray(push.records))
    }

    data class Marker(val schema: Int, val generation: Int, val writer: String, val complete: Boolean, val keys: List<String>)

    /** The marker text of a hand-over by [writer] as [generation], complete with [KEYS]. */
    fun marker(generation: Int, writer: String): String = buildJsonObject {
        put("schema", SCHEMA)
        put("generation", generation)
        put("writer", writer)
        put("complete", true)
        put("keys", JsonArray(KEYS.map(::JsonPrimitive)))
    }.toString()

    /** The marker in [text], or null when it is not one (unreadable, or a member missing or of another type). */
    fun parse(text: String?): Marker? {
        val obj = runCatching { Json.parseToJsonElement(text ?: return null) }.getOrNull() as? JsonObject ?: return null
        fun int(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        val schema = int("schema") ?: return null
        val generation = int("generation") ?: return null
        val writer = (obj["writer"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val complete = (obj["complete"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: return null
        val keys = (obj["keys"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: return null
        return Marker(schema, generation, writer, complete, keys)
    }

    /** The generation of the next hand-over after the stored marker [text]: one more, or 1 without a readable one. */
    fun nextGeneration(text: String?): Int = (parse(text)?.generation ?: 0) + 1

    /** The fallback build's complete schema-1 claim in [text], or null. */
    fun cordovaClaim(text: String?): Marker? =
        parse(text)?.takeIf { it.schema == SCHEMA && it.complete && it.writer == CORDOVA }

    /** Whether the stored marker [text] is the fallback build's complete schema-1 claim of the state. */
    fun claimedByCordova(text: String?): Boolean = cordovaClaim(text) != null

}
