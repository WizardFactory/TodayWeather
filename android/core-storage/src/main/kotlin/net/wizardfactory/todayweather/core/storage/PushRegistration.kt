package net.wizardfactory.todayweather.core.storage

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import net.wizardfactory.todayweather.core.domain.AddressFormat

/** One request to the legacy push API; [path] is relative to the server URL. */
data class PushRequest(val method: String, val path: String, val headers: Map<String, String>, val body: JsonElement)

/**
 * What the Cordova `Push` service sends after a start, as pure Kotlin (gate G1 of #2877, push part).
 *
 * `Push.init` loads `pushData2` and repairs records (`loadPushInfo`); the FCM token callback replaces a
 * changed token on the server (`PUT /push` with `newToken`/`oldToken`) and, for a first token, posts the
 * list; 3 seconds after the start the whole list is posted again (`POST /push-list`) when a token exists.
 * Bodies are built like `_makePostObj`. [versionPath] is the API path version (decision 2 of #2877).
 */
object PushRegistration {
    data class Context(
        val deviceId: String,
        val language: String,
        val appVersion: String,
        val units: UnitSettings,
        val nowMillis: Long,
        val zone: TimeZone,
        val versionPath: String = "/v000903",
        val packageName: String = "todayWeather",
    )

    data class Result(val requests: List<PushRequest>, val state: PushState)

    /**
     * A token delivered while the app runs (`onNewToken`, the Cordova token callback after start): the
     * replacement and, for a first token, the post; the start-time repost does not apply.
     */
    fun onTokenRefresh(push: PushState, places: List<Place>, token: String, ctx: Context): Result =
        onStart(push, places, token, ctx, repost = false)

    fun onStart(push: PushState, places: List<Place>, token: String?, ctx: Context, repost: Boolean = true): Result {
        val records = push.records.map { repair(it, places) }
        var state = push.copy(records = records)
        val requests = mutableListOf<PushRequest>()
        if (token != null && token.isNotBlank() && token != state.fcmToken) {
            val first = state.fcmToken.isNullOrEmpty()
            requests += PushRequest("PUT", "${ctx.versionPath}/push", jsonHeaders(ctx, language = false),
                JsonObject(mapOf("newToken" to JsonPrimitive(token), "oldToken" to (state.fcmToken?.let(::JsonPrimitive) ?: JsonNull))))
            state = state.copy(fcmToken = token)
            if (first && records.isNotEmpty()) requests += postList(state, ctx)
        }
        if (repost && records.isNotEmpty() && !state.fcmToken.isNullOrEmpty()) requests += postList(state, ctx)
        return Result(requests, state)
    }

    fun postList(state: PushState, ctx: Context) = PushRequest("POST", "${ctx.versionPath}/push-list", jsonHeaders(ctx, language = true),
        JsonArray(state.records.map { postObject(it, state, ctx) }))

    private fun jsonHeaders(ctx: Context, language: Boolean) = buildMap {
        put("Content-Type", "application/json")
        if (language) put("Accept-Language", ctx.language)
        put("Device-Id", ctx.deviceId)
    }

    /** `loadPushInfo`: the current-position record and records with a broken location take fresh city info. */
    fun repair(record: JsonObject, places: List<Place>): JsonObject {
        val index = (record["cityIndex"] as? JsonPrimitive)?.intOrNull
        val location = record["location"] as? JsonObject
        var r = record
        if (index == 0) r = applyInfo(r, places)
        if (location != null && location["lat"].let { it == null || it == JsonNull }) r = applyInfo(r, places)
        return r
    }

    private fun applyInfo(record: JsonObject, places: List<Place>): JsonObject {
        val index = (record["cityIndex"] as JsonPrimitive).intOrNull ?: return record
        val info = CityInfo.simple(places.getOrNull(index) ?: return record) ?: return record
        val out = record.toMutableMap()
        // `{name: city.name, source: city.source}`: an undefined value removes the key.
        for (key in listOf("name", "source")) info[key]?.let { out[key] = it } ?: out.remove(key)
        info["location"]?.let { out["location"] = it }
        info["town"]?.let { out["town"] = it }
        return JsonObject(out)
    }

    /** `_makePostObj`. */
    fun postObject(r: JsonObject, state: PushState, ctx: Context): JsonObject = buildJsonObject {
        put("type", JsonPrimitive(state.type))
        for (key in listOf("cityIndex", "id", "category", "enable", "name", "location", "town", "source")) r[key]?.let { put(key, it) }
        put("units", JsonObject(UnitSettings.KEYS.associateWith { JsonPrimitive(ctx.units.value(it)) } + ("airForecastSource" to JsonPrimitive("kaq"))))
        put("timezoneOffset", JsonPrimitive(ctx.zone.getOffset(ctx.nowMillis) / 60_000))
        put("package", JsonPrimitive(ctx.packageName))
        put("uuid", JsonPrimitive(ctx.deviceId))
        put("appVersion", JsonPrimitive(ctx.appVersion))
        state.registrationId?.takeIf { it.isNotEmpty() }?.let { put("registrationId", JsonPrimitive(it)) }
        state.fcmToken?.takeIf { it.isNotEmpty() }?.let { put("fcmToken", JsonPrimitive(it)) }
        when ((r["category"] as? JsonPrimitive)?.content) {
            "alarm" -> {
                put("pushTime", utcSecs(r["time"]))
                r["dayOfWeek"]?.let { put("dayOfWeek", it) }
            }
            "alert" -> {
                val start = utcSecs(r["startTime"])
                var end = utcSecs(r["endTime"])
                if (start == end) end = utcSecs(r["endTime"], minusMinutes = 1)
                put("startTime", start)
                put("endTime", end)
                put("airAlertsBreakPoint", JsonPrimitive(if (ctx.units.airUnit == "airkorea" || ctx.units.airUnit == "airkorea_who") 3 else 4))
            }
        }
    }

    /** `date2utcSecs(new Date(iso))`: UTC hours and minutes of the stored instant, in seconds. */
    private fun utcSecs(value: JsonElement?, minusMinutes: Int = 0): JsonPrimitive {
        val iso = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return JsonPrimitive(0)
        val m = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})""").find(iso) ?: return JsonPrimitive(0)
        val (y, mo, d, h, mi, s) = m.destructured
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear(); set(y.toInt(), mo.toInt() - 1, d.toInt(), h.toInt(), mi.toInt(), s.toInt())
            add(Calendar.MINUTE, -minusMinutes)
        }
        return JsonPrimitive(cal.get(Calendar.HOUR_OF_DAY) * 3600 + cal.get(Calendar.MINUTE) * 60)
    }
}

/** `Push._getSimpleCityInfo`: name, source, location (when lat is set) and the KMA town of a place. */
object CityInfo {
    /** Null where the Cordova code throws (no location and no town). */
    fun simple(city: Place): Map<String, JsonElement>? {
        val info = linkedMapOf<String, JsonElement>()
        city.name?.let { info["name"] = JsonPrimitive(it) }
        city.source?.let { info["source"] = JsonPrimitive(it) }
        city.location?.takeIf { it.lat != 0.0 }?.let {
            info["location"] = JsonObject(mapOf("lat" to JsonPrimitive(it.lat), "long" to JsonPrimitive(it.long)))
        }
        if (city.source == "KMA" && city.address != null) {
            val address = if ("대한민국" in city.address) city.address else "대한민국 " + city.address
            val town = AddressFormat.town(AddressFormat.split(address))
            if (town.first.isNotEmpty()) {
                info["town"] = JsonObject(mapOf("first" to JsonPrimitive(town.first), "second" to JsonPrimitive(town.second),
                    "third" to JsonPrimitive(town.third)))
                if ("name" !in info) info["name"] = JsonPrimitive(town.third.ifEmpty { town.second.ifEmpty { town.first } })
            }
        }
        return info.takeIf { "location" in it || "town" in it }
    }
}
