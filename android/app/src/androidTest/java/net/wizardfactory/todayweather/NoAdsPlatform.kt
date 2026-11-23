package net.wizardfactory.todayweather

import android.app.Activity
import java.util.concurrent.atomic.AtomicInteger
import net.wizardfactory.todayweather.ads.AdsPlatform
import net.wizardfactory.todayweather.ads.ConsentFormHandle

/**
 * The ads platform of an ad-free capture (`ads` `off`, #3122): UMP is never contacted and the Ads SDK never starts, so
 * no native card, banner or interstitial can load. The consent update succeeds with nothing to ask: a failed update
 * would let a debug build start the SDK without UMP (`AdsConsent.consentFailed`). It exists only in the test APK; the
 * app has no switch that turns its ads off.
 */
object NoAdsPlatform : AdsPlatform {
    /** Calls of [startSdk]; an ad-free capture asserts that none happened. */
    val sdkStarts = AtomicInteger()

    override fun canRequestAds() = false

    override fun requestConsentUpdate(activity: Activity, onUpdated: () -> Unit, onFailed: (String) -> Unit) = onUpdated()

    override fun consentFormRequired() = false

    override fun loadConsentForm(onLoaded: (ConsentFormHandle) -> Unit, onFailed: () -> Unit) = onFailed()

    override fun startSdk(onReady: () -> Unit) {
        sdkStarts.incrementAndGet()
    }

    override fun privacyOptionsRequired() = false

    override fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit) = onDone(false)
}

/** The capture asked for no ads (`-e ads off`). */
fun adsOff(): Boolean = TestRunner.args.getString("ads") == "off"
