package net.wizardfactory.todayweather.core.storage

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/** The push records' builders and times of the Cordova `Push` service (`newPushAlert`, `newPushAlarm`, `date2localSecs`). */
object PushRecords {
    /** `newPushAlert(id, cityIndex, startHour, endHour)`: enabled, the hours as local wall times of today, the city info. */
    fun newAlert(id: Int, cityIndex: Int, startHour: Double, endHour: Double, places: List<Place>, nowMillis: Long, zone: TimeZone): JsonObject =
        record(linkedMapOf("cityIndex" to JsonPrimitive(cityIndex), "id" to JsonPrimitive(id),
            "startTime" to JsonPrimitive(CordovaMigration.secs2date((startHour * 3600).toInt(), nowMillis, zone)),
            "endTime" to JsonPrimitive(CordovaMigration.secs2date((endHour * 3600).toInt(), nowMillis, zone)),
            "enable" to JsonPrimitive(true), "category" to JsonPrimitive("alert")), cityIndex, places)

    /** `newPushAlarm(id, cityIndex, secs, dayOfWeek)`: enabled, the time as a local wall time of today, the city info. */
    fun newAlarm(id: Int, cityIndex: Int, seconds: Int, days: List<Boolean>, places: List<Place>, nowMillis: Long, zone: TimeZone): JsonObject =
        record(linkedMapOf("cityIndex" to JsonPrimitive(cityIndex), "id" to JsonPrimitive(id),
            "time" to JsonPrimitive(CordovaMigration.secs2date(seconds, nowMillis, zone)), "dayOfWeek" to days(days),
            "enable" to JsonPrimitive(true), "category" to JsonPrimitive("alarm")), cityIndex, places)

    /** `_getSimpleCityInfo` copied over the base; a city without location or town leaves the base alone (the throw is caught). */
    private fun record(base: LinkedHashMap<String, JsonElement>, cityIndex: Int, places: List<Place>): JsonObject {
        places.getOrNull(cityIndex)?.let(CityInfo::simple)?.let(base::putAll)
        return JsonObject(base)
    }

    fun days(days: List<Boolean>) = JsonArray(days.map(::JsonPrimitive))

    /** `date2localSecs(new Date(iso))`: the local hours and minutes of a stored instant, in seconds; 0 without one. */
    fun localSeconds(iso: JsonElement?, zone: TimeZone): Int = calendar(iso, zone)?.let {
        it.get(Calendar.HOUR_OF_DAY) * 3600 + it.get(Calendar.MINUTE) * 60
    } ?: 0

    /** `getDate()` of a stored instant in [zone]. */
    fun localDayOfMonth(iso: JsonElement?, zone: TimeZone): Int? = calendar(iso, zone)?.get(Calendar.DAY_OF_MONTH)

    private fun calendar(iso: JsonElement?, zone: TimeZone): Calendar? {
        val text = (iso as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val m = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})""").find(text) ?: return null
        val (y, mo, d, h, mi, s) = m.destructured
        val millis = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear(); set(y.toInt(), mo.toInt() - 1, d.toInt(), h.toInt(), mi.toInt(), s.toInt())
        }.timeInMillis
        return Calendar.getInstance(zone).apply { timeInMillis = millis }
    }

    fun cityIndex(record: JsonObject): Int? = (record["cityIndex"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull

    fun category(record: JsonObject): String? = (record["category"] as? JsonPrimitive)?.takeIf { it.isString }?.content

    fun id(record: JsonObject): Int? = (record["id"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull

    /** `enable` as stored; Cordova tests it with `===` or truthiness, so only `true` counts as on. */
    fun enabled(record: JsonObject): Boolean = (record["enable"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
}

/**
 * S09 for one place (PushCtrl, AN-14 #2893): the alert, the alarms and their weekdays as the page holds them, with
 * PushCtrl's rules and anomalies (AN-06):
 * - [load] takes the place's records (the last alert wins, alarms in stored order, the weekdays of the first alarm) and
 *   fills what is missing with defaults that count as edits (D34): an enabled 07–22 alert, Mon–Fri, alarms at 07:40 and
 *   20:20, with `_generateId`'s ids;
 * - the hour bar reads the alert's local hours, an end of 0 as 24 only when the end's day of the month is later (A23);
 * - Delete in the picker keeps the alarm, disabled; a new alarm takes `_generateId`; the add row shows while fewer than
 *   five alarms are enabled;
 * - [equalHours] ignores the switch; [toSave] is nothing without an edit, else the alert with today's hours and every
 *   alarm with the shared weekdays.
 * Times are the device's [TimeZone], as the Cordova `Date`s were.
 */
data class AlarmSettings(
    val cityIndex: Int,
    val alert: JsonObject,
    val alarms: List<JsonObject>,
    val days: List<Boolean>,
    val startHour: Double,
    val endHour: Double,
    val updated: Boolean,
) {
    /** The switch (`ng-true-value="true"`). */
    val alertOn: Boolean get() = PushRecords.enabled(alert)

    /** The hour bar shows unless the alert is off (`ng-hide="alert.enable === false"`). */
    val barShown: Boolean get() = (alert["enable"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull != false

    /** The enabled alarms (`ng-if="value.enable"`) with their index in the list. */
    fun rows(zone: TimeZone): List<Pair<Int, Int>> =
        alarms.mapIndexedNotNull { i, a -> if (PushRecords.enabled(a)) i to PushRecords.localSeconds(a["time"], zone) else null }

    /** `canMakeNewAlarm`: fewer than five enabled alarms. */
    val canAdd: Boolean get() = alarms.count(PushRecords::enabled) < 5

    /** The picker's input: the alarm's local time, or 08:00 for the add row. */
    fun pickerInput(index: Int, zone: TimeZone): Int = alarms.getOrNull(index)?.let { PushRecords.localSeconds(it["time"], zone) } ?: 8 * 3600

    /** `startTime === endTime`, with the switch on or off. */
    val equalHours: Boolean get() = startHour == endHour

    fun toggleDay(day: Int) = copy(days = days.mapIndexed { i, on -> if (i == day) !on else on }, updated = true)

    fun setAlert(on: Boolean) = copy(alert = JsonObject(alert + ("enable" to JsonPrimitive(on))), updated = true)

    fun setHours(from: Double, to: Double) = copy(startHour = from, endHour = to, updated = true)

    /**
     * The picker's answer for [index] (an alarm, or the add row at the end): null is Close (no change), 0 is Delete (the
     * alarm is disabled; the add row only marks an edit), anything else is Set (the alarm's time and `enable`, or a new
     * alarm with the shared weekdays).
     */
    fun pick(index: Int, seconds: Int?, places: List<Place>, nowMillis: Long, zone: TimeZone): AlarmSettings {
        if (seconds == null) return this
        if (seconds == 0) {
            val alarm = alarms.getOrNull(index) ?: return copy(updated = true)
            return copy(alarms = alarms.toMutableList().also { it[index] = JsonObject(alarm + ("enable" to JsonPrimitive(false))) }, updated = true)
        }
        if (index >= alarms.size) {
            return copy(alarms = alarms + PushRecords.newAlarm(generateId(alarms, hasAlert = true), cityIndex, seconds, days, places, nowMillis, zone),
                updated = true)
        }
        val time = JsonPrimitive(CordovaMigration.secs2date(seconds, nowMillis, zone))
        return copy(alarms = alarms.toMutableList().also { it[index] = JsonObject(alarms[index] + mapOf("time" to time, "enable" to JsonPrimitive(true))) },
            updated = true)
    }

    /** `_savePushInfo`: nothing without an edit; else the alert with the bar's hours on today and the alarms with the weekdays. */
    fun toSave(nowMillis: Long, zone: TimeZone): List<JsonObject>? {
        if (!updated) return null
        val alertCopy = JsonObject(alert + mapOf(
            "startTime" to JsonPrimitive(CordovaMigration.secs2date((startHour * 3600).toInt(), nowMillis, zone)),
            "endTime" to JsonPrimitive(CordovaMigration.secs2date((endHour * 3600).toInt(), nowMillis, zone))))
        return listOf(alertCopy) + alarms.map { JsonObject(it + ("dayOfWeek" to PushRecords.days(days))) }
    }

    companion object {
        val WEEKDAYS = listOf(false, true, true, true, true, true, false)

        /** The alarm defaults (07:40 and 20:20), "smoother than a lunch or commute alarm". */
        val DEFAULT_ALARMS = listOf(7 * 3600 + 40 * 60, 20 * 3600 + 20 * 60)

        /** PushCtrl `init` for [cityIndex]: `_loadPushInfo`, then the defaults. */
        fun load(records: List<JsonObject>, cityIndex: Int, places: List<Place>, nowMillis: Long, zone: TimeZone): AlarmSettings {
            var alert: JsonObject? = null
            val alarms = mutableListOf<JsonObject>()
            var days: List<Boolean> = emptyList()
            var updated = false
            for (record in records.filter { PushRecords.cityIndex(it) == cityIndex }) {
                when (PushRecords.category(record)) {
                    "alert" -> alert = record
                    "alarm" -> {
                        alarms += record
                        if (days.isEmpty()) days = (record["dayOfWeek"] as? JsonArray)?.map { (it as? JsonPrimitive)?.booleanOrNull == true }.orEmpty()
                    }
                }
            }
            if (alert == null) {
                alert = PushRecords.newAlert(generateId(alarms, hasAlert = false), cityIndex, 7.0, 22.0, places, nowMillis, zone)
                updated = true
            }
            if (days.isEmpty()) {
                days = WEEKDAYS
                updated = true
            }
            if (alarms.isEmpty()) {
                DEFAULT_ALARMS.forEach { alarms += PushRecords.newAlarm(generateId(alarms, hasAlert = true), cityIndex, it, days, places, nowMillis, zone) }
                updated = true
            }
            val start = PushRecords.localSeconds(alert["startTime"], zone) / 3600.0
            var end = PushRecords.localSeconds(alert["endTime"], zone) / 3600.0
            if (end == 0.0) {
                val endDay = PushRecords.localDayOfMonth(alert["endTime"], zone)
                val startDay = PushRecords.localDayOfMonth(alert["startTime"], zone)
                if (endDay != null && startDay != null && endDay > startDay) end = 24.0
            }
            return AlarmSettings(cityIndex, alert, alarms, days, start, end, updated)
        }

        /** `_generateId`: the last alarm's id + 1; without alarms 2, or 1 while there is no alert yet. */
        fun generateId(alarms: List<JsonObject>, hasAlert: Boolean): Int = when {
            alarms.isNotEmpty() -> (PushRecords.id(alarms.last()) ?: 0) + 1
            !hasAlert -> 1
            else -> 2
        }
    }
}
