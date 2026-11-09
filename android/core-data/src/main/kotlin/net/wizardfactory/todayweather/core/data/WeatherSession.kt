package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos
import net.wizardfactory.todayweather.core.storage.AppState

/** The saved state the weather pages read and change: [change] applies at once and is saved. */
interface StateAccess {
    fun current(): AppState?
    fun change(update: (AppState) -> AppState)
}

/**
 * The loading of the weather pages (TabCtrl in controller.tabctrl.js, #2887): `loadWeatherData` with the ten-minute
 * gate and the refresh timer, the `reloadEvent` senders, the swipes between places and the retry confirmation (O03).
 * A response applies to the place that requested it (the A01 fix, [WeatherRepository]); what it changes in the place
 * (`updateCity`) and a photo for it are saved. The current position's own lookup is AN-10's: here it loads as saved.
 */
class WeatherSession(
    private val repository: WeatherRepository,
    private val scope: CoroutineScope,
    private val state: StateAccess,
    private val languages: () -> List<String>,
    private val photos: () -> WeatherPhotos?,
    /** Loads the photo feed (`loadWeatherPhotos`), which a weather update without it asks for. */
    private val loadPhotos: () -> Unit = {},
    private val random: () -> Double = Math::random,
) {
    /** Who asks for a reload (`reloadEvent` senders). */
    enum class Sender {
        /** The app opened (TabCtrl `init`). */
        INIT,

        /** The selected Hourly, Daily or Air tab was tapped again. */
        TAB,

        /** The app came back to the foreground; gated. */
        RESUME,

        /** Back from the place search (AN-10); gated. */
        SEARCH,

        /** The refresh interval passed. */
        TIMER,

        /** The retry confirmation's OK. */
        RETRY,

        /** The refresh interval setting changed (AN-12): only the timer restarts. */
        REFRESH_INTERVAL,
    }

    private val retryShown = MutableStateFlow(false)
    private val applyEvents = MutableStateFlow(0)
    private var timer: Job? = null

    /** The retry confirmation is open (`LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, `LOC_CLOSE` and `LOC_OK`). */
    val retry: StateFlow<Boolean> = retryShown.asStateFlow()

    /**
     * TabCtrl's `applyEvent`s so far: one at each `loadWeatherData` (also when the gate stops the load) and one after
     * each applied response. S05 returns to its first station on each.
     */
    val applies: StateFlow<Int> = applyEvents.asStateFlow()

    /** `reloadEvent`: ignored while the retry confirmation is open; a resume or a return from search waits for the gate. */
    fun reload(sender: Sender) {
        if (retryShown.value) return
        val s = state.current() ?: return
        val place = s.places.getOrNull(s.placeIndex) ?: return
        when (sender) {
            Sender.RESUME, Sender.SEARCH -> if (!repository.canLoad(place)) return
            Sender.REFRESH_INTERVAL -> {
                restartTimer(s)
                return
            }
            else -> {}
        }
        repository.invalidate(place)
        loadWeatherData()
    }

    /**
     * A choice on S08 (`RadioCtrl.valueChanged` then `_resetUpdateTimeCities`, #2891): every place may load again
     * (`reloadCity`), then the selected one loads unless the retry confirmation is open (`reloadEvent` "resume").
     */
    fun settingChanged() {
        repository.invalidateAll()
        reload(Sender.RESUME)
    }

    /** `onSwipeLeft` (the header swiped left, or its right arrow): the next place, then a gated load. */
    fun next() = move(PlaceIndex::next)

    /** `onSwipeRight` (the header swiped right, or its left arrow): the previous place, then a gated load. */
    fun previous() = move(PlaceIndex::previous)

    /** The retry confirmation's close button. */
    fun closeRetry() {
        retryShown.value = false
    }

    /** The retry confirmation's OK: a forced reload once it has closed (`$timeout` in `showRetryConfirm`). */
    fun confirmRetry() {
        retryShown.value = false
        scope.launch { reload(Sender.RETRY) }
    }

    /** The photo feed arrived (`loadWeatherPhotos`): each place without a photo gets one for its cached weather. */
    suspend fun photosLoaded() {
        val feed = photos() ?: return
        val s = state.current() ?: return
        val chosen = s.places.mapIndexedNotNull { i, place ->
            if (place.photo != null) return@mapIndexedNotNull null
            val photo = photoFor(repository.cached(place)?.weather, feed) ?: return@mapIndexedNotNull null
            i to (WeatherRepository.key(place) to photo)
        }
        if (chosen.isEmpty()) return
        state.change { st ->
            st.copy(places = st.places.mapIndexed { i, place ->
                chosen.firstOrNull { it.first == i && WeatherRepository.key(place) == it.second.first }?.let { place.copy(photo = it.second.second) } ?: place
            })
        }
    }

    private fun move(step: (List<Boolean>, Int) -> Int) {
        val s = state.current() ?: return
        val disabled = s.places.map { it.disable }
        if (PlaceIndex.enabledCount(disabled) == 1) return
        val index = step(disabled, s.placeIndex)
        if (index != s.placeIndex) state.change { it.copy(placeIndex = index) }
        loadWeatherData()
    }

    /** `loadWeatherData`: restarts the timer and fires `applyEvent`, then loads the selected place unless the gate stops it. */
    private fun loadWeatherData() {
        val s = state.current() ?: return
        restartTimer(s)
        applyEvents.update { it + 1 }
        val place = s.places.getOrNull(s.placeIndex) ?: return
        if (!repository.canLoad(place)) return
        val units = s.units
        scope.launch {
            when (val result = repository.load(place, units, languages(), force = false)) {
                is LoadResult.Loaded -> save(result)
                is LoadResult.Failed -> retryShown.value = true
                LoadResult.Skipped, LoadResult.Superseded -> {}
            }
        }
    }

    /** `setRefreshTimer`: a reload after the interval in minutes, none for "0" (manual). */
    private fun restartTimer(s: AppState) {
        timer?.cancel()
        val minutes = s.settings.refreshInterval.toLongOrNull() ?: 0
        if (minutes <= 0) return
        timer = scope.launch {
            delay(minutes * 60_000)
            reload(Sender.TIMER)
        }
    }

    /**
     * `updateCity`'s changes to the place that requested the weather, and its new photo, wherever it is in the list now,
     * then `applyEvent`. Without the feed the photo is none and the feed loads (`_getPhoto`).
     */
    private suspend fun save(result: LoadResult.Loaded) {
        val feed = photos()
        if (feed == null) loadPhotos()
        val photo = feed?.let { photoFor(result.entry.weather, it) }
        val source = (result.entry.weather["source"] as? JsonPrimitive)?.content
        state.change { s ->
            s.copy(places = s.places.map { place ->
                if (WeatherRepository.key(place) != result.key) place
                else place.copy(
                    name = if (place.currentPosition) result.place.name else place.name,
                    country = if (place.currentPosition) result.place.country else place.country,
                    address = if (place.currentPosition) result.place.address else place.address,
                    location = result.place.location,
                    source = source ?: place.source,
                    photo = photo,
                )
            })
        }
        applyEvents.update { it + 1 }
    }

    /** `findWeatherPhoto(currentWeather)`. */
    private fun photoFor(weather: JsonObject?, feed: WeatherPhotos): String? {
        val sky = ((weather?.get("currentWeather") as? JsonObject)?.get("skyIcon") as? JsonPrimitive)?.content
        return feed.find(sky, random())
    }
}
