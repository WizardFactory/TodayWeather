package net.wizardfactory.todayweather.core.storage

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/**
 * One-time migration of the Cordova app's native preference suites into [AppState].
 *
 * The Cordova app mirrors its WebView storage into the SharedPreferences suite
 * `group.net.wizardfactory.todayweather`, each value being the JSON text that `TwStorage.set` wrote.
 * The mirror is asynchronous and not retried, so any key can be missing or malformed; each key is
 * validated on its own and falls back to the Cordova default. Pure function of its inputs: the same
 * suites, region, time and zone give the same state.
 */
object CordovaMigration {
    const val SUITE = "group.net.wizardfactory.todayweather"
    const val LEGACY_SUITE = "net.wizardfactory.todayweather_preferences"

    // Weather caches are refetched; `location` lives in [Place.location] (validated: a non-finite number
    // would make the state unserializable).
    private val CACHE_KEYS = setOf("currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "airInfo",
        "airInfoList", "loadTime", "location")
    private val EXTRA_KEYS = listOf("startVersion", "appVersion", "disableUpdateInfo")

    /**
     * @param local the WebView localStorage items ([WebViewLocalStorage]); the newest values, preferred
     * @param suite values of [SUITE] (strings as stored; other types as their JSON text), used per key when
     *   localStorage lacks it (for example after the WebView storage was cleared)
     * @param legacySuite values of [LEGACY_SUITE], used for units when the suite has none
     * @param region device country for unit defaults (Cordova `Util.region`)
     * @param nowMillis and [zone]: the migration time, for converting legacy alarms like `secs2date`
     */
    fun migrate(
        local: Map<String, String>,
        suite: Map<String, String?>,
        legacySuite: Map<String, String?>,
        region: String?,
        nowMillis: Long,
        zone: TimeZone,
    ): AppState {
        val report = linkedMapOf<String, String>()
        val sources = linkedMapOf<String, String>()
        /** The localStorage value when it parses, else the suite's; malformed only when neither parses. */
        fun parse(key: String, from: Map<String, String?>? = null): JsonElement? {
            val candidates = if (from != null) listOf("legacySuite" to from[key])
                else listOf("localStorage" to local[key], "suite" to suite[key])
            val present = candidates.filter { it.second != null }
            if (present.isEmpty()) return null.also { report.putIfAbsent(key, "absent") }
            for ((source, text) in present) {
                val parsed = try { Json.parseToJsonElement(text!!) } catch (_: Exception) { null }
                if (parsed != null) {
                    sources[key] = source
                    return parsed
                }
            }
            report[key] = "malformed"
            return null
        }

        val places = places(parse("cities"), report)
        val placeIndex = placeIndex(parse("cityIndex"), places, report)
        val units = units(parse("units") ?: parse("units", legacySuite)?.also { report["units"] = "legacy" }, region, report)
        val settings = settings(parse("settingsInfo"), local, report)
        val push = push(parse("pushData2"), parse("pushData"), places, nowMillis, zone, report)
        val expand = (parse("expandShortChart") as? JsonPrimitive)?.booleanOrNull
        report["expandShortChart"] = if (expand != null) "migrated" else report["expandShortChart"] ?: "default"
        val extras = EXTRA_KEYS.mapNotNull { k -> parse(k)?.let { k to it } }.toMap()
        extras.keys.forEach { report[it] = "migrated" }
        return AppState(
            places = places, placeIndex = placeIndex, units = units, settings = settings, push = push,
            expandShortChart = expand ?: false, cordovaExtras = extras,
            migration = MigrationInfo(sources.entries.joinToString(",") { "${it.key}=${it.value}" }, nowMillis, report),
        )
    }

    /** `WeatherInfo.loadCities`: restore defaults; a missing or broken list starts like a new install. */
    private fun places(cities: JsonElement?, report: MutableMap<String, String>): List<Place> {
        val list = cities as? JsonArray
        if (list == null) {
            if (cities != null) report["cities"] = "malformed"
            return listOf(Place.currentPositionPlaceholder())
        }
        // An entry that is not an object keeps its slot as a disabled place, so `cityIndex` and the
        // alarms' `cityIndex` still point at the same places.
        val out = list.mapIndexed { index, item ->
            val city = item as? JsonObject ?: return@mapIndexed Place(currentPosition = index == 0, disable = true)
            Place(
                currentPosition = (city["currentPosition"] as? JsonPrimitive)?.booleanOrNull == true,
                // createCity: a missing disable means enabled
                disable = (city["disable"] as? JsonPrimitive)?.booleanOrNull ?: false,
                name = city.string("name"),
                address = city.string("address"),
                country = city.string("country"),
                location = location(city["location"]),
                source = city.string("source"),
                photo = city.string("photo"),
                cordova = JsonObject(city.filterKeys { it !in CACHE_KEYS }),
            )
        }
        report["cities"] = if (list.all { it is JsonObject } && out.isNotEmpty()) "migrated" else "partial"
        return out.ifEmpty { listOf(Place.currentPositionPlaceholder()) }
    }

    /** Finite coordinates within ±90/±180, or null (the place is then address-only, as old favorites are). */
    private fun location(value: JsonElement?): Location? {
        val loc = value as? JsonObject ?: return null
        val lat = (loc["lat"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        val long = (loc["long"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        if (lat == null || long == null || !lat.isFinite() || !long.isFinite()) return null
        if (lat !in -90.0..90.0 || long !in -180.0..180.0) return null
        return Location(lat, long)
    }

    /** `loadCities` index rules; `setFirstCityIndex` when absent, out of range or invalid. */
    private fun placeIndex(index: JsonElement?, places: List<Place>, report: MutableMap<String, String>): Int {
        val i = (index as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        if (i != null && i in places.indices) {
            report["cityIndex"] = "migrated"
            return i
        }
        report["cityIndex"] = if (index == null) report["cityIndex"] ?: "default" else "malformed"
        return when {
            !places[0].disable -> 0
            places.size > 1 -> 1
            else -> -1
        }
    }

    /** `Units.loadUnits`: missing members and the retired `aircn` take the region defaults. */
    private fun units(saved: JsonElement?, region: String?, report: MutableMap<String, String>): UnitSettings {
        val defaults = UnitSettings.defaults(region)
        val obj = saved as? JsonObject
        var replaced = false
        val values = UnitSettings.KEYS.associateWith { key ->
            val v = (obj?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (v != null && v in UnitSettings.OPTIONS.getValue(key)) v else defaults.value(key).also { replaced = true }
        }
        report["units"] = when {
            obj == null && saved != null -> "malformed"
            obj == null -> report["units"] ?: "default"
            replaced -> "partial"
            else -> report["units"] ?: "migrated"
        }
        return UnitSettings.of(values)
    }

    private val STARTUP_PAGES = setOf("0", "1", "2", "3")
    private val THEMES = setOf("light", "dark", "photo", "old")

    /**
     * `settingsInfo`; `setForwardCompatibility` adds the light theme when missing. Without it,
     * `_setBackwardCompatibility` builds it from the standalone localStorage keys `startupPage` and
     * `refreshInterval` (raw strings, not JSON), which never reach the native suite.
     */
    private fun settings(saved: JsonElement?, local: Map<String, String>, report: MutableMap<String, String>): Settings {
        val obj = saved as? JsonObject
        if (obj == null) {
            val legacyStartup = local["startupPage"]?.takeIf { it in STARTUP_PAGES }
            val legacyRefresh = local["refreshInterval"]?.takeIf { it.toIntOrNull()?.let { m -> m >= 0 } == true }
            if (saved == null && (legacyStartup != null || legacyRefresh != null)) {
                report["settingsInfo"] = "legacy"
                return Settings(legacyStartup ?: "0", legacyRefresh ?: "0")
            }
            report["settingsInfo"] = if (saved != null) "malformed" else report["settingsInfo"] ?: "default"
            return Settings()
        }
        val d = Settings()
        val startup = obj.string("startupPage")?.takeIf { it in STARTUP_PAGES }
        val refresh = obj.string("refreshInterval")?.takeIf { it.toIntOrNull()?.let { m -> m >= 0 } == true }
        val theme = obj.string("theme")?.takeIf { it in THEMES }
        report["settingsInfo"] = if (startup != null && refresh != null && theme != null) "migrated" else "partial"
        return Settings(startup ?: d.startupPage, refresh ?: d.refreshInterval, theme ?: d.theme)
    }

    private fun push(
        current: JsonElement?, legacy: JsonElement?, places: List<Place>, nowMillis: Long, zone: TimeZone,
        report: MutableMap<String, String>,
    ): PushState {
        val obj = current as? JsonObject
        if (obj != null) {
            val list = obj["pushList"] as? JsonArray
            val records = list?.mapNotNull { r -> (r as? JsonObject)?.takeIf { validRecord(it) } } ?: emptyList()
            val orphans = records.count { (it["cityIndex"] as JsonPrimitive).intOrNull !in places.indices }
            report["pushData2"] = if (list != null && records.size == list.size) "migrated" else "partial"
            report["pushData2.records"] = "${(list?.size ?: 0) - records.size} dropped, $orphans orphan"
            return PushState(
                registrationId = obj.string("registrationId"),
                type = obj.string("type") ?: "android",
                category = obj.string("category") ?: "",
                fcmToken = obj.string("fcmToken"),
                records = records,
            )
        }
        if (current != null) report["pushData2"] = "malformed"
        // Push.init: legacy pushData converts only while pushData2 is absent or unparsable.
        val old = legacy as? JsonObject
        val alarms = (old?.get("alarmList") as? JsonArray)?.mapNotNull { it as? JsonObject }
        if (old == null || alarms == null) return PushState()
        report["pushData"] = "legacy"
        val alerts = alarms.map { a ->
            val cityIndex = (a["cityIndex"] as? JsonPrimitive)?.intOrNull ?: -1
            newRecord(cityIndex, 1, places) + mapOf(
                "startTime" to JsonPrimitive(secs2date(7 * 3600, nowMillis, zone)),
                "endTime" to JsonPrimitive(secs2date(22 * 3600, nowMillis, zone)),
                "enable" to JsonPrimitive(false), "category" to JsonPrimitive("alert"),
            )
        }
        val converted = alarms.map { a ->
            val cityIndex = (a["cityIndex"] as? JsonPrimitive)?.intOrNull ?: -1
            a + mapOf(
                "time" to (jsDateIso(a["time"])?.let(::JsonPrimitive) ?: JsonNull),
                "category" to JsonPrimitive("alarm"), "id" to JsonPrimitive(cityIndex + 1),
                "enable" to JsonPrimitive(true), "dayOfWeek" to buildJsonArray { repeat(7) { add(JsonPrimitive(true)) } },
            )
        }
        return PushState(
            registrationId = old.string("registrationId"), type = old.string("type") ?: "android",
            records = (alerts + converted).map(::JsonObject), needsAlertIntro = true,
        )
    }

    private val ISO_INSTANT = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$""")

    /** An ISO instant (`Date.toISOString()` form) naming a real date and time: no rollover, hours 0–23. */
    private fun validInstant(text: String): Boolean {
        if (!ISO_INSTANT.matches(text)) return false
        val n = Regex("""\d+""").findAll(text).map { it.value.toInt() }.toList()
        return runCatching {
            Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
                clear()
                isLenient = false
                set(n[0], n[1] - 1, n[2], n[3], n[4], n[5])
                timeInMillis // a non-lenient calendar throws on an out-of-range field here
            }
        }.isSuccess
    }

    /**
     * A record the server can take back: integer `cityIndex` and `id`, boolean `enable`, and for an alert
     * ISO `startTime`/`endTime`, for an alarm an ISO `time` and seven booleans in `dayOfWeek`; times must
     * name real dates and times. Other records are dropped. Records
     * whose `cityIndex` names no place are kept (the Cordova app keeps them too, anomaly A24) and counted.
     */
    private fun validRecord(r: JsonObject): Boolean {
        fun int(k: String) = (r[k] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        fun iso(k: String) = (r[k] as? JsonPrimitive)?.takeIf { it.isString && validInstant(it.content) } != null
        if (int("cityIndex") == null || int("id") == null) return false
        if ((r["enable"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == null) return false
        return when (r.string("category")) {
            "alert" -> iso("startTime") && iso("endTime")
            "alarm" -> iso("time") && (r["dayOfWeek"] as? JsonArray)?.let { days ->
                days.size == 7 && days.all { (it as? JsonPrimitive)?.takeIf { p -> !p.isString }?.booleanOrNull != null }
            } == true
            else -> false
        }
    }

    /** `newPushAlert` base fields with `_getSimpleCityInfo`; a city without location or town gets only the base. */
    private fun newRecord(cityIndex: Int, id: Int, places: List<Place>): Map<String, JsonElement> {
        val base = linkedMapOf<String, JsonElement>("cityIndex" to JsonPrimitive(cityIndex), "id" to JsonPrimitive(id))
        val info = places.getOrNull(cityIndex)?.let(CityInfo::simple) ?: return base
        return base + info
    }

    /**
     * `secs2date`: `setHours(0,0,0,0)` then `setSeconds(secs)` on the migration day, which sets local wall
     * time (07:00 stays 07:00 on daylight-saving days), as an ISO instant.
     */
    fun secs2date(secs: Int, nowMillis: Long, zone: TimeZone): String {
        val cal = Calendar.getInstance(zone).apply {
            timeInMillis = nowMillis
            isLenient = true
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.MILLISECOND, 0)
            set(Calendar.SECOND, secs)
        }
        return iso(cal.timeInMillis)
    }

    private fun jsDateIso(v: JsonElement?): String? = when {
        v is JsonPrimitive && !v.isString && v != JsonNull -> v.doubleOrNull?.toLong()?.let(::iso)
        v is JsonPrimitive && v.isString -> v.content.takeIf { Regex("""^\d{4}-\d{2}-\d{2}T.*Z$""").matches(it) }
        else -> null
    }

    fun iso(millis: Long): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = millis }
        return "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ".format(java.util.Locale.ROOT, c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND),
            c.get(Calendar.MILLISECOND))
    }

    private fun JsonObject.string(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
}
