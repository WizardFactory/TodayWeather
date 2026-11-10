package net.wizardfactory.todayweather.ui.start

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.domain.start.CityShortcut
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.search.Prediction

/**
 * One visit of the start page (StartCtrl, #2889), kept across configuration changes while the app is open; a new app
 * open is a new visit. It shows the access notice O01 when it starts, runs the adds of [flow] one at a time behind the
 * loading overlay (`$ionicLoading`) and keeps the popup the last one ended in: O09's alert or O04's confirmation.
 */
class StartPage(private val flow: StartFlow, private val scope: CoroutineScope) {
    private val noticeOpen = MutableStateFlow(true)
    private val loadingNow = MutableStateFlow(false)
    private val popupNow = MutableStateFlow<StartFlow.Outcome?>(null)
    private var job: Job? = null

    /** O01, which `init` opens on every entry and its OK closes. */
    val notice: StateFlow<Boolean> = noticeOpen.asStateFlow()

    /** The loading overlay. */
    val loading: StateFlow<Boolean> = loadingNow.asStateFlow()

    /** O09 ([StartFlow.Outcome.Alert]) or O04 ([StartFlow.Outcome.Confirm]). */
    val popup: StateFlow<StartFlow.Outcome?> = popupNow.asStateFlow()

    fun closeNotice() {
        noticeOpen.value = false
    }

    /** O09's OK, O04's Close or Android back. */
    fun closePopup() {
        popupNow.value = null
    }

    /** `OnGetWeather(index)`. */
    fun addShortcut(shortcut: CityShortcut) = run { flow.addShortcut(shortcut) }

    /** `OnSelectResult` of a prediction, named from the [word] typed for it. */
    fun addPrediction(prediction: Prediction, word: String) = run { flow.addPrediction(prediction.fullText, prediction.firstMatch, word) }

    /** `OnSelectResult` of a bundled town. */
    fun addTown(town: Town) = run { flow.addTown(town) }

    /** 현재위치 날씨보기 (`OnUseLocationService`): the flow shows and hides the overlay itself. */
    fun useCurrentLocation() {
        if (job?.isActive == true) return
        job = scope.launch { show(flow.useCurrentLocation { loadingNow.value = it }) }
    }

    /** An O04 button: it closes the popup, then opens the settings it names or tries again. */
    fun retryButton(button: RetryButton, openAppSettings: () -> Unit, openLocationSettings: () -> Unit) {
        popupNow.value = null
        when (button) {
            RetryButton.APP_SETTINGS -> openAppSettings()
            RetryButton.LOCATION_SETTINGS -> openLocationSettings()
            RetryButton.RETRY -> useCurrentLocation()
            RetryButton.CLOSE, RetryButton.SEARCH -> {}
        }
    }

    private fun run(add: suspend () -> StartFlow.Outcome) {
        if (job?.isActive == true) return
        job = scope.launch {
            loadingNow.value = true
            val outcome = try {
                add()
            } finally {
                loadingNow.value = false
            }
            show(outcome)
        }
    }

    private fun show(outcome: StartFlow.Outcome) {
        if (outcome is StartFlow.Outcome.Alert || outcome is StartFlow.Outcome.Confirm) popupNow.value = outcome
    }
}
