package net.wizardfactory.todayweather.core.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/*
 * Models of the legacy-server responses the app reads, and of the converted place weather.
 *
 * Each model is a typed view over the JSON object it came from. The Cordova app passes these objects
 * through without validation, so the views keep the raw value: `raw(key)` is null when the key is
 * absent, JsonNull when it is null, and a string or number exactly as served (sentinels such as -50
 * and numbers sent as strings included). The typed accessors return null when a value is absent,
 * null or not a number; screens that must show the raw text use `raw`.
 */
abstract class JsonView(val json: JsonObject) {
    fun raw(key: String): JsonElement? = json[key]
    fun has(key: String): Boolean = key in json
    protected fun num(key: String): Double? = (json[key] as? JsonPrimitive)?.let { p ->
        if (p is JsonNull) null else if (p.isString) p.content.trim().toDoubleOrNull() else p.doubleOrNull
    }
    protected fun str(key: String): String? = (json[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    protected fun obj(key: String): JsonObject? = json[key] as? JsonObject
    protected fun <T> list(key: String, make: (JsonObject) -> T): List<T> =
        (json[key] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(make) } ?: emptyList()
    override fun equals(other: Any?) = other is JsonView && other.javaClass == javaClass && other.json == json
    override fun hashCode() = json.hashCode()
    override fun toString() = "${javaClass.simpleName}($json)"
}

/** `location` of a place: Cordova order `{lat, long}`. */
class GeoPoint(json: JsonObject) : JsonView(json) {
    val lat get() = num("lat")
    val long get() = num("long")
}

/** One row of the short-term (hourly) forecast; KMA every 3 hours, overseas every hour or 3 hours. */
open class WeatherPoint(json: JsonObject) : JsonView(json) {
    val date get() = str("date")
    val time get() = str("time")
    val fromToday get() = num("fromToday")
    val skyIcon get() = str("skyIcon")
    val t1h get() = num("t1h")
    val t3h get() = num("t3h")
    val pop get() = num("pop")
    val pty get() = num("pty")
    val rn1 get() = num("rn1")
    val r06 get() = num("r06")
    val s06 get() = num("s06")
    val reh get() = num("reh")
    val wsd get() = num("wsd")
    val wdd get() = str("wdd")
    val currentIndex get() = raw("currentIndex")
}

/** One day of the mid-term (daily) forecast. */
class DailyForecast(json: JsonObject) : WeatherPoint(json) {
    val skyAm get() = str("skyAm")
    val skyPm get() = str("skyPm")
    val tmn get() = num("tmn")
    val tmx get() = num("tmx")
    val index get() = num("index")
    val ultrv get() = num("ultrv")
    val ultrvGrade get() = num("ultrvGrade")
    val ultrvStr get() = str("ultrvStr")
    val sunrise get() = str("sunrise")
    val sunset get() = str("sunset")
    val dustForecast get() = obj("dustForecast")
}

/** Air measurements of one station (`airInfo.last`, `currentWeather.arpltn`, nationwide `air[]`). */
class AirMeasurement(json: JsonObject) : JsonView(json) {
    val stationName get() = str("stationName")
    val dataTime get() = str("dataTime")
    fun value(code: String) = raw(code + "Value")
    fun grade(code: String) = num(code + "Grade")
    fun text(code: String) = str(code + "Str")
}

/** One station of `airInfoList` (or the overseas `airInfo`). */
class AirStation(json: JsonObject) : JsonView(json) {
    val last get() = obj("last")?.let(::AirMeasurement)
    val pollutants get() = obj("pollutants")
    val forecastPubDate get() = str("forecastPubDate")
    val forecastSource get() = str("forecastSource")
}

/** `currentWeather` of a converted place. */
class CurrentWeather(json: JsonObject) : WeatherPoint(json) {
    val today get() = obj("today")?.let(::DailyForecast)
    val yesterday get() = obj("yesterday")?.let(::WeatherPoint)
    val arpltn get() = obj("arpltn")?.let(::AirMeasurement)
    val summary get() = str("summary")
    val summaryWeather get() = str("summaryWeather")
    val summaryAir get() = str("summaryAir")
    val stnDateTime get() = str("stnDateTime")
    val sensorytem get() = num("sensorytem")
    val dspls get() = num("dspls")
    val hPa get() = num("hPa")
    val visibility get() = num("visibility")
}

/** A `timeChart` series: "yesterday" or "today". */
class ChartSeries(json: JsonObject) : JsonView(json) {
    val name get() = str("name")
    val values get() = list("values") { WeatherPoint(it["value"] as? JsonObject ?: JsonObject(emptyMap())) }
    val currentIndex get() = num("currentIndex")
    val displayItemCount get() = num("displayItemCount")
}

/** Converted weather of one place, as `WeatherUtil.convertWeatherData` returns it. */
class PlaceWeather(json: JsonObject) : JsonView(json) {
    val source get() = str("source")
    val name get() = str("name")
    val address get() = str("address")
    val country get() = str("country")
    val location get() = obj("location")?.let(::GeoPoint)
    val currentWeather get() = obj("currentWeather")?.let(::CurrentWeather)
    val timeTable get() = list("timeTable", ::WeatherPoint)
    val timeChart get() = list("timeChart", ::ChartSeries)
    val dayTable get() = (json["dayChart"] as? JsonArray)?.firstOrNull()?.let { it as? JsonObject }
        ?.let { (it["values"] as? JsonArray)?.mapNotNull { v -> (v as? JsonObject)?.let(::DailyForecast) } } ?: emptyList()
    val dayDisplayItemCount get() = ((json["dayChart"] as? JsonArray)?.firstOrNull() as? JsonObject)
        ?.get("displayItemCount")?.let { (it as? JsonPrimitive)?.doubleOrNull }
    val airStations get() = list("airInfoList", ::AirStation).ifEmpty { listOfNotNull(obj("airInfo")?.let(::AirStation)) }
}

/** One city of `/v000903/nation/KR` `weather[]`. */
class NationCityWeather(json: JsonObject) : JsonView(json) {
    val regionName get() = str("regionName")
    val cityName get() = str("cityName")
    val townName get() = str("townName")
    val current get() = obj("current")?.let(::WeatherPoint)
}

/** `/v000903/nation/KR`: nationwide weather and air. */
class NationResponse(json: JsonObject) : JsonView(json) {
    val weather get() = list("weather", ::NationCityWeather)
    val air get() = list("air", ::AirMeasurement)
}

/** One bulletin of `/v000903/kma/special`. */
class WeatherWarning(json: JsonObject) : JsonView(json) {
    val announcement get() = str("announcement")
    val type get() = num("type")
    val comment get() = str("comment")
    val bulletin get() = obj("bulletin")
    val situationList get() = json["situationList"] as? JsonArray
}

/** `/v000903/geocode/coord`: address and name of a position. */
class GeocodeResponse(json: JsonObject) : JsonView(json) {
    val address get() = str("address")
    val name get() = str("name")
    val country get() = str("country")
    val location get() = obj("location")?.let(::GeoPoint)
}
