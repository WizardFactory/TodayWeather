package net.wizardfactory.todayweather.core.data

import java.math.BigDecimal
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * The weather requests of the Cordova app (`getWeatherByGeoInfo` and its URL builders in service.weatherutil.js), with
 * path version `v000903` for every call (AN-06) and the `Accept-Language` of a WebView.
 */
object WeatherRequests {
    const val VERSION = "v000903"

    /** `_getHttp(url)` in `getWeatherByGeoInfo`: 10 s per attempt. */
    const val TIMEOUT_MS = 10_000L

    /**
     * The URL for [place], or null when it has neither coordinates nor an address (Cordova rejects with
     * `invalid_input`). Coordinates win when the latitude is truthy (A05: latitude 0 falls back to the address). An
     * address gets `대한민국 ` when it lacks it and is split into a KMA town; when no part is left, the free-form route
     * gets the address as stored, which the gateway answers with 501. Nothing is encoded here, as in Cordova; the
     * HTTP client encodes spaces and non-ASCII characters as the WebView did.
     */
    fun url(baseUrl: String, place: Place, units: UnitSettings): String? {
        val location = place.location
        if (location != null && location.lat != 0.0) {
            return "$baseUrl/weather/$VERSION/coord/${jsNumber(location.lat)},${jsNumber(location.long)}${unitsQuery(units)}"
        }
        val address = place.address
        if (address.isNullOrEmpty()) return null
        val town = AddressFormat.town(AddressFormat.split(if (address.contains("대한민국")) address else "대한민국 $address"))
        if (town.first.isEmpty() && town.second.isEmpty() && town.third.isEmpty()) {
            return "$baseUrl/weather/$VERSION/addr/$address${unitsQuery(units)}"
        }
        val parts = listOf(town.first, town.second, town.third).filter { it.isNotEmpty() }.joinToString("") { "/$it" }
        return "$baseUrl/$VERSION/kma/addr$parts${unitsQuery(units)}"
    }

    /** `_getUnitsParams`: the units in `Units.getAllUnits()` order, then `airForecastSource=kaq`. */
    fun unitsQuery(units: UnitSettings): String = "?temperatureUnit=${units.temperatureUnit}&windSpeedUnit=${units.windSpeedUnit}" +
        "&pressureUnit=${units.pressureUnit}&distanceUnit=${units.distanceUnit}&precipitationUnit=${units.precipitationUnit}" +
        "&airUnit=${units.airUnit}&airForecastSource=kaq"

    /**
     * The `Accept-Language` a WebView sends for [languageTags] (the app's languages, first preferred), as Chrome builds
     * it: each tag, followed by its base language when the next tag does not share it and the list does not name it,
     * with q-values falling by 0.1 from the second entry (never below 0.1). The weather gateway reads the first
     * language's primary subtag.
     */
    fun acceptLanguage(languageTags: List<String>): String {
        val expanded = mutableListOf<String>()
        languageTags.forEachIndexed { i, tag ->
            if (tag !in expanded) expanded += tag
            val base = tag.substringBefore('-')
            val nextBase = languageTags.getOrNull(i + 1)?.substringBefore('-')
            if (base != tag && nextBase != base && base !in expanded && base !in languageTags) expanded += base
        }
        return expanded.mapIndexed { i, tag -> if (i == 0) tag else "$tag;q=0.${maxOf(10 - i, 1)}" }.joinToString(",")
    }

    /** A number as JavaScript prints it in a string: no `.0` for integers, no exponent for small fractions. */
    internal fun jsNumber(value: Double): String = BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
}
