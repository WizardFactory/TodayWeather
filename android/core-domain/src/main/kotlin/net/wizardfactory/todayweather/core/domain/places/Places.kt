package net.wizardfactory.todayweather.core.domain.places

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.start.APP_INFO_HINT
import net.wizardfactory.todayweather.core.domain.start.LocationMessage
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.PredictionName
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm

/**
 * A row of S02's list (SearchCtrl `init`, tab-search.html): the label lines, the location glyph of the current
 * position, a disabled row (shown only in edit mode), the sky icon and, when the place has a temperature, the
 * temperature and today's minimum and maximum; the bell is on when an enabled alarm names the row's index.
 */
data class PlaceRow(
    val lines: List<String>,
    val currentPosition: Boolean,
    val disabled: Boolean,
    val skyIcon: String,
    /** `{{t1h.toFixed(0)}}˚`; null when the place has no temperature (`t1h` is `-`). */
    val temperature: String?,
    /** `{{tmn.toFixed(0)}}˚/{{tmx.toFixed(0)}}˚`, a value that is no number printing nothing. */
    val minMax: String?,
    val hasPush: Boolean,
)

object PlaceRows {
    /** `LOC_CURRENT` and `LOC_LOCATION` of the app's catalog. */
    data class Texts(val current: String, val location: String)

    /**
     * The row's label lines: `[name]`, else the shortened address split on its comma, else one empty line. The current
     * position without an address reads 현재위치, joined without a space when `Util.language` contains ko, ja, zh-CN
     * or zh-TU (A13: zh-TW gets the space).
     */
    fun label(name: String?, address: String?, currentPosition: Boolean, language: String, texts: Texts): List<String> {
        if (currentPosition && address == null) {
            val joined = listOf("ko", "ja", "zh-CN", "zh-TU").any { it in language }
            return listOf(if (joined) texts.current + texts.location else texts.current + " " + texts.location)
        }
        return when {
            !name.isNullOrEmpty() -> listOf(name)
            !address.isNullOrEmpty() -> AddressFormat.shorten(address).split(",")
            else -> listOf("")
        }
    }

    /** A row from the place and its stored `currentWeather` (none: no weather yet). */
    fun row(name: String?, address: String?, currentPosition: Boolean, disable: Boolean, currentWeather: JsonObject?, hasPush: Boolean,
            language: String, texts: Texts): PlaceRow {
        val sky = (currentWeather?.get("skyIcon") as? JsonPrimitive)?.takeIf { Js.truthy(it) }?.content ?: "sun"
        val t1h = currentWeather?.get("t1h")
        val today = currentWeather?.get("today") as? JsonObject
        val shown = t1h != null && !(t1h is JsonPrimitive && t1h.isString && t1h.content == "-")
        return PlaceRow(label(name, address, currentPosition, language, texts), currentPosition, disable, sky,
            if (shown) fixed(t1h) + "˚" else null,
            if (shown) fixed(today?.get("tmn")) + "˚/" + fixed(today?.get("tmx")) + "˚" else null, hasPush)
    }

    /** `value.toFixed(0)` in a template: a number's digits, anything else nothing. */
    private fun fixed(value: kotlinx.serialization.json.JsonElement?): String =
        (value as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.let { Js.toFixed(it, 0) } ?: ""

    /**
     * `goPage()`: the startup page's tab, `"0"` Hourly, `"1"` Daily, `"3"` Air; `"4"` (TodayAir's weather page),
     * `"2"` and anything else the product's default, Hourly.
     */
    fun startTab(startupPage: String?): Tab = when (startupPage) {
        "1" -> Tab.DAILY
        "3" -> Tab.AIR
        else -> Tab.HOURLY
    }
}

/** SearchCtrl's `/geocode/…/addr/` query of a Places prediction: its terms in order, joined by commas (`Array.toString`). */
object SearchQuery {
    fun of(fullText: String): String = PredictionName.terms(fullText).sortedBy { it.first }.joinToString(",") { it.second }
}

/**
 * O03 of type `search` (TabCtrl `showRetryConfirm`, controller.tabctrl.js L435-L636) for S02's find-by-location and the
 * current position's first enable: Close first, then by the status recorded last, a permanent denial's app-info hint and
 * Settings to the app's page, an unrecorded status's OK, location off's Settings to the location settings and OK, else
 * OK. OK always finds by location again (A26).
 */
object SearchLocation {
    fun retry(message: LocationMessage, recorded: PermissionStatus?, enabled: Boolean): RetryConfirm = when {
        recorded == PermissionStatus.DENIED_ALWAYS -> RetryConfirm(message.lines + APP_INFO_HINT, listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS))
        recorded == null -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY))
        !enabled -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY))
        else -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY))
    }
}
