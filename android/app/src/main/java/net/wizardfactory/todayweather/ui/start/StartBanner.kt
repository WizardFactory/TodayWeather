package net.wizardfactory.todayweather.ui.start

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.startShows

/**
 * The banner around the start page (StartCtrl's `setShowAds(false)` and `close()`'s `setShowAds(true)`): when the first
 * saved state of [states] shows S01, the banner is hidden until a state without it, then shown again. Returns that first
 * state without S01, after which the tabs' loading starts (TabCtrl `init`).
 */
suspend fun hideBannerWhileStartShows(states: Flow<AppState?>, setShowAds: (Boolean) -> Unit): AppState {
    val first = states.first { it != null }!!
    if (!first.startShows) return first
    setShowAds(false)
    return states.first { it != null && !it.startShows }!!.also { setShowAds(true) }
}
