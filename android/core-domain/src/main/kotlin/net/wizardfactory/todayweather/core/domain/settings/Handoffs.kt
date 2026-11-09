package net.wizardfactory.todayweather.core.domain.settings

/**
 * The targets of the menu rows that open other apps (controller.settingctrl.js `clickMenu`, service.util.js `sendMail`
 * and `openMarket`). The wind map and the store page open as `cordova.InAppBrowser.open(url, "_system")` opens them;
 * the feedback mail as the WebView opens a `mailto:` link.
 */
object Handoffs {
    /** 널스쿨 풍향 (region KR): the wind map over Korea. */
    const val NULLSCHOOL = "https://earth.nullschool.net/#current/wind/surface/level/orthographic=-233.36,38.96,3000"

    /** 응원리뷰쓰기: the store page of the app's package (`clientConfig.androidStoreUrl`). */
    const val STORE = "market://details?id=net.wizardfactory.todayweather"

    /**
     * 의견보내기 (`Util.sendMail`): a `mailto:` link to [to] with the translated [subject] as it is and a body with the
     * app [version], the device [uuid] and the [userAgent], encoded by `encodeURIComponent` (D37: the UUID stays).
     */
    fun feedbackMail(to: String, subject: String, version: String, uuid: String, userAgent: String): String {
        val body = "\n====================\nApp Version : $version\nUUID : $uuid\nUA : $userAgent\n====================\n"
        return "mailto:$to?subject=$subject&body=${encodeUriComponent(body)}"
    }

    /** JavaScript's `encodeURIComponent`: UTF-8 bytes in %XX except letters, digits and `-_.!~*'()`. */
    fun encodeUriComponent(s: String): String = buildString {
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if (c < 0x80 && (c.toChar().isLetterOrDigit() || c.toChar() in "-_.!~*'()")) append(c.toChar())
            else append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
        }
    }
}

/**
 * The About popup (O10, `openInfo`): the app's name as the title, the data sources and the provisional-data notice
 * (one line each, `<br>` in the Cordova template) and 확인. [text] translates a catalog key.
 */
class About(text: (String) -> String) {
    val title: String = text("LOC_TODAYWEATHER")
    val lines: List<String> = listOf(
        text("LOC_WEATHER_INFORMATION") + " : " + text("LOC_KOREA_METEOROLOGICAL_ADMINISTRATION"),
        text("LOC_AQI_INFORMATION") + " : " + text("LOC_KOREA_ENVIRONMENT_CORPORATION"),
        text("LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS"),
    )
    val ok: String = text("LOC_OK")

    companion object {
        val KEYS = listOf("LOC_TODAYWEATHER", "LOC_WEATHER_INFORMATION", "LOC_KOREA_METEOROLOGICAL_ADMINISTRATION", "LOC_AQI_INFORMATION",
            "LOC_KOREA_ENVIRONMENT_CORPORATION", "LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS", "LOC_OK")
    }
}
