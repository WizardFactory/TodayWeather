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
import net.wizardfactory.todayweather.core.domain.GeoLocation
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos
import net.wizardfactory.todayweather.core.domain.start.LocationMessage
import net.wizardfactory.todayweather.core.domain.start.LocationStep
import net.wizardfactory.todayweather.core.domain.start.PermissionClass
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.core.domain.start.TabLocation
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList

/** The saved state the weather pages read and change: [change] applies at once and is saved. */
interface StateAccess {
    fun current(): AppState?
    fun change(update: (AppState) -> AppState)
}

/**
 * The loading of the weather pages (TabCtrl in controller.tabctrl.js, #2887): `loadWeatherData` with the ten-minute
 * gate and the refresh timer, the `reloadEvent` senders, the swipes between places and the retry confirmation (O03).
 * A response applies to the place that requested it (the A01 fix, [WeatherRepository]); what it changes in the place
 * (`updateCity`) and a photo for it are saved, and its push records follow ([cityUpdated]). Each load of the current
 * position also looks it up ([location], AN-10): a new position updates it and loads again; failures open O03's
 * position variants ([positionRetry]). With no enabled place the weather pages ask how to start (O02, [startPopup]).
 */
class WeatherSession(
    private val repository: WeatherRepository,
    private val scope: CoroutineScope,
    private val state: StateAccess,
    private val languages: () -> List<String>,
    private val photos: () -> WeatherPhotos?,
    /** Loads the photo feed (`loadWeatherPhotos`), which a weather update without it asks for. */
    private val loadPhotos: () -> Unit = {},
    /** `weather_load`, as `updateWeatherData` reports each load. */
    private val telemetry: Telemetry = Telemetry.NONE,
    private val clock: () -> Long = System::currentTimeMillis,
    private val random: () -> Double = Math::random,
    /** The device's location for the current position's own lookup; without it the current position loads as saved. */
    private val location: LocationAccess? = null,
    /** `window.updateCityInfo(index)`, which `updateCity` calls after each update of a place. */
    private val cityUpdated: (Int) -> Unit = {},
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

        /** An entry link selected a place (`todayweather://N`, AN-16). */
        DEEPLINK,

        /** O02 chose the current position (`startPopup`); loads at once. */
        START_POPUP,

        /** Location services turned on (`locationOn`): only a selected current position loads, at once. */
        LOCATION_ON,
    }

    private val retryShown = MutableStateFlow(false)
    private val positionConfirm = MutableStateFlow<RetryConfirm?>(null)
    private val startPopupShown = MutableStateFlow(false)

    // `data.autoSearch`: whether location services were on when the weather pages opened (TabCtrl `init`).
    private val autoSearchValue = MutableStateFlow(location?.enabled() ?: false)
    private val locatingNow = MutableStateFlow(false)
    private val applyEvents = MutableStateFlow(0)
    private var timer: Job? = null

    /** TabCtrl's `gLocationAuthorizationStatus`: the status the lookup read or the prompt answered last in this app open. */
    private var recorded: PermissionStatus? = null

    /** O03 of type `forecast`: a failed lookup of the current position, with its variant's buttons. */
    val positionRetry: StateFlow<RetryConfirm?> = positionConfirm.asStateFlow()

    /** O02 is open (`startPopup`). */
    val startPopup: StateFlow<Boolean> = startPopupShown.asStateFlow()

    /** O02's radio value, kept for its next opening in this app open. */
    val autoSearch: StateFlow<Boolean> = autoSearchValue.asStateFlow()

    /** The current position's lookup runs (TabCtrl's loading indicator for the current position). */
    val locating: StateFlow<Boolean> = locatingNow.asStateFlow()

    /** The retry confirmation is open (`LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, `LOC_CLOSE` and `LOC_OK`). */
    val retry: StateFlow<Boolean> = retryShown.asStateFlow()

    /**
     * TabCtrl's `applyEvent`s so far: one at each `loadWeatherData` (also when the gate stops the load) and one after
     * each applied response. S05 returns to its first station on each.
     */
    val applies: StateFlow<Int> = applyEvents.asStateFlow()

    /**
     * `reloadEvent`: ignored while a retry confirmation is open; a resume or a return from search waits for the gate,
     * `locationOn` reloads only the current position.
     */
    fun reload(sender: Sender) {
        if (retryShown.value || positionConfirm.value != null) return
        val s = state.current() ?: return
        val place = s.places.getOrNull(s.placeIndex) ?: return
        when (sender) {
            Sender.RESUME, Sender.SEARCH -> if (!repository.canLoad(place)) return
            Sender.LOCATION_ON -> if (!place.currentPosition) return
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
     * `branchInit` for `todayweather://N` (A20): `setCityIndex` selects [index] when it is within the places, then
     * `reloadEvent 'deeplink'` loads the selected place at once, unless the retry confirmation is open. The page shown
     * stays.
     */
    fun openPlace(index: Double) {
        val s = state.current() ?: return
        if (index >= 0 && index < s.places.size) state.change { it.copy(placeIndex = index.toInt()) }
        reload(Sender.DEEPLINK)
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

    /** O03 `forecast`'s Close, or its Settings: the confirmation closes. */
    fun closePositionRetry() {
        positionConfirm.value = null
    }

    /** O03 `forecast`'s OK: `reloadEvent 'retryPopup'` once it has closed. */
    fun confirmPositionRetry() {
        positionConfirm.value = null
        scope.launch { reload(Sender.RETRY) }
    }

    /** O03 `forecast`'s Search: `disableCity(true)`; the app opens the Locations tab. */
    fun searchInsteadOfPosition() {
        positionConfirm.value = null
        state.change { PlaceList.disableCurrent(it, true) }
    }

    /**
     * `startPopup()`: O02 asks how to start, opened with no enabled place by a weather page, a tap on a weather or Air
     * tab (`doTabForecast`) or a share without a location (`doTabShare`).
     */
    fun openStartPopup() {
        startPopupShown.value = true
    }

    /** O02's radio rows. */
    fun chooseAutoSearch(value: Boolean) {
        autoSearchValue.value = value
    }

    /**
     * O02's OK or Android back: it closes, and the answer (OK's `data.autoSearch`, back's none) true enables the current
     * position (`disableCity(false)`) and loads it (`reloadEvent 'startPopup'`); otherwise the places stay as they are
     * for the Locations tab. Returns the answer.
     */
    fun startChoice(ok: Boolean): Boolean {
        startPopupShown.value = false
        val currentPosition = ok && autoSearchValue.value
        if (!currentPosition) return false
        state.change { PlaceList.disableCurrent(it, false) }
        reload(Sender.START_POPUP)
        return true
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
            val started = clock()
            val result = repository.load(place, units, languages(), force = false)
            // An answer a later request replaced applies nowhere, so it is no load.
            val outcome = when (result) {
                is LoadResult.Loaded -> "success"
                is LoadResult.Failed -> if (result.network) "network_error" else "invalid_response"
                LoadResult.Skipped, LoadResult.Superseded -> null
            }
            outcome?.let { telemetry.track("weather_load", mapOf("outcome" to it, "duration_ms" to clock() - started)) }
            when (result) {
                is LoadResult.Loaded -> save(result)
                is LoadResult.Failed -> {
                    // One confirmation at a time: a new one closes the open one (`showRetryConfirm`).
                    positionConfirm.value = null
                    retryShown.value = true
                }
                LoadResult.Skipped, LoadResult.Superseded -> {}
            }
        }
        // After the saved place's request, as TabCtrl started them.
        if (place.currentPosition) lookupCurrentPosition(place)
    }

    /**
     * `updateCurrentPosition` with its follow-up in `loadWeatherData` (controller.tabctrl.js L870-L915, L954-L1088): a
     * lookup runs beside the load of the saved current position, one at a time (a second call was `alreadyCalled`, which
     * settles silently). A fix, rounded to three decimals, that differs from the saved location replaces it; while the
     * current position is still selected, its weather loads for the new location. Failures open O03 `forecast`.
     */
    private fun lookupCurrentPosition(place: Place) {
        val access = location ?: return
        if (locatingNow.value) return
        locatingNow.value = true
        scope.launch {
            try {
                val enabled = access.enabled()
                val status = if (enabled) access.status().also { recorded = it } else PermissionStatus.NOT_REQUESTED
                val authorized = enabled && PermissionClass.of(status) == PermissionClass.GRANTED
                telemetry.track("location_permission", mapOf("outcome" to if (authorized) "granted" else "denied"))
                val hasSaved = place.address != null || place.location != null
                val message: LocationMessage? = when (val step = TabLocation.decide(enabled, status, hasSaved)) {
                    LocationStep.Locate -> {
                        val fix = access.position()
                        if (fix == null) {
                            LocationMessage.NOT_FOUND
                        } else {
                            val (lat, long) = GeoLocation.normalize(fix.lat, fix.long)
                            moved(Location(lat, long))
                            null
                        }
                    }
                    is LocationStep.Ask -> access.request().let { answer ->
                        recorded = answer
                        TabLocation.afterPrompt(PermissionClass.of(answer) == PermissionClass.GRANTED)
                    }
                    is LocationStep.Fail -> step.message
                    LocationStep.UseSaved -> null
                    LocationStep.AskHighAccuracy -> TabLocation.afterHighAccuracy(access.requestHighAccuracy())
                }
                if (message != null) {
                    retryShown.value = false
                    positionConfirm.value = TabLocation.retry(message, recorded, access.enabled())
                }
            } finally {
                locatingNow.value = false
            }
        }
    }

    /** A fix for the current position: the same location ends it; a new one is saved and, while selected, loaded. */
    private suspend fun moved(fix: Location) {
        val s = state.current() ?: return
        val current = s.places.getOrNull(0)?.takeIf { it.currentPosition } ?: return
        if (current.location != null) {
            if (current.location == fix) return
            state.change { st -> st.copy(places = st.places.mapIndexed { i, p -> if (i == 0) p.copy(location = fix) else p }) }
        }
        val now = state.current() ?: return
        if (now.placeIndex != 0) return
        // `updateWeatherData({location})`: failures are silent.
        val result = repository.load(now.places[0].copy(location = fix), now.units, languages(), force = true)
        if (result is LoadResult.Loaded) save(result)
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
        // The places the response belongs to, before it may give one of them a new key (coordinates it lacked).
        val updated = state.current()?.places?.withIndex()?.filter { WeatherRepository.key(it.value) == result.key }?.map { it.index }.orEmpty()
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
        updated.forEach(cityUpdated)
        applyEvents.update { it + 1 }
    }

    /** `findWeatherPhoto(currentWeather)`. */
    private fun photoFor(weather: JsonObject?, feed: WeatherPhotos): String? {
        val sky = ((weather?.get("currentWeather") as? JsonObject)?.get("skyIcon") as? JsonPrimitive)?.content
        return feed.find(sky, random())
    }
}
