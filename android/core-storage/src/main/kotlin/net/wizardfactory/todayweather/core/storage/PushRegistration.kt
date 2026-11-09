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

    /**
     * `Push.updateUnits` after a unit change (#1845; S08, #2891): the list as `loadPushInfo` repaired it, posted again
     * with the new units of [ctx]; nothing without records or a token (`_postPushList` stops without one).
     */
    fun onUnitsChanged(push: PushState, places: List<Place>, ctx: Context): Result {
        val state = push.copy(records = push.records.map { repair(it, places) })
        if (state.records.isEmpty() || state.fcmToken.isNullOrEmpty()) return Result(emptyList(), state)
        return Result(listOf(postList(state, ctx)), state)
    }

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
                if (start == end) end = epochMillis(r["endTime"])?.let { utcSecs(minuteBack(it, ctx.zone)) } ?: end
                put("startTime", start)
                put("endTime", end)
                put("airAlertsBreakPoint", JsonPrimitive(if (ctx.units.airUnit == "airkorea" || ctx.units.airUnit == "airkorea_who") 3 else 4))
            }
        }
    }

    /** `date2utcSecs(new Date(iso))`: UTC hours and minutes of the stored instant, in seconds. */
    private fun utcSecs(value: JsonElement?): JsonPrimitive = epochMillis(value)?.let(::utcSecs) ?: JsonPrimitive(0)

    private fun utcSecs(millis: Long): JsonPrimitive {
        val ms = Math.floorMod(millis, DAY)
        return JsonPrimitive(ms / 3_600_000 * 3600 + ms % 3_600_000 / 60_000 * 60)
    }

    /** The instant of a stored ISO time (`toISOString`, UTC). */
    private fun epochMillis(value: JsonElement?): Long? {
        val iso = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val m = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})""").find(iso) ?: return null
        val (y, mo, d, h, mi, s) = m.destructured
        return Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear(); set(y.toInt(), mo.toInt() - 1, d.toInt(), h.toInt(), mi.toInt(), s.toInt())
        }.timeInMillis
    }

    /**
     * `date.setMinutes(date.getMinutes() - 1)` in [zone]: the local wall time one minute earlier, turned back into
     * an instant as V8 does (ECMA-262 `UTC(t)`): a repeated local time takes its earlier instant, a skipped one
     * the offset before the transition. In New York on 2026-11-01, 06:00Z (01:00 EST) becomes 04:59Z (00:59 EDT).
     */
    private fun minuteBack(millis: Long, zone: TimeZone): Long {
        val local = millis + zone.getOffset(millis) - 60_000
        val before = zone.getOffset(local - DAY)
        val after = zone.getOffset(local + DAY)
        return if (zone.getOffset(local - before) != before && zone.getOffset(local - after) == after) local - after else local - before
    }

    private const val DAY = 86_400_000L
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
