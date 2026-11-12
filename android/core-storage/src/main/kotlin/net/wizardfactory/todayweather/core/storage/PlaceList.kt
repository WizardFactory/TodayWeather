package net.wizardfactory.todayweather.core.storage

import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.start.StartGate

/** WeatherInfo's list operations that the start page and the saved places use (service.weatherinfo.js). */
object PlaceList {
    /**
     * `getIndexOfCity`: the current position matches the current position; another place matches a saved place with the
     * same address and the same name, or with the same address when neither has a name. −1 when none matches.
     */
    fun indexOf(places: List<Place>, city: Place): Int = places.indexOfFirst { place ->
        if (place.currentPosition) city.currentPosition
        else place.address == city.address && (if (city.name.isNullOrEmpty() && place.name.isNullOrEmpty()) true else city.name == place.name)
    }

    /** `addCity`: [city] appended and enabled unless a place matches it ([indexOf]); null when one does. */
    fun add(state: AppState, city: Place): AppState? =
        if (indexOf(state.places, city) != -1) null else state.copy(places = state.places + city.copy(disable = false))

    /**
     * `removeCity(index)`: the place at [index] removed (never the current position, which S02 offers no delete for);
     * the selection moves to the first enabled place only when it now equals the number of places
     * (`setFirstCityIndex`, which keeps it when none is enabled), so deleting an earlier place keeps the selected
     * number, now naming the next place (kept, AN-06).
     */
    fun remove(state: AppState, index: Int): AppState {
        if (index !in state.places.indices) return state
        val places = state.places.filterIndexed { i, _ -> i != index }
        val selected = if (state.placeIndex == places.size) PlaceIndex.first(places.map { it.disable }, state.placeIndex) else state.placeIndex
        return state.copy(places = places, placeIndex = selected)
    }

    /** `disableCity(disable)`: the current position's flag, then `setFirstCityIndex` while the index is at most 0. */
    fun disableCurrent(state: AppState, disable: Boolean): AppState {
        if (state.places.isEmpty()) return state
        val places = state.places.mapIndexed { i, p -> if (i == 0) p.copy(disable = disable) else p }
        val index = if (state.placeIndex <= 0) PlaceIndex.first(places.map { it.disable }, state.placeIndex) else state.placeIndex
        return state.copy(places = places, placeIndex = index)
    }
}

/** The startup gate (app.js): S01 shows while the stored `startVersion` is missing or below 1. */
val AppState.startShows: Boolean get() = StartGate.shows(cordovaExtras["startVersion"])

/**
 * StartCtrl's `close()`: `startVersion` stored, where the rollback hand-back (AN-17) also gives it back to the Cordova
 * app, and the last place selected (`setCityIndex(getCityCount() - 1)`).
 */
fun AppState.closeStart(): AppState =
    copy(cordovaExtras = cordovaExtras + ("startVersion" to StartGate.CLOSED), placeIndex = places.size - 1)
