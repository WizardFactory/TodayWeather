package net.wizardfactory.todayweather.core.domain.share

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.domain.ForecastText
import net.wizardfactory.todayweather.core.domain.Js

/** The share message of TabCtrl's `doTabShare` for TodayWeather (O16, V20). */
object ShareMessage {
    /** The Branch links the message ends with: Korean when the device language has `ko`, otherwise English. */
    const val KO_LINK = "https://twa.app.link/wgVmUTfVoM"
    const val LINK = "https://twa.app.link/II1JstpVoM"

    /** The translations it uses: LOC_CURRENT, LOC_HIGHEST, LOC_LOWEST and the app name (`$rootScope.title`). */
    class Texts(val current: String, val highest: String, val lowest: String, val app: String)

    /**
     * The message for the selected [city] record (`WeatherInfo.getCityOfIndex`: the place with its weather), or null
     * when there is none or it has no location (`startPopup` instead). [language] is the device's first language
     * (`navigator.language`). Values are joined as JavaScript joins them; when building the weather lines throws (no
     * `currentWeather`, a `skyIcon` without `indexOf`), the message is the city line alone, as `.finally` shares it.
     */
    fun build(city: JsonObject?, texts: Texts, language: String): String? {
        if (city == null || !Js.present(city["location"])) return null
        val name = city["name"]
        val cityName = if (Js.truthy(name)) Js.string(name) else AddressFormat.shorten((city["address"] as? JsonPrimitive)?.takeIf { it.isString }?.content)
        val head = cityName + "\n"
        val weather = weatherLines(city["currentWeather"], texts) ?: return head
        return head + weather + "\n" + texts.app + " " + (if ("ko" in language) KO_LINK else LINK)
    }

    /** `getWeatherEmoji`. */
    fun emoji(skyIcon: String): String = ForecastText.weatherEmoji(skyIcon)

    /** `_makeMessageForTodayWeather`, or null where it throws. */
    private fun weatherLines(value: JsonElement?, texts: Texts): String? {
        val current = value as? JsonObject ?: return null
        val skyIcon = (current["skyIcon"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val today = current["today"]
        val tmx = if (Js.truthy(today)) (today as? JsonObject)?.get("tmx") else null
        val tmn = if (Js.truthy(today)) (today as? JsonObject)?.get("tmn") else null
        // `summary` keeps its JavaScript value: `summaryWeather` with "\n" + `summaryAir` (strings joined), else `summary`.
        val summary: JsonElement? = when {
            "summaryWeather" in current ->
                if ("summaryAir" in current) JsonPrimitive(Js.string(current["summaryWeather"]) + "\n" + Js.string(current["summaryAir"]))
                else current["summaryWeather"] ?: JsonNull
            "summary" in current -> current["summary"] ?: JsonNull
            else -> null
        }
        return texts.current + " " + Js.string(current["t1h"]) + "˚ " + emoji(skyIcon) + "\n" +
            texts.highest + " " + Js.string(tmx) + "˚, " + texts.lowest + " " + Js.string(tmn) + "˚\n" +
            (if (Js.truthy(summary)) Js.string(summary) + "\n" else "")
    }
}

/** `todayweather://N`, the entry link of the TodayWeather widget, as `branchInit` reads it (A20). */
object EntryLink {
    const val SCHEME = "todayweather"
    private const val PREFIX = "todayweather://"

    /**
     * The place index of [link]: the first `todayweather://` removed, then JavaScript's `parseInt`; null when the rest is
     * empty or no number. The index may be outside the place list; the caller checks it (`setCityIndex`).
     */
    fun placeIndex(link: String): Double? {
        val fav = link.replaceFirst(PREFIX, "")
        if (fav.isEmpty()) return null
        return parseInt(fav).takeUnless { it.isNaN() }
    }

    /** JavaScript `parseInt(s)` without a radix: leading white space, a sign, `0x` for hexadecimal, then digits. */
    internal fun parseInt(s: String): Double {
        var i = 0
        while (i < s.length && (s[i].isWhitespace() || s[i] == ' ' || s[i] == '﻿')) i++
        var sign = 1.0
        if (i < s.length && (s[i] == '+' || s[i] == '-')) {
            if (s[i] == '-') sign = -1.0
            i++
        }
        var radix = 10
        if (i + 1 < s.length && s[i] == '0' && (s[i + 1] == 'x' || s[i + 1] == 'X')) {
            radix = 16
            i += 2
        }
        val start = i
        while (i < s.length && Character.digit(s[i], radix) >= 0 && s[i].code < 128) i++
        if (i == start) return Double.NaN
        return sign * s.substring(start, i).toBigInteger(radix).toDouble()
    }
}
