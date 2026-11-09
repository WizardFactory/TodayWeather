package net.wizardfactory.todayweather.core.domain.ads

import java.math.BigInteger

/** The banner policy of Remote Config (`Monetization.bannerPolicy`): shown or not, and seconds after the app opened. */
data class BannerPolicy(val enabled: Boolean, val delaySeconds: Int) {
    companion object {
        /** The policy before and without Remote Config. */
        val DEFAULT = BannerPolicy(enabled = true, delaySeconds = 0)
    }
}

/** `Monetization.loadConfig`'s reading of the Remote Config pair. */
object RemoteBannerPolicy {
    const val ENABLED = "tw_banner_enabled"
    const val DELAY = "tw_banner_delay_seconds"
    private const val MAX_DELAY = 120
    private val DIGITS = Regex("[0-9]+")

    /** The in-app defaults (`setDefaults`). */
    val DEFAULTS: Map<String, Any> = mapOf(ENABLED to true, DELAY to 0L)

    /**
     * The policy of the activated [values] (as strings), or null when either is invalid: the flag must be exactly
     * `"true"` or `"false"` and the delay ASCII digits up to 120. The whole pair is rejected rather than applied in part.
     */
    fun parse(values: Map<String, String?>): BannerPolicy? {
        val flag = values[ENABLED]
        val delay = values[DELAY]
        if (flag != "true" && flag != "false") return null
        if (delay == null || !DIGITS.matches(delay) || BigInteger(delay) > BigInteger.valueOf(MAX_DELAY.toLong())) return null
        return BannerPolicy(flag == "true", delay.toInt())
    }
}

/** What `applyVisibility` reads. [requestShow] is a page's request (the start page hides the banner); null: none. */
data class BannerInputs(
    /** The Ads SDK has started (`onAdapterReady`). */
    val ready: Boolean,
    val enableAds: Boolean?,
    val requestShow: Boolean?,
    val bannerLoaded: Boolean,
    val policy: BannerPolicy,
    /** Remote Config has finished: applied, failed or timed out. */
    val policyReady: Boolean,
    /** Milliseconds since the app opened (`sessionStart`). */
    val sinceStartMs: Long,
)

/**
 * The banner shows ([show]); it is checked again after [recheckInMs] while its delay runs; [eligible] counts as the
 * policy's exposure, once per app open.
 */
data class BannerDecision(val show: Boolean, val recheckInMs: Long?, val eligible: Boolean)

/** TwAds's `applyVisibility`. */
object BannerGate {
    /** The decision, or null before the Ads SDK is ready, when nothing happens. */
    fun decide(inputs: BannerInputs): BannerDecision? = with(inputs) {
        if (!ready) return null
        val requested = requestShow ?: enableAds
        val remaining = policy.delaySeconds * 1000L - sinceStartMs
        val wanted = requested == true && enableAds == true && policy.enabled
        val eligible = wanted && bannerLoaded && policyReady
        BannerDecision(show = eligible && remaining <= 0, recheckInMs = remaining.takeIf { policyReady && wanted && it > 0 }, eligible = eligible)
    }
}
