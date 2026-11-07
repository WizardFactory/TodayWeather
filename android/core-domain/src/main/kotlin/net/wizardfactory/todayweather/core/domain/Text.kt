package net.wizardfactory.todayweather.core.domain

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class Town(val first: String, val second: String, val third: String)

/** Translated LOC_SAME_AS_YESTERDAY and LOC_THAN_YESTERDAY (with one `%s`). */
data class YesterdayText(val same: String, val than: String)

/** Korean address helpers of `WeatherUtil` (getShortenAddress, getTownFromFullAddress, convertAddressArray). */
object AddressFormat {
    fun split(fullAddress: String?): List<String> = if (fullAddress.isNullOrEmpty()) emptyList() else fullAddress.split(" ")

    private val siDo = listOf("특별시", "광역시", "특별자치시", "특별자치도")

    /** `_getShortSiDoName`: 서울특별시 → 서울시, 제주특별자치도 → 제주도. */
    private fun shortSiDo(name: String): String {
        siDo.forEachIndexed { i, suffix ->
            if (name.endsWith(suffix)) return name.replaceFirst(suffix, if (i == siDo.lastIndex) "도" else "시")
        }
        return name
    }

    fun shorten(fullAddress: String?): String {
        val p = split(fullAddress)
        return when (p.size) {
            5 -> shortSiDo(p[2]) + "," + p[4]
            4 -> if (p[1].endsWith("도")) shortSiDo(p[2]) + "," + p[3] else shortSiDo(p[1]) + "," + p[3]
            3 -> shortSiDo(p[1]) + "," + p[2]
            2 -> shortSiDo(p[1])
            else -> ""
        }
    }

    fun town(parts: List<String>): Town = when (parts.size) {
        5 -> Town(parts[1], parts[2] + parts[3], parts[4])
        4 -> if (parts[3].endsWith("구")) Town(parts[1], parts[2] + parts[3], "") else Town(parts[1], parts[2], parts[3])
        3 -> if (parts[2].endsWith("읍") || parts[2].endsWith("면") || parts[2].endsWith("동")) {
            Town(parts[1], parts[1], parts[2])
        } else {
            Town(parts[1], parts[2], "")
        }
        2 -> Town(parts[1], "", "")
        else -> Town("", "", "")
    }
}

/** Display texts computed by the Cordova forecast screen (controller.forecastctrl.js) and WeatherUtil. */
object ForecastText {
    /** `getWeatherEmoji`, used by sharing. */
    fun weatherEmoji(skyIcon: String): String = when {
        "lightning" in skyIcon -> "⛈"
        "rainsnow" in skyIcon -> "☔☃"
        "rain" in skyIcon -> "☔"
        "snow" in skyIcon -> "☃"
        "cloud" in skyIcon -> if ("sun" in skyIcon || "moon" in skyIcon) "⛅" else "☁"
        "sun" in skyIcon || "moon" in skyIcon -> "🌞"
        else -> ""
    }

    /**
     * `_diffTodayYesterday`: "어제보다 +3˚" or "어제와 동일"; empty when either temperature is missing.
     * [currentT1h] null means the property is absent.
     */
    fun diffTodayYesterday(currentT1h: JsonElement?, yesterday: JsonObject?, fahrenheit: Boolean, text: YesterdayText): String {
        val yesterdayT1h = yesterday?.get("t1h")
        if (currentT1h == null || yesterday == null || yesterdayT1h == null) return ""
        val raw = Js.number(currentT1h) - Js.number(yesterdayT1h)
        val diff = if (fahrenheit) Js.round(raw) else Js.toFixedNumber(raw, 1)
        if (diff == 0.0) return text.same
        val str = (if (diff > 0) "+" else "") + Js.numberToString(diff)
        return text.than.replaceFirst("%s", str)
    }

    /** `$scope.getRainSnowFall`: the amount to show, rounded from 10 up, or "0". Keeps the JSON type. */
    fun rainSnowFall(value: JsonObject): JsonElement {
        for (key in listOf("rn1", "s06", "r06")) {
            val v = value[key]
            if (Js.present(v) && Js.greater(v, 0.0)) {
                return if (Js.greaterOrEqual(v, 10.0)) Js.json(Js.round(Js.number(v))) else v!!
            }
        }
        return JsonPrimitive("0")
    }

    /** `$scope.getRainSnowFallSymbol`. */
    fun rainSnowFallSymbol(value: JsonObject): String = when {
        Js.greater(value["rn1"], 0.0) -> if (Js.looseEquals(value["pty"], 3.0)) "snow" else "rain"
        Js.greater(value["s06"], 0.0) -> "snow"
        else -> "rain"
    }
}

object GeoLocation {
    /** `geolocationNormalize`: three decimals, as the Cordova app sends coordinates. */
    fun normalize(lat: Double, long: Double): Pair<Double, Double> = Js.toFixedNumber(lat, 3) to Js.toFixedNumber(long, 3)
}
