package net.wizardfactory.todayweather.core.domain

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Port of `WeatherUtil.convertWeatherData` (client/www/js/service.weatherutil.js): turns a v000903
 * `/weather/.../coord` response into the place weather the screens read (currentWeather, timeTable,
 * timeChart, dayChart, air data, source). Values pass through unchanged, as in the Cordova app.
 */
object WeatherConverter {
    private class JsTypeError : RuntimeException()

    /** Returns null where the Cordova code returns null (a response it cannot parse). */
    fun convert(response: JsonElement): JsonObject? {
        if (response == JsonNull) throw IllegalArgumentException("null weather data") // Cordova throws here too
        val data = try {
            if (response is JsonObject && response["source"].let { it is JsonPrimitive && it.isString && it.content == "KMA" }) {
                parseKma(response)
            } else {
                parseWorld(response)
            }
        } catch (_: JsTypeError) {
            return null
        }
        if (response !is JsonObject) return data
        val extra = listOf("name", "address", "country", "location").filter { it in response }
        return JsonObject(data + extra.associateWith { response[it]!! })
    }

    private fun parseKma(weather: JsonObject): JsonObject {
        val mid = parseDaily(weather["midData"].let { if (it is JsonObject) it["dailyData"] as? JsonArray else null }, copy = false)
        var current = weather["current"].let { if (Js.truthy(it)) it!! else JsonObject(emptyMap()) }
        current = withToday(current, mid)
        val short = parseHourly(weather["short"], worldFallback = false)
        return buildJsonObject {
            put("currentWeather", current)
            put("timeTable", short.first)
            put("timeChart", short.second)
            put("dayChart", dayChart(mid, current))
            putAir(weather)
            put("source", JsonPrimitive("KMA"))
        }
    }

    private fun parseWorld(weather: JsonElement): JsonObject {
        val obj = weather as? JsonObject
        val daily = obj?.get("daily") as? JsonArray ?: throw JsTypeError() // daily.forEach
        val mid = parseDaily(daily, copy = true)
        val short = parseHourly(obj["hourly"], worldFallback = true)
        var current = worldCurrent(obj["thisTime"])
        current = withToday(current, mid)
        return buildJsonObject {
            put("currentWeather", current)
            put("timeTable", short.first)
            put("timeChart", short.second)
            put("dayChart", dayChart(mid, current))
            val pubDate = obj["pubDate"]
            if (obj.containsKey("pubDate")) {
                if (pubDate == JsonNull) throw JsTypeError()
                if (pubDate is JsonObject && "VC" in pubDate) put("source", JsonPrimitive("VC"))
            }
            putAir(obj)
        }
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putAir(weather: JsonObject) {
        weather["airInfo"]?.takeIf(Js::truthy)?.let { put("airInfo", it) }
        weather["airInfoList"]?.takeIf(Js::truthy)?.let { put("airInfoList", it) }
    }

    /** `_parseWorldCurrentWeather`: thisTime[1] with yesterday = thisTime[0]. */
    private fun worldCurrent(thisTime: JsonElement?): JsonElement {
        fun at(i: Int): JsonElement? = when (thisTime) {
            is JsonArray -> thisTime.getOrNull(i)
            is JsonObject -> thisTime[i.toString()]
            null, JsonNull -> throw JsTypeError()
            else -> null
        }
        val current = at(1)
        if (current == null || current == JsonNull) throw JsTypeError()
        if (current !is JsonObject) return current
        val yesterday = at(0)
        return if (yesterday == null) JsonObject(current - "yesterday") else JsonObject(current + ("yesterday" to yesterday))
    }

    private class Daily(val table: List<JsonElement>, val displayItemCount: Int, val today: JsonElement?, val valid: Boolean)

    /** `_parseMidTownWeather` / `_parseWorldDailyWeather`. */
    private fun parseDaily(days: JsonArray?, copy: Boolean): Daily {
        if (days == null) return Daily(emptyList(), 0, null, valid = false)
        var count = 0
        var today: JsonElement = JsonNull
        val table = days.mapIndexed { index, day ->
            var data = day
            if (data is JsonObject && Js.looseEquals(data["fromToday"], 0.0)) {
                data = JsonObject(data + ("index" to JsonPrimitive(index)))
                today = data
            }
            val d = data as? JsonObject
            var c = 0
            if (d != null) {
                val am = d["skyAm"]
                val pm = d["skyPm"]
                if ((Js.present(am) || Js.present(pm)) && !Js.looseEquals(am, pm) && Js.truthy(am) && Js.truthy(pm)) c = c or 4
                if (Js.truthy(d["pop"]) && Js.greater(d["pop"], 0.0) && Js.greaterOrEqual(d["fromToday"], 0.0)) c = c or 2
                if (rainy(d)) c = c or 1
            }
            if (c > count) count = c
            data
        }
        return Daily(table, count, today, valid = true)
    }

    private fun rainy(d: JsonObject) = listOf("rn1", "r06", "s06").any { Js.truthy(d[it]) && Js.greater(d[it], 0.0) }

    /** `_parseShortTownWeather` (KMA) / `_parseWorldHourlyWeather` (world): timeTable and the two chart series. */
    private fun parseHourly(list: JsonElement?, worldFallback: Boolean): Pair<JsonArray, JsonArray> {
        if (list !is JsonArray) return JsonArray(emptyList()) to JsonArray(emptyList())
        var currentIndex: Int? = if (worldFallback) null else -1
        var count = 0
        list.forEachIndexed { index, item ->
            val o = item as? JsonObject
            if (o != null && Js.truthy(o["currentIndex"])) currentIndex = index
            if (o != null && Js.greater(o["fromToday"], -2.0)) {
                var c = 0
                if (Js.present(o["skyIcon"])) c++
                if (Js.truthy(o["pop"]) && Js.greater(o["pop"], 0.0)) c++
                if (count == 2 && rainy(o)) c++
                if (c > count) count = c
            }
        }
        if (currentIndex == null) currentIndex = list.size - 1
        val n = list.size
        val table = slice(list, 8, n)
        val yesterday = slice(list, 0, n - 8).map { wrap("yesterday", it) }
        val today = slice(list, 8, n).map { wrap("today", it) }
        val chart = JsonArray(listOf(
            buildJsonObject { put("name", JsonPrimitive("yesterday")); put("values", JsonArray(yesterday)) },
            buildJsonObject {
                put("name", JsonPrimitive("today"))
                put("values", JsonArray(today))
                put("currentIndex", JsonPrimitive(currentIndex!! - 8))
                put("displayItemCount", JsonPrimitive(count))
            },
        ))
        return JsonArray(table) to chart
    }

    private fun wrap(name: String, value: JsonElement) = buildJsonObject { put("name", JsonPrimitive(name)); put("value", value) }

    /** `Array.prototype.slice(start, end)` with JavaScript's negative-index rules. */
    private fun slice(list: List<JsonElement>, start: Int, end: Int): List<JsonElement> {
        val n = list.size
        fun norm(i: Int) = if (i < 0) maxOf(n + i, 0) else minOf(i, n)
        val s = norm(start)
        val e = norm(end)
        return if (s >= e) emptyList() else list.subList(s, e)
    }

    /** `currentForecast.today = midTownWeather.today`; undefined removes the key, as JSON serialization does. */
    private fun withToday(current: JsonElement, mid: Daily): JsonElement {
        if (current !is JsonObject) return current
        return if (mid.valid) JsonObject(current + ("today" to (mid.today ?: JsonNull))) else JsonObject(current - "today")
    }

    private fun dayChart(mid: Daily, current: JsonElement) = JsonArray(listOf(buildJsonObject {
        put("values", JsonArray(mid.table))
        (current as? JsonObject)?.get("t1h")?.let { put("temp", it) }
        put("displayItemCount", JsonPrimitive(mid.displayItemCount))
    }))
}
