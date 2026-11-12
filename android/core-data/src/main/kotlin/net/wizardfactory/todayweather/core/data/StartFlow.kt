package net.wizardfactory.todayweather.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.GeoLocation
import net.wizardfactory.todayweather.core.domain.start.CityShortcut
import net.wizardfactory.todayweather.core.domain.start.LocationMessage
import net.wizardfactory.todayweather.core.domain.start.LocationStep
import net.wizardfactory.todayweather.core.domain.start.PermissionClass
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.PredictionName
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.core.domain.start.StartLocation
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.core.domain.start.placeInfo
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList
import net.wizardfactory.todayweather.core.storage.closeStart

/**
 * The device's location as the start page and the current position use it (the diagnostic, geolocation and
 * location-accuracy plugins): the permission, the location service, positions and Google Play services'
 * high-accuracy dialog. The app implements it on the platform; tests pass doubles.
 */
interface LocationAccess {
    /** Location services are on (`Util.isLocationEnabled`). */
    fun enabled(): Boolean

    /** `getLocationAuthorizationStatus`; precise or approximate access counts as granted. */
    fun status(): PermissionStatus

    /** `requestLocationAuthorization`: the system prompt for precise and approximate access; the status after it. */
    suspend fun request(): PermissionStatus

    /** `getCurrentPosition`: the first fix within 60 s, a fix up to 60 s old counting; null when none came. */
    suspend fun position(): Location?

    /** `locationAccuracy.request(REQUEST_PRIORITY_HIGH_ACCURACY)`: true when location services turned on. */
    suspend fun requestHighAccuracy(): Boolean
}

/**
 * S01's adds (StartCtrl, #2889): a city shortcut (`OnGetWeather`), a search result (`OnSelectResult`: a Places
 * prediction or, without a Places key, a bundled town) and the current position (`_onUseLocationService`). Each loads
 * the place's weather before it is saved; a saved place closes S01 (`close()`: `startVersion` stored, the last place
 * selected). One flow lives as long as its start page, as the controller did, with its own recorded permission status.
 */
class StartFlow(
    private val state: StateAccess,
    private val repository: WeatherRepository,
    private val geocode: GeocodeClient,
    private val location: LocationAccess,
    private val languages: () -> List<String>,
    private val telemetry: Telemetry = Telemetry.NONE,
    /** `window.updateCityInfo(index)`, which `updateCity` calls: the push records of the place follow it. */
    private val cityUpdated: (Int) -> Unit = {},
) {
    /** What the position lookup ended in: the geocoded position, or the message of its failure. */
    sealed interface Located {
        data class Found(val geoInfo: JsonObject) : Located
        data class Failed(val message: LocationMessage) : Located
    }

    sealed interface Outcome {
        /** A place was saved and S01 closed. */
        data object Added : Outcome

        /** O09: an alert titled `LOC_ERROR` with [message]. */
        data class Alert(val message: String) : Outcome

        /** O04: the retry confirmation. */
        data class Confirm(val confirm: RetryConfirm) : Outcome

        /** Nothing shows (the address geocode failed, as in Cordova). */
        data object None : Outcome
    }

    /** `gLocationAuthorizationStatus`: the status last read or answered on this page. */
    var recorded: PermissionStatus? = null
        private set

    /** `OnGetWeather(index)`: the shortcut's own name, address, country and coordinates. */
    suspend fun addShortcut(shortcut: CityShortcut): Outcome =
        add(Place(false, false, shortcut.name, shortcut.address, shortcut.country, Location(shortcut.lat, shortcut.long)))

    /**
     * A chosen Places prediction: named by [PredictionName], geocoded by [query] (S01: its full text,
     * `getGeoInfoByAddr(description)`; S02: its terms joined by commas); a failed geocode shows nothing.
     */
    suspend fun addPrediction(fullText: String, firstMatch: Int?, word: String, query: String = fullText): Outcome {
        val name = PredictionName.of(fullText, firstMatch, word)
        val geoInfo = geocode.byAddress(query, languages()) ?: return Outcome.None
        return add(GeocodeClient.place(geoInfo, currentPosition = false).copy(name = name))
    }

    /** S02's find-by-location row: the geocoded position added as an ordinary place with its name. */
    suspend fun addGeoInfo(geoInfo: JsonObject): Outcome = add(GeocodeClient.place(geoInfo, currentPosition = false))

    /** A chosen bundled town, with the address and name SearchCtrl builds; no geocode request. */
    suspend fun addTown(town: Town): Outcome {
        val info = town.placeInfo()
        return add(Place(false, false, info.name, info.address, info.country, Location(info.lat, info.long)))
    }

    /** `saveCity` then `addCity`: an existing place, or a body that does not convert, is "already added". */
    private suspend fun add(city: Place): Outcome {
        val s = state.current() ?: return Outcome.None
        return when (val result = repository.load(city, s.units, languages(), force = true)) {
            is LoadResult.Loaded -> {
                val saved = city.copy(source = source(result.entry.weather) ?: city.source)
                if (PlaceList.add(s, saved) == null) return Outcome.Alert(ALREADY_ADDED)
                state.change { current -> PlaceList.add(current, saved)?.closeStart() ?: current }
                telemetry.track("favorite_change", mapOf("action" to "add"))
                Outcome.Added
            }
            is LoadResult.Failed -> Outcome.Alert(if (result.unconvertible) ALREADY_ADDED else FAILED_WEATHER)
            LoadResult.Skipped, LoadResult.Superseded -> Outcome.None
        }
    }

    /**
     * `_onUseLocationService`: the permission and the location service decide ([StartLocation]); a fix, rounded to three
     * decimals, is geocoded (`/coord`) and its weather loaded; then the current position is enabled and named from the
     * geocode. A grant from the prompt runs it again at once; every failure ends in O04 (#2871). [loading] shows and
     * hides the loading overlay as StartCtrl did, hidden before the prompt while location services are on.
     */
    suspend fun useCurrentLocation(loading: (Boolean) -> Unit = {}): Outcome = when (val located = locate(loading)) {
        is Located.Found -> saveCurrent(located.geoInfo, loading)
        is Located.Failed -> fail(located.message, loading)
    }

    /**
     * `updateCurrentPosition` of StartCtrl and SearchCtrl: the permission and the location service decide
     * ([StartLocation]); a fix, rounded to three decimals, is geocoded (`/coord`). A grant from the prompt runs it again
     * at once. [loading] shows the overlay at each attempt and hides it before the prompt while location services are
     * on; the caller hides it at the end.
     */
    suspend fun locate(loading: (Boolean) -> Unit = {}): Located {
        while (true) {
            loading(true)
            val enabled = location.enabled()
            val status = location.status()
            recorded = status
            // `trackEvent('position', 'status', 'authorized', isLocationAuthorized ? 1 : 0)`: requestable and location off are denied.
            val authorized = enabled && PermissionClass.of(status) == PermissionClass.GRANTED
            telemetry.track("location_permission", mapOf("outcome" to if (authorized) "granted" else "denied"))
            val message: LocationMessage = when (val step = StartLocation.decide(enabled, status)) {
                LocationStep.Locate -> {
                    val fix = location.position()
                    if (fix == null) {
                        LocationMessage.NOT_FOUND
                    } else {
                        val (lat, long) = GeoLocation.normalize(fix.lat, fix.long)
                        val geoInfo = geocode.byLocation(Location(lat, long), languages()) ?: return Located.Failed(LocationMessage.NO_INFORMATION)
                        return Located.Found(geoInfo)
                    }
                }
                is LocationStep.Ask -> {
                    if (step.hideLoading) loading(false)
                    val answer = location.request()
                    recorded = answer
                    StartLocation.afterPrompt(PermissionClass.of(answer) == PermissionClass.GRANTED) ?: continue
                }
                is LocationStep.Fail -> step.message
                // TabCtrl's steps do not occur on S01.
                LocationStep.UseSaved, LocationStep.AskHighAccuracy -> LocationMessage.NOT_FOUND
            }
            return Located.Failed(message)
        }
    }

    private fun fail(message: LocationMessage, loading: (Boolean) -> Unit): Outcome {
        loading(false)
        return Outcome.Confirm(StartLocation.retry(message, recorded, location.enabled()))
    }

    /**
     * The geocoded position's weather; then `disableCity(false)` and `saveCity(…, true)`: the place at the selected index
     * takes the geocode's name, address, country and location (a current position) and the weather's source. A failed
     * request leaves the current position disabled; a body that does not convert disables it again.
     */
    private suspend fun saveCurrent(geoInfo: JsonObject, loading: (Boolean) -> Unit): Outcome {
        val place = GeocodeClient.place(geoInfo, currentPosition = true)
        val s = state.current() ?: return Outcome.None
        val result = repository.load(place, s.units, languages(), force = true)
        loading(false)
        return when (result) {
            is LoadResult.Loaded -> {
                val source = source(result.entry.weather)
                var updated = -1
                state.change { current ->
                    val enabled = PlaceList.disableCurrent(current, false)
                    updated = enabled.placeIndex
                    enabled.copy(places = enabled.places.mapIndexed { i, p -> if (i == enabled.placeIndex) updateCity(p, place, source) else p }).closeStart()
                }
                if (updated >= 0) cityUpdated(updated)
                Outcome.Added
            }
            is LoadResult.Failed -> {
                if (result.unconvertible) {
                    state.change { PlaceList.disableCurrent(PlaceList.disableCurrent(it, false), true) }
                    Outcome.Alert(ALREADY_ADDED)
                } else {
                    Outcome.Alert(FAILED_WEATHER)
                }
            }
            LoadResult.Skipped, LoadResult.Superseded -> Outcome.None
        }
    }

    companion object {
        const val ALREADY_ADDED = "LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED"
        const val FAILED_WEATHER = "LOC_FAIL_TO_GET_WEATHER_INFO"

        private fun source(weather: JsonObject): String? = (weather["source"] as? JsonPrimitive)?.takeIf { WeatherRepository.truthy(it) }?.content

        /**
         * `updateCity(index, city)` with the geocoded [city]: a current position takes its truthy name, country, address
         * and location; another place only a location it lacks (#1971). Both take a truthy source.
         */
        internal fun updateCity(place: Place, city: Place, source: String?): Place {
            val withSource = place.copy(source = source ?: place.source)
            if (place.currentPosition) {
                return withSource.copy(
                    name = city.name?.ifEmpty { null } ?: place.name,
                    country = city.country?.ifEmpty { null } ?: place.country,
                    address = city.address?.ifEmpty { null } ?: place.address,
                    location = city.location ?: place.location,
                )
            }
            val own = place.location
            val found = city.location
            return if ((own == null || own.lat == 0.0) && found != null && found.lat != 0.0) withSource.copy(location = found) else withSource
        }

    }
}
