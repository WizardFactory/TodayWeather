package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import androidx.annotation.MainThread
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import java.util.Calendar
import java.util.GregorianCalendar
import kotlin.random.Random
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.core.domain.shell.Tab

/** An activity's preloaded forecast ad. Tab taps never wait for an SDK load. */
@MainThread
class ForecastInterstitial internal constructor(
    private val activity: Activity,
    private val unitId: String,
    private val track: (String, Map<String, Any?>) -> Boolean,
    private val request: ForecastAdRequest,
    draw: () -> Double,
    preferenceFile: String = "forecast_interstitial",
    chance: () -> Int = { RemoteBannerConfig.DEFAULT_INTERSTITIAL_CHANCE },
) {
    constructor(activity: Activity, unitId: String, track: (String, Map<String, Any?>) -> Boolean, chance: () -> Int) :
        this(activity, unitId, track, adMobRequest(activity, unitId), Random.Default::nextDouble, chance = chance)
    private val prefs = activity.getSharedPreferences(preferenceFile, Context.MODE_PRIVATE)
    private val visits = ForecastVisits(
        load = {
            ForecastAdDay(prefs.getLong("day", Long.MIN_VALUE), prefs.getBoolean("hourly", false),
                prefs.getBoolean("daily", false), prefs.getBoolean("spent", false))
        },
        save = { day ->
            // commit() is intentional: a process death after show must not reopen the allowance.
            prefs.edit().putLong("day", day.date).putBoolean("hourly", day.hourly)
                .putBoolean("daily", day.daily).putBoolean("spent", day.spent).commit()
        },
        today = {
            val calendar = GregorianCalendar()
            calendar.get(Calendar.YEAR) * 1000L + calendar.get(Calendar.DAY_OF_YEAR)
        },
        draw = draw,
        chance = chance,
    )
    private var enabled = false
    private var destroyed = false
    private var generation = 0
    private var loading = false
    private var loaded: ReadyForecastAd? = null
    private var loadedAt = 0L
    private var lastRequestAt: Long? = null
    private var pending: ForecastTransition? = null

    /** Caller combines SDK readiness, consent and effective format configuration. */
    fun setEnabled(allowed: Boolean) {
        enabled = allowed && !destroyed && unitId.isNotBlank()
        if (enabled) {
            preload()
        } else {
            generation++
            loading = false
            loaded = null
        }
    }

    /** Record displayed tabs including cold starts and programmatic navigation; neither can directly trigger an ad. */
    fun recordVisible(tab: Tab) {
        if (destroyed) return
        visits.visible(tab)
        if (tab == Tab.HOURLY || tab == Tab.DAILY) preload()
    }

    /** Returns true only when this tap was taken over, including duplicate taps during the same presentation. */
    fun handleTap(destination: Tab, navigate: () -> Unit): Boolean {
        if (pending != null) return true
        if (!enabled || activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) return false
        val ad = freshAd() ?: run {
            preload()
            return false
        }
        val date = visits.reserve(destination) ?: return false
        loaded = null
        val transition = ForecastTransition(date, visits, navigate)
        pending = transition
        fun completed(failed: Boolean) {
            if (pending !== transition) return
            pending = null
            transition.finish(failed)
        }
        val callback = object : FullScreenContentCallback() {
            override fun onAdShowedFullScreenContent() {
                transition.displayed()
                lifecycle("show")
            }
            override fun onAdImpression() {
                transition.displayed()
                lifecycle("impression")
            }
            override fun onAdDismissedFullScreenContent() {
                lifecycle("hide")
                completed(false)
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                lifecycle("failed")
                completed(true)
            }
        }
        try {
            ad.show(callback)
        } catch (_: RuntimeException) {
            // A thrown SDK call supplies no confirmed no-display callback. Keep the reservation spent.
            completed(false)
        }
        return true
    }

    fun destroy() {
        destroyed = true
        setEnabled(false)
        pending = null
    }

    private fun freshAd(): ReadyForecastAd? {
        if (SystemClock.elapsedRealtime() - loadedAt >= MAX_AGE_MS) loaded = null
        return loaded
    }

    private fun preload() {
        if (!enabled || loading || pending != null || !visits.available() || freshAd() != null) return
        val now = SystemClock.elapsedRealtime()
        if (lastRequestAt?.let { now - it < MIN_REQUEST_INTERVAL_MS } == true) return
        val requestGeneration = generation
        loading = true
        lastRequestAt = now
        lifecycle("request")
        try {
            request.load(onLoaded = { ad ->
                if (requestGeneration == generation) {
                    loading = false
                    loaded = ad
                    loadedAt = SystemClock.elapsedRealtime()
                    lifecycle("loaded")
                }
            }, onFailed = { code ->
                if (requestGeneration == generation) {
                    loading = false
                    lifecycle("failed")
                    if (code in 0..999) track("ad_load_error", mapOf("ad_format" to "interstitial", "error_code" to code))
                }
            })
        } catch (_: RuntimeException) {
            loading = false
            lifecycle("failed")
        }
    }

    private fun lifecycle(action: String) {
        track("ad_lifecycle", mapOf("action" to action, "ad_format" to "interstitial"))
    }

    private companion object {
        const val MAX_AGE_MS = 55 * 60_000L
        const val MIN_REQUEST_INTERVAL_MS = 60_000L
    }
}

/** A ready SDK creative or its deterministic device-test counterpart. */
internal fun interface ReadyForecastAd {
    fun show(callback: FullScreenContentCallback)
}

internal fun interface ForecastAdRequest {
    fun load(onLoaded: (ReadyForecastAd) -> Unit, onFailed: (Int) -> Unit)
}

private fun adMobRequest(activity: Activity, unitId: String) = ForecastAdRequest { onLoaded, onFailed ->
    InterstitialAd.load(activity, unitId, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
        override fun onAdLoaded(ad: InterstitialAd) = onLoaded(ReadyForecastAd { callback ->
            ad.fullScreenContentCallback = callback
            ad.show(activity)
        })
        override fun onAdFailedToLoad(error: LoadAdError) = onFailed(error.code)
    })
}
