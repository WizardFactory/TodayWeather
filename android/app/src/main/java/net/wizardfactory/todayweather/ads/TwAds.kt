package net.wizardfactory.todayweather.ads

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.core.domain.ads.BannerGate
import net.wizardfactory.todayweather.core.domain.ads.BannerInputs

/** One banner of the current activity (the AdMob plugin's banner view). */
interface BannerAdapter {
    /** Loads a banner without showing it: [onLoaded] or [onFailed], once, unless [destroy] runs first. */
    fun create(onLoaded: () -> Unit, onFailed: () -> Unit)

    fun destroy()
}

/**
 * The anchored banner of an app open (TwAds with the emi adapter, wired back by #3211): it is requested only while it is
 * eligible: the Ads SDK has started and consent permits requests ([setPermitted]; [onSdkReady] is the first permit), the
 * Remote Config policy is final, and both `tw_banner_enabled` (every format) and `tw_app_banner_enabled` (this format)
 * are on. It shows when [BannerGate] allows (the delay); a page can hide it ([setShowAds]). When it stops being
 * eligible the banner is hidden and destroyed, and a later eligibility loads a new one. Loads are at least 5 s
 * apart. The banner belongs to the activity ([attach]), so a configuration change destroys it and loads a new one at
 * the new width, as the orientation change did. [shown] tells the layout to show it. `ad_lifecycle` show and hide and
 * the one `ad_policy_exposure` go to [track].
 */
class TwAds(
    private val scope: CoroutineScope,
    private val config: RemoteBannerConfig,
    private val track: (String, Map<String, Any?>) -> Boolean,
    private val clock: () -> Long,
) {
    private val sessionStart = clock()
    private var ready = false
    private var enableAds: Boolean? = null
    private var requestShow: Boolean? = null
    private var bannerLoaded = false
    private var exposed = false
    private var showAds: Boolean? = null
    private var permitted = false
    /** A banner was requested (or waits for the spacing) for the current adapter and eligibility. */
    private var requested = false
    private var revision = 0
    private var adapter: BannerAdapter? = null
    private var lastLoadAt: Long? = null
    private var pendingLoad: Job? = null
    private var delayTimer: Job? = null
    private val shownFlow = MutableStateFlow(false)

    /** The banner is in the layout (the plugin's `showBannerAd`). */
    val shown: StateFlow<Boolean> = shownFlow.asStateFlow()

    init {
        config.load()
        scope.launch { config.policy.collect { update() } }
    }

    /** The Ads SDK started and consent allows requests (`onAdapterReady`). */
    fun onSdkReady() = setPermitted(true)

    /**
     * Consent permits requests now ([AdsConsent.allowed] while no privacy options form is open). False hides and
     * destroys the banner; true after the SDK start loads one when the switches allow.
     */
    fun setPermitted(allowed: Boolean) {
        if (allowed) {
            ready = true
            enableAds = true
        }
        if (permitted == allowed) return
        permitted = allowed
        update()
    }

    private fun eligible(): Boolean {
        val state = config.policy.value
        return enableAds == true && permitted && state.ready && state.policy.enabled && state.appBannerEnabled
    }

    /** Requests a banner when eligible and none is requested; destroys it when no longer eligible. */
    private fun update() {
        if (eligible()) {
            // As `onAdapterReady`: a new request decides the visibility when it has loaded.
            if (!requested) return createBanner()
        } else if (requested) {
            requested = false
            revision++
            pendingLoad?.cancel()
            pendingLoad = null
            bannerLoaded = false
            adapter?.destroy()
        }
        applyVisibility()
    }

    /** The banner of a new activity, or null when the activity is gone; the old banner is destroyed. */
    fun attach(banner: BannerAdapter?) {
        if (banner === adapter) return
        revision++
        pendingLoad?.cancel()
        pendingLoad = null
        adapter?.destroy()
        adapter = banner
        bannerLoaded = false
        requested = false
        applyVisibility()
        update()
    }

    /** The activity of [banner] is gone. */
    fun detach(banner: BannerAdapter) {
        if (adapter === banner) attach(null)
    }

    /** A page asks to show or hide the banner (`setShowAds`). */
    fun setShowAds(show: Boolean) {
        requestShow = show
        if (!ready || (enableAds == false && show)) return
        applyVisibility()
    }

    /** `createBannerView`, at least 5 s after the previous load; a later attach or destroy cancels a waiting one. */
    private fun createBanner() {
        val banner = adapter ?: return
        val run = ++revision
        requested = true
        bannerLoaded = false
        val wait = lastLoadAt?.let { SPACING_MS - (clock() - it) } ?: 0
        val load = {
            pendingLoad = null
            lastLoadAt = clock()
            banner.create(
                onLoaded = {
                    if (run == revision && eligible()) {
                        bannerLoaded = true
                        applyVisibility()
                    }
                },
                onFailed = {},
            )
        }
        if (wait > 0) pendingLoad = scope.launch {
            delay(wait)
            load()
        } else load()
    }

    /** `applyVisibility`. */
    private fun applyVisibility() {
        delayTimer?.cancel()
        delayTimer = null
        val policy = config.policy.value
        // The banner's own switch narrows the all-ads policy: off counts as the kill switch for this format.
        val bannerPolicy = policy.policy.copy(enabled = policy.policy.enabled && policy.appBannerEnabled)
        val decision = BannerGate.decide(BannerInputs(ready, enableAds, requestShow, bannerLoaded, bannerPolicy, policy.ready,
            clock() - sessionStart)) ?: return
        decision.recheckInMs?.let { wait ->
            delayTimer = scope.launch {
                delay(wait)
                applyVisibility()
            }
        }
        if (decision.eligible && !exposed) {
            exposed = true
            track("ad_policy_exposure", mapOf("delay_seconds" to policy.policy.delaySeconds))
        }
        if (showAds == decision.show) return
        showAds = decision.show
        shownFlow.value = decision.show
        track("ad_lifecycle", mapOf("action" to if (decision.show) "show" else "hide", "ad_format" to "banner"))
    }

    companion object {
        /** The plugin's minimum time between banner loads, kept in the adapter (`loadInterval` 0). */
        const val SPACING_MS = 5_000L
    }
}
