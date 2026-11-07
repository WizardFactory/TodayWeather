package net.wizardfactory.todayweather.core.domain

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Weather warnings (S12, KmaSpecialCtrl.parseSpecialData). Uses java.util time APIs, available on API 24. */
object Warnings {
    /**
     * Formats each announcement as the WebView's `toLocaleDateString() + ' ' + toLocaleTimeString()` in
     * [timeZoneId] and turns newlines in the comment into `<br>`. Like the Cordova code, it stops at the
     * first item whose comment is not a string and keeps the items processed so far.
     */
    fun parse(list: JsonElement, languageTag: String, timeZoneId: String): JsonElement {
        if (list !is JsonArray) return list
        val zone = TimeZone.getTimeZone(timeZoneId)
        val out = list.toMutableList()
        for ((i, item) in list.withIndex()) {
            if (item !is JsonObject) break // special.announcement on a non-object (or comment.replace) throws
            val millis = jsDate(item["announcement"], zone)
            val text = if (millis == null) "Invalid Date Invalid Date" else localDateTime(millis, zone, languageTag)
            var o = JsonObject(item + ("announcement" to JsonPrimitive(text)))
            out[i] = o
            val comment = item["comment"]
            if (comment !is JsonPrimitive || !comment.isString) break
            o = JsonObject(o + ("comment" to JsonPrimitive(comment.content.replace("\n", "<br>"))))
            out[i] = o
        }
        return JsonArray(out)
    }

    private val ISO = Regex(
        """^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$""",
    )
    private const val MAX_TIME = 8_640_000_000_000_000L

    /**
     * `new Date(value)` as V8 reads the forms the server could send; null for an Invalid Date.
     * ISO strings: month 1–12, day 1–31 (days past the month's end roll over), hour 0–24 (24 only at
     * 24:00:00), minute and second 0–59, offsets up to ±23:59. A date alone is UTC; a date and time
     * without an offset is local time in [zone]. Numbers are milliseconds within ±8.64e15.
     */
    fun jsDate(value: JsonElement?, zone: TimeZone = TimeZone.getTimeZone("UTC")): Long? {
        if (value == null) return null
        if (value == JsonNull) return 0L
        val p = value as? JsonPrimitive ?: return null
        if (!p.isString) {
            val n = p.doubleOrNull ?: return null
            return if (kotlin.math.abs(n) <= MAX_TIME) n.toLong() else null
        }
        val g = ISO.matchEntire(p.content)?.groupValues ?: return null
        val year = g[1].toInt(); val month = g[2].toInt(); val day = g[3].toInt()
        val hasTime = g[4].isNotEmpty()
        val hour = g[4].ifEmpty { "0" }.toInt(); val minute = g[5].ifEmpty { "0" }.toInt()
        val second = g[6].ifEmpty { "0" }.toInt(); val millis = g[7].padEnd(3, '0').take(3).ifEmpty { "0" }.toInt()
        if (month !in 1..12 || day !in 1..31 || minute > 59 || second > 59) return null
        if (hour > 24 || (hour == 24 && (minute != 0 || second != 0 || millis != 0))) return null
        val offset = g[8]
        var offsetMillis = 0L
        if (offset.length == 6) {
            val oh = offset.substring(1, 3).toInt(); val om = offset.substring(4, 6).toInt()
            if (oh > 23 || om > 59) return null
            offsetMillis = (if (offset[0] == '-') -1 else 1) * (oh * 3_600_000L + om * 60_000L)
        }
        val local = hasTime && offset.isEmpty()
        val cal = Calendar.getInstance(if (local) zone else TimeZone.getTimeZone("UTC")).apply {
            clear()
            isLenient = true
            set(year, month - 1, day, hour, minute, second)
            set(Calendar.MILLISECOND, millis)
        }
        val t = cal.timeInMillis - offsetMillis
        return if (kotlin.math.abs(t) <= MAX_TIME) t else null
    }

    /** ICU (Chromium) default short date and medium time per language, as the WebView prints them. */
    fun localDateTime(millis: Long, zone: TimeZone, languageTag: String): String {
        val t = Calendar.getInstance(zone).apply { timeInMillis = millis }
        val y = t.get(Calendar.YEAR); val mo = t.get(Calendar.MONTH) + 1; val d = t.get(Calendar.DAY_OF_MONTH)
        val h = t.get(Calendar.HOUR_OF_DAY)
        val mi = "%02d".format(java.util.Locale.ROOT, t.get(Calendar.MINUTE)); val s = "%02d".format(java.util.Locale.ROOT, t.get(Calendar.SECOND))
        val h12 = if (h % 12 == 0) 12 else h % 12
        val am = h < 12
        return when (languageTag.substringBefore('-').lowercase()) {
            "ko" -> "$y. $mo. $d. ${if (am) "오전" else "오후"} $h12:$mi:$s"
            "ja" -> "$y/$mo/$d $h:$mi:$s"
            "de" -> "$d.$mo.$y ${"%02d".format(java.util.Locale.ROOT, h)}:$mi:$s"
            "zh" -> if (languageTag.equals("zh-TW", true) || "Hant" in languageTag) {
                "$y/$mo/$d ${if (am) "上午" else "下午"}$h12:$mi:$s"
            } else {
                "$y/$mo/$d ${"%02d".format(java.util.Locale.ROOT, h)}:$mi:$s"
            }
            else -> "$mo/$d/$y $h12:$mi:$s ${if (am) "AM" else "PM"}"
        }
    }
}
