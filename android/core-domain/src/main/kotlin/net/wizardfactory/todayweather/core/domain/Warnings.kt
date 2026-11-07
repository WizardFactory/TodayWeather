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
            val millis = jsDate(item["announcement"])
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

    private val ISO = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$""")

    /** `new Date(value)` for the forms the server sends; null for an Invalid Date. */
    fun jsDate(value: JsonElement?): Long? = when {
        value == null -> null
        value == JsonNull -> 0L
        value is JsonPrimitive && !value.isString -> value.doubleOrNull?.toLong()
        value is JsonPrimitive -> ISO.matchEntire(value.content)?.let { m ->
            val g = m.groupValues
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            cal.clear()
            cal.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].ifEmpty { "0" }.toInt(), g[5].ifEmpty { "0" }.toInt(), g[6].ifEmpty { "0" }.toInt())
            cal.set(Calendar.MILLISECOND, g[7].padEnd(3, '0').take(3).ifEmpty { "0" }.toInt())
            val offset = g[8]
            var millis = cal.timeInMillis
            if (offset.length == 6) {
                val sign = if (offset[0] == '-') -1 else 1
                millis -= sign * (offset.substring(1, 3).toLong() * 3600_000 + offset.substring(4, 6).toLong() * 60_000)
            } else if (offset.isEmpty() && g[4].isNotEmpty()) {
                return null // local-time forms are not sent by the server; not reproduced
            }
            millis
        }
        else -> null
    }

    /** ICU (Chromium) default short date and medium time per language, as the WebView prints them. */
    fun localDateTime(millis: Long, zone: TimeZone, languageTag: String): String {
        val t = Calendar.getInstance(zone).apply { timeInMillis = millis }
        val y = t.get(Calendar.YEAR); val mo = t.get(Calendar.MONTH) + 1; val d = t.get(Calendar.DAY_OF_MONTH)
        val h = t.get(Calendar.HOUR_OF_DAY)
        val mi = "%02d".format(t.get(Calendar.MINUTE)); val s = "%02d".format(t.get(Calendar.SECOND))
        val h12 = if (h % 12 == 0) 12 else h % 12
        val am = h < 12
        return when (languageTag.substringBefore('-').lowercase()) {
            "ko" -> "$y. $mo. $d. ${if (am) "오전" else "오후"} $h12:$mi:$s"
            "ja" -> "$y/$mo/$d $h:$mi:$s"
            "de" -> "$d.$mo.$y ${"%02d".format(h)}:$mi:$s"
            "zh" -> if (languageTag.equals("zh-TW", true) || "Hant" in languageTag) {
                "$y/$mo/$d ${if (am) "上午" else "下午"}$h12:$mi:$s"
            } else {
                "$y/$mo/$d ${"%02d".format(h)}:$mi:$s"
            }
            else -> "$mo/$d/$y $h12:$mi:$s ${if (am) "AM" else "PM"}"
        }
    }
}
