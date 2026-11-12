package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import net.wizardfactory.todayweather.core.domain.places.SearchLocation
import net.wizardfactory.todayweather.core.domain.places.SearchQuery
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList

/**
 * One visit of the saved places S02 (SearchCtrl, #2890), new each time the Locations tab opens (`cache: false`):
 * - [open]: the bells of the visit (`hasPush`, read once), the stored weather, then each enabled place loads in turn
 *   through the ten-minute gate, failures silent (`updateCityEvent`); an enabled current position also looks itself up,
 *   throws the position away and loads again with its stored location;
 * - [delete] and [setCurrentPosition]: with the row's bell on, the place's alarms go first (`DELETE /push`, no other
 *   record renumbered, A24); turning the current position on the first time, while it has no temperature, finds it,
 *   names it from the geocode and loads it, a weather failure silent;
 * - [findByLocation] and the adds of a search result, one at a time behind the overlay; an add selects the new place
 *   ([added]); failures end in O09 or O03 of type `search` ([popup]), whose OK finds by location again (A26).
 */
class PlacesPage(
    private val state: StateAccess,
    private val repository: WeatherRepository,
    private val session: WeatherSession,
    private val flow: StartFlow,
    private val location: LocationAccess,
    private val scope: CoroutineScope,
    /** `Push.removePushListByCityIndex(index)`. */
    private val removeAlarms: suspend (Int) -> Unit,
    /** `window.updateCityInfo(index)`, after the geocode renames the current position. */
    private val cityUpdated: (Int) -> Unit = {},
    private val telemetry: Telemetry = Telemetry.NONE,
) {
    private val bells = MutableStateFlow<List<Boolean>>(emptyList())
    private val loadingNow = MutableStateFlow(false)
    private val popupNow = MutableStateFlow<StartFlow.Outcome?>(null)
    private val foundNow = MutableStateFlow<JsonObject?>(null)
    private val addedNow = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private var job: Job? = null

    /** Each row's bell as the visit opened (`Push.hasPushInfo`, not read again). */
    val hasPush: StateFlow<List<Boolean>> = bells.asStateFlow()

    /** The loading overlay. */
    val loading: StateFlow<Boolean> = loadingNow.asStateFlow()

    /** O09 ([StartFlow.Outcome.Alert]) or O03 `search` ([StartFlow.Outcome.Confirm]). */
    val popup: StateFlow<StartFlow.Outcome?> = popupNow.asStateFlow()

    /** The geocoded position find-by-location gave, its result row. */
    val found: StateFlow<JsonObject?> = foundNow.asStateFlow()

    /** A search result was added and selected (`goPage()` follows). */
    val added: SharedFlow<Unit> = addedNow.asSharedFlow()

    fun open() {
        val s = state.current() ?: return
        bells.value = s.places.indices.map { hasAlarm(s, it) }
        scope.launch {
            s.places.forEach { repository.cached(it) }
            var i = 0
            while (true) {
                val place = state.current()?.places?.getOrNull(i) ?: break
                if (!place.disable) session.refresh(place)
                i++
            }
        }
        val current = s.places.firstOrNull()
        if (current != null && current.currentPosition && !current.disable) {
            scope.launch {
                if (flow.locate() is StartFlow.Located.Found) state.current()?.places?.firstOrNull()?.let { session.refresh(it, force = true) }
            }
        }
    }

    /** `OnDeleteCity(index)`: no confirmation; never the current position. */
    fun delete(index: Int) {
        val s = state.current() ?: return
        if (s.places.getOrNull(index)?.currentPosition != false) return
        if (bells.value.getOrElse(index) { false }) scope.launch { removeAlarms(index) }
        bells.value = bells.value.filterIndexed { i, _ -> i != index }
        state.change { PlaceList.remove(it, index) }
        telemetry.track("favorite_change", mapOf("action" to "remove"))
    }

    /** `OnDisableCity`: the current position's switch. */
    fun setCurrentPosition(on: Boolean) {
        val s = state.current() ?: return
        val current = s.places.firstOrNull()?.takeIf { it.currentPosition } ?: return
        state.change { PlaceList.disableCurrent(it, !on) }
        if (!on) {
            if (bells.value.firstOrNull() == true) scope.launch { removeAlarms(0) }
        } else if (!hasTemperature(current)) {
            perform {
                when (val located = flow.locate { loadingNow.value = it }) {
                    is StartFlow.Located.Found -> {
                        val geo = GeocodeClient.place(located.geoInfo, currentPosition = true)
                        state.change { st -> st.copy(places = st.places.mapIndexed { i, p -> if (i == 0) StartFlow.updateCity(p, geo, null) else p }) }
                        cityUpdated(0)
                        state.current()?.places?.firstOrNull()?.let { session.refresh(it, force = true) }
                    }
                    is StartFlow.Located.Failed -> confirm(located)
                }
            }
        }
    }

    /** `OnSearchCurrentPosition`: the geocoded position as a result row, or O03 `search`. */
    fun findByLocation() = perform {
        when (val located = flow.locate { loadingNow.value = it }) {
            is StartFlow.Located.Found -> foundNow.value = located.geoInfo
            is StartFlow.Located.Failed -> confirm(located)
        }
    }

    /** A bundled town (`OnSelectResult`). */
    fun addTown(town: Town) = perform { finish(flow.addTown(town)) }

    /** A Places prediction, geocoded by its terms joined with commas. */
    fun addPrediction(fullText: String, firstMatch: Int?, word: String) =
        perform { finish(flow.addPrediction(fullText, firstMatch, word, SearchQuery.of(fullText))) }

    /** The find-by-location row. */
    fun addFound() {
        val geoInfo = foundNow.value ?: return
        foundNow.value = null
        perform { finish(flow.addGeoInfo(geoInfo)) }
    }

    /** The search was cleared (Cancel, Edit, a new word): the find-by-location row goes too. */
    fun clearFound() {
        foundNow.value = null
    }

    fun closePopup() {
        popupNow.value = null
    }

    /** An O03 `search` button: it closes the popup, then opens the settings it names or finds by location again. */
    fun retryButton(button: RetryButton, openAppSettings: () -> Unit, openLocationSettings: () -> Unit) {
        popupNow.value = null
        when (button) {
            RetryButton.APP_SETTINGS -> openAppSettings()
            RetryButton.LOCATION_SETTINGS -> openLocationSettings()
            RetryButton.RETRY -> findByLocation()
            RetryButton.CLOSE, RetryButton.SEARCH -> {}
        }
    }

    private fun confirm(failed: StartFlow.Located.Failed) {
        popupNow.value = StartFlow.Outcome.Confirm(SearchLocation.retry(failed.message, flow.recorded, location.enabled()))
    }

    private fun finish(outcome: StartFlow.Outcome) {
        when (outcome) {
            StartFlow.Outcome.Added -> addedNow.tryEmit(Unit)
            is StartFlow.Outcome.Alert, is StartFlow.Outcome.Confirm -> popupNow.value = outcome
            StartFlow.Outcome.None -> {}
        }
    }

    /** One action at a time, behind the overlay. */
    private fun perform(action: suspend () -> Unit) {
        if (job?.isActive == true) return
        job = scope.launch {
            loadingNow.value = true
            try {
                action()
            } finally {
                loadingNow.value = false
            }
        }
    }

    private fun hasTemperature(place: Place): Boolean {
        val current = repository.weather.value[WeatherRepository.key(place)]?.weather?.get("currentWeather") as? JsonObject
        val t1h = current?.get("t1h")
        return t1h != null && !(t1h is JsonPrimitive && t1h.isString && t1h.content == "-")
    }

    private companion object {
        /** `Push.hasPushInfo(index)`: an enabled record naming the index. */
        fun hasAlarm(state: AppState, index: Int): Boolean = state.push.records.any { r ->
            (r["cityIndex"] as? JsonPrimitive)?.intOrNull == index && (r["enable"] as? JsonPrimitive)?.content == "true"
        }
    }
}
