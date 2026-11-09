package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.gms.ads.MobileAds
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform

/** Google's consent platform (UMP) and the Ads SDK start, as the AdMob plugin calls them. */
interface AdsPlatform {
    /** Ads may be requested: consent obtained or not required, also as stored from an earlier session. */
    fun canRequestAds(): Boolean

    /** `requestConsentInfoUpdate`; [onFailed] gets the error's message. */
    fun requestConsentUpdate(activity: Activity, onUpdated: () -> Unit, onFailed: (String) -> Unit)

    /** The consent form when consent is required and has not been given; [onDone] runs after it, true on an error. */
    fun showConsentFormIfRequired(activity: Activity, onDone: (Boolean) -> Unit)

    /** `MobileAds.initialize`; [onReady] runs on the main thread. */
    fun startSdk(onReady: () -> Unit)

    fun privacyOptionsRequired(): Boolean

    /** The privacy options form; [onDone] true when it showed. */
    fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit)
}

class GoogleAdsPlatform(private val context: Context) : AdsPlatform {
    private val info: ConsentInformation by lazy { UserMessagingPlatform.getConsentInformation(context) }

    override fun canRequestAds() = info.canRequestAds()

    override fun requestConsentUpdate(activity: Activity, onUpdated: () -> Unit, onFailed: (String) -> Unit) {
        val params = ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(false).build()
        info.requestConsentInfoUpdate(activity, params, { onUpdated() }, { error -> onFailed(error.message) })
    }

    override fun showConsentFormIfRequired(activity: Activity, onDone: (Boolean) -> Unit) {
        UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
            if (error != null) Log.w(TAG, "consent form_failed")
            onDone(error != null)
        }
    }

    override fun startSdk(onReady: () -> Unit) {
        val main = Handler(Looper.getMainLooper())
        // Google asks for the start off the main thread.
        Thread { MobileAds.initialize(context) { main.post(onReady) } }.start()
    }

    override fun privacyOptionsRequired() =
        info.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    override fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit) {
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { error -> onDone(error == null) }
    }
}

/**
 * The consent flow and the Ads SDK start of an app open (the emi adapter's `init` with the plugin's `initialize`, #2871):
 * UMP is updated, the consent form shows when required, and the SDK starts in the same session as soon as ads may be
 * requested; with a consent stored from an earlier session it starts at once. When UMP fails, release builds show no
 * ads, as Google's consent guidance asks; debug builds, which use Google's test units, start the SDK without UMP
 * once, unless the failure is a consent decision ([releaseAds]). [onReady] runs once the SDK has started.
 * The form shows on the activity shown when it is due ([start], [stop]): an update answered after a configuration
 * change, or a form lost with its activity, shows it on the next one.
 */
class AdsConsent(
    private val platform: AdsPlatform,
    private val releaseAds: Boolean,
    private val track: (String, Map<String, Any?>) -> Boolean,
    private val onReady: () -> Unit,
) {
    private var requested = false
    private var updated = false
    private var formDone = false
    private var formActivity: Activity? = null
    private var current: Activity? = null
    private var started = false
    private var fellBack = false

    /**
     * An activity is shown: the first one of the app open runs the flow, a later one shows a form still due and starts
     * what consent allows.
     */
    fun start(activity: Activity) {
        current = activity
        if (!requested) {
            requested = true
            platform.requestConsentUpdate(activity, onUpdated = {
                updated = true
                showForm()
            }, onFailed = { reason ->
                startIfAllowed()
                consentFailed(reason)
            })
        } else if (updated && !formDone) {
            showForm()
        }
        startIfAllowed()
    }

    /** The activity is gone, with a form it showed. */
    fun stop(activity: Activity) {
        if (current === activity) current = null
        if (formActivity === activity) formActivity = null
    }

    private fun showForm() {
        val activity = current?.takeUnless { it.isFinishing || it.isDestroyed } ?: return
        if (formActivity != null) return
        formActivity = activity
        platform.showConsentFormIfRequired(activity) { failed ->
            if (formActivity === activity) formActivity = null
            // A form that failed with its activity going shows again on the next one.
            if (!failed || !(activity.isFinishing || activity.isDestroyed)) formDone = true
            startIfAllowed()
        }
    }

    /**
     * 광고 개인정보 선택: the privacy options form where one is required; otherwise, or when it cannot show,
     * [onUnavailable] (`LOC_AD_PRIVACY_UNAVAILABLE`). A changed consent may allow the SDK to start.
     */
    fun openPrivacyOptions(activity: Activity, onUnavailable: () -> Unit) {
        try {
            if (!platform.privacyOptionsRequired()) return onUnavailable()
            platform.showPrivacyOptionsForm(activity) { shown ->
                if (!shown) {
                    Log.w(TAG, "privacy ad_choices form_unavailable")
                    onUnavailable()
                }
                startIfAllowed()
            }
        } catch (e: Exception) {
            onUnavailable()
        }
    }

    private fun startIfAllowed() {
        if (platform.canRequestAds()) startSdk()
    }

    private fun consentFailed(reason: String) {
        Log.w(TAG, "consent ump_error retain_gate")
        track("ad_lifecycle", mapOf("action" to "consent_failed", "ad_format" to "banner"))
        // A consent decision is never bypassed.
        if (releaseAds || fellBack || CONSENT_DECISION.containsMatchIn(reason)) return
        fellBack = true
        startSdk()
    }

    private fun startSdk() {
        if (started) return
        started = true
        platform.startSdk(onReady)
    }

    companion object {
        private val CONSENT_DECISION = Regex("consent is required|status unknown", RegexOption.IGNORE_CASE)
    }
}

private const val TAG = "TwAds"
