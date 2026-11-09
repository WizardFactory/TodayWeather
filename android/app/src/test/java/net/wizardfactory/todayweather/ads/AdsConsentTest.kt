package net.wizardfactory.todayweather.ads

import android.app.Activity
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * UMP and the Ads SDK start of the Cordova build (the emi adapter's `init` and the plugin's `initialize`, #2894, #2871):
 * the SDK starts in the first session once consent allows ads, at once with a stored consent, never against a consent
 * decision; release builds show no ads when UMP fails, debug builds start without UMP once. The ad privacy row shows the
 * form where one is required and the cannot-open message otherwise.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AdsConsentTest {
    private val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    /**
     * UMP as told: [allowed] whether ads may be requested; [update] null leaves the update without an answer until
     * [answerUpdate]; [formAnswers] false leaves the form open until [answerForm].
     */
    private class Platform(var allowed: Boolean, var update: String? = "ok", var formGivesConsent: Boolean = true) : AdsPlatform {
        val calls = mutableListOf<String>()
        val formActivities = mutableListOf<Activity>()
        var privacyRequired = false
        var privacyShows = true
        var formAnswers = true
        private var pendingUpdate: (() -> Unit)? = null
        private var pendingForm: ((Boolean) -> Unit)? = null
        override fun canRequestAds() = allowed
        override fun requestConsentUpdate(activity: Activity, onUpdated: () -> Unit, onFailed: (String) -> Unit) {
            calls += "update"
            when (val u = update) {
                "ok" -> onUpdated()
                null -> pendingUpdate = onUpdated
                else -> onFailed(u)
            }
        }
        fun answerUpdate() = pendingUpdate!!.invoke()
        override fun showConsentFormIfRequired(activity: Activity, onDone: (Boolean) -> Unit) {
            calls += "form"
            formActivities += activity
            if (!formAnswers) {
                pendingForm = onDone
                return
            }
            if (formGivesConsent) allowed = true
            onDone(false)
        }
        fun answerForm(failed: Boolean) {
            if (!failed && formGivesConsent) allowed = true
            pendingForm!!.invoke(failed)
        }
        override fun startSdk(onReady: () -> Unit) {
            calls += "sdk"
            onReady()
        }
        override fun privacyOptionsRequired() = privacyRequired
        override fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit) {
            calls += "privacy form"
            onDone(privacyShows)
        }
    }

    private val events = mutableListOf<String>()
    private var ready = 0

    private fun consent(platform: Platform, release: Boolean = true) =
        AdsConsent(platform, release, { _, params -> events += "${params["action"]}"; true }) { ready++ }

    @Test
    fun theFirstSessionStartsTheSdkOnceConsentAllowsAds() {
        val platform = Platform(allowed = false)
        consent(platform).start(activity)
        assertEquals(listOf("update", "form", "sdk"), platform.calls)
        assertEquals(1, ready)
    }

    @Test
    fun anUpdateAnsweredAfterARotationShowsTheFormOnTheNewActivity() {
        val platform = Platform(allowed = false, update = null)
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        first.pause().stop().destroy()
        c.stop(first.get())
        val second = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(second)
        platform.answerUpdate()
        assertEquals(listOf(second), platform.formActivities, "the form opens on the shown activity")
        assertEquals(1, ready)
        c.start(second)
        assertEquals(listOf("update", "form", "sdk"), platform.calls, "the SDK starts once")
    }

    @Test
    fun aFormLostWithItsActivityShowsOnTheNextOne() {
        val platform = Platform(allowed = false)
        platform.formAnswers = false
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        assertEquals(listOf(first.get()), platform.formActivities)
        first.pause().stop().destroy()
        c.stop(first.get())
        platform.answerForm(failed = true)
        assertEquals(0, ready)
        platform.formAnswers = true
        val second = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(second)
        assertEquals(listOf(first.get(), second), platform.formActivities)
        assertEquals(1, ready, "consent given on the new activity starts the SDK")
    }

    @Test
    fun aStoredConsentStartsTheSdkAtOnce() {
        val platform = Platform(allowed = true, update = null)
        val c = consent(platform)
        c.start(activity)
        assertEquals(listOf("update", "sdk"), platform.calls)
        c.start(activity)
        assertEquals(listOf("update", "sdk"), platform.calls, "a later activity of the same app open starts nothing again")
        assertEquals(1, ready)
    }

    @Test
    fun aDeclinedConsentStartsNothing() {
        val platform = Platform(allowed = false, formGivesConsent = false)
        consent(platform).start(activity)
        assertEquals(listOf("update", "form"), platform.calls)
        assertEquals(0, ready)
    }

    @Test
    fun aUmpFailureShowsNoAdsInReleaseBuilds() {
        val platform = Platform(allowed = false, update = "No form(s) configured")
        consent(platform, release = true).start(activity)
        assertEquals(listOf("update"), platform.calls)
        assertEquals(listOf("consent_failed"), events)
        assertEquals(0, ready)

        val stored = Platform(allowed = true, update = "network")
        consent(stored, release = true).start(activity)
        assertEquals(listOf("update", "sdk"), stored.calls, "a stored consent still allows ads")
    }

    @Test
    fun debugBuildsStartWithoutUmpUnlessConsentWasDecided() {
        val platform = Platform(allowed = false, update = "No form(s) configured")
        consent(platform, release = false).start(activity)
        assertEquals(listOf("update", "sdk"), platform.calls)
        assertEquals(1, ready)

        for (reason in listOf("Consent is required", "consent status unknown")) {
            val decided = Platform(allowed = false, update = reason)
            consent(decided, release = false).start(activity)
            assertEquals(listOf("update"), decided.calls, reason)
        }
    }

    @Test
    fun theAdPrivacyRowShowsTheFormOrTheMessage() {
        var unavailable = 0
        val platform = Platform(allowed = false, update = null)
        val c = consent(platform)
        c.openPrivacyOptions(activity) { unavailable++ }
        assertEquals(1, unavailable, "no form is required here")
        platform.privacyRequired = true
        c.openPrivacyOptions(activity) { unavailable++ }
        assertEquals(1, unavailable)
        assertTrue("privacy form" in platform.calls)
        platform.privacyShows = false
        c.openPrivacyOptions(activity) { unavailable++ }
        assertEquals(2, unavailable)
        val broken = object : AdsPlatform by platform {
            override fun privacyOptionsRequired(): Boolean = error("UMP failed")
        }
        AdsConsent(broken, true, { _, _ -> true }) {}.openPrivacyOptions(activity) { unavailable++ }
        assertEquals(3, unavailable)
    }
}
