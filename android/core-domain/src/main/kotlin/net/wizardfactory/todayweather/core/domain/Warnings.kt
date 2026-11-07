package net.wizardfactory.todayweather.core.domain

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Weather warnings (S12, KmaSpecialCtrl.parseSpecialData). */
object Warnings {
    /**
     * Formats each announcement as the WebView's `toLocaleDateString() + ' ' + toLocaleTimeString()` for
     * the app's languages, and turns newlines in the comment into `<br>`.
     */
    fun parse(list: JsonArray, languageTag: String, zone: ZoneId): JsonArray = JsonArray(list.map { item ->
        val o = item as? JsonObject ?: return@map item
        var out = o
        (o["announcement"] as? JsonPrimitive)?.content?.let { a ->
            out = JsonObject(out + ("announcement" to JsonPrimitive(localDateTime(Instant.parse(a).atZone(zone), languageTag))))
        }
        (o["comment"] as? JsonPrimitive)?.content?.let { c ->
            out = JsonObject(out + ("comment" to JsonPrimitive(c.replace("\n", "<br>"))))
        }
        out
    })

    /** ICU (Chromium) default short date and medium time per language, as the WebView prints them. */
    fun localDateTime(t: ZonedDateTime, languageTag: String): String {
        val y = t.year; val mo = t.monthValue; val d = t.dayOfMonth
        val h = t.hour; val mi = "%02d".format(t.minute); val s = "%02d".format(t.second)
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
