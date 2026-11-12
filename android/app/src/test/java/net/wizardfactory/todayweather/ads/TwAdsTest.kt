package net.wizardfactory.todayweather.ads

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.analytics.RemoteConfigSource
import net.wizardfactory.todayweather.core.domain.ads.BannerPolicy
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The banner of an app open (TwAds with the emi adapter and `Monetization.loadConfig`, #2894 AC1, V21): it loads once
 * the Ads SDK started, waits for the finished Remote Config policy, honors the delay from the app's opening, the kill
 * switch and a page's hiding, counts one exposure, keeps loads 5 s apart and loads a new banner for a new activity.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TwAdsTest {
    /** Remote Config answering as told; [fetch] null leaves the fetch without an answer. */
    private class Source(var stored: Map<String, String>, var fetched: Map<String, String>?, var fetch: Boolean? = true) : RemoteConfigSource {
        private var values = stored
        var pendingFetch: ((Boolean) -> Unit)? = null
        override fun setDefaults(defaults: Map<String, Any>, done: (Boolean) -> Unit) = done(true)
        override fun setSettings(fetchTimeoutSeconds: Long, minimumFetchIntervalSeconds: Long, done: (Boolean) -> Unit) = done(true)
        override fun loadActivated(done: (Boolean) -> Unit) = done(true)
        override fun fetchAndActivate(done: (Boolean) -> Unit) {
            when (fetch) {
                null -> pendingFetch = { ok -> if (ok) fetched?.let { values = it }; done(ok) }
                true -> { fetched?.let { values = it }; done(true) }
                false -> done(false)
            }
        }
        override fun values() = values
    }

    private class Banner : BannerAdapter {
        val created = mutableListOf<Pair<() -> Unit, () -> Unit>>()
        var destroyed = 0
        override fun create(onLoaded: () -> Unit, onFailed: () -> Unit) {
            created += onLoaded to onFailed
        }
        override fun destroy() {
            destroyed++
        }
        fun load() = created.last().first()
    }

    private val events = mutableListOf<String>()
    private val track: (String, Map<String, Any?>) -> Boolean = { name, params ->
        events += if (name == "ad_lifecycle") "${params["action"]}" else "$name ${params.values.joinToString()}"
        true
    }

    private fun policy(enabled: String, delay: String) = mapOf("tw_banner_enabled" to enabled, "tw_banner_delay_seconds" to delay)

    private fun TestScope.ads(source: RemoteConfigSource? = Source(policy("true", "0"), null)) =
        TwAds(backgroundScope, RemoteBannerConfig(source, backgroundScope), track) { testScheduler.currentTime }

    @Test
    fun theBannerLoadsAfterTheSdkStartedAndShowsAtOnce() = runTest {
        val ads = ads()
        val banner = Banner()
        ads.attach(banner)
        runCurrent()
        assertTrue(banner.created.isEmpty(), "no banner before the Ads SDK started")
        ads.onSdkReady()
        assertEquals(1, banner.created.size)
        assertFalse(ads.shown.value)
        banner.load()
        assertTrue(ads.shown.value)
        assertEquals(listOf("ad_policy_exposure 0", "show"), events)
    }

    @Test
    fun theFirstBannerWaitsForTheFinishedPolicy() = runTest {
        val source = Source(policy("true", "0"), policy("true", "0"), fetch = null)
        val ads = ads(source)
        val banner = Banner()
        ads.attach(banner)
        ads.onSdkReady()
        banner.load()
        runCurrent()
        assertFalse(ads.shown.value)
        assertEquals(listOf("hide"), events, "the first evaluation hides, as the plugin's first hide")
        source.pendingFetch!!(true)
        runCurrent()
        assertTrue(ads.shown.value)
    }

    @Test
    fun aTimedOutFetchReleasesTheBannerWithTheStoredPolicyAndALateAnswerIsIgnored() = runTest {
        val source = Source(policy("true", "0"), policy("false", "0"), fetch = null)
        val ads = ads(source)
        val banner = Banner()
        ads.attach(banner)
        ads.onSdkReady()
        banner.load()
        advanceTimeBy(11_999)
        assertFalse(ads.shown.value)
        advanceTimeBy(2)
        assertTrue(ads.shown.value, "the policy is final 12 s after the app opened")
        source.pendingFetch!!(true)
        runCurrent()
        assertTrue(ads.shown.value, "the stricter late answer does not apply")
    }

    @Test
    fun theDelayCountsFromTheAppOpening() = runTest {
        val ads = ads(Source(policy("true", "30"), null))
        val banner = Banner()
        ads.attach(banner)
        advanceTimeBy(10_000)
        ads.onSdkReady()
        banner.load()
        runCurrent()
        assertFalse(ads.shown.value)
        assertEquals(listOf("ad_policy_exposure 30", "hide"), events, "the exposure counts while the delay runs")
        advanceTimeBy(19_000)
        assertFalse(ads.shown.value)
        advanceTimeBy(1_001)
        assertTrue(ads.shown.value)
    }

    @Test
    fun theKillSwitchKeepsTheBannerHiddenAlsoFromTheStoredPolicyOffline() = runTest {
        val ads = ads(Source(policy("false", "0"), null, fetch = false))
        val banner = Banner()
        ads.attach(banner)
        ads.onSdkReady()
        banner.load()
        advanceTimeBy(60_000)
        assertFalse(ads.shown.value)
        assertEquals(listOf("hide"), events)
    }

    @Test
    fun withoutFirebaseTheDefaultsApply() = runTest {
        val ads = ads(source = null)
        val banner = Banner()
        ads.attach(banner)
        ads.onSdkReady()
        banner.load()
        assertTrue(ads.shown.value)
    }

    @Test
    fun aPageCanHideTheBannerAndShowItAgain() = runTest {
        val ads = ads()
        val banner = Banner()
        ads.attach(banner)
        runCurrent()
        ads.onSdkReady()
        banner.load()
        ads.setShowAds(false)
        assertFalse(ads.shown.value)
        ads.setShowAds(true)
        assertTrue(ads.shown.value)
        assertEquals(1, events.count { it.startsWith("ad_policy_exposure") }, "one exposure per app open")
    }

    @Test
    fun aNewActivityLoadsANewBannerFiveSecondsAfterTheLastLoad() = runTest {
        val ads = ads()
        val first = Banner()
        ads.attach(first)
        runCurrent()
        ads.onSdkReady()
        first.load()
        advanceTimeBy(2_000)
        val second = Banner()
        ads.attach(second)
        assertEquals(1, first.destroyed)
        assertFalse(ads.shown.value, "hidden until the new banner has loaded")
        assertTrue(second.created.isEmpty())
        advanceTimeBy(3_001)
        assertEquals(1, second.created.size)
        first.load()
        assertFalse(ads.shown.value, "the destroyed banner's answer counts for nothing")
        second.load()
        assertTrue(ads.shown.value)
        ads.detach(first)
        assertTrue(ads.shown.value, "the old activity going away later changes nothing")
        ads.detach(second)
        assertFalse(ads.shown.value)
        assertEquals(1, second.destroyed)
    }

    @Test
    fun aWaitingLoadIsCancelledWhenItsActivityGoes() = runTest {
        val ads = ads()
        val first = Banner()
        ads.attach(first)
        runCurrent()
        ads.onSdkReady()
        first.load()
        val second = Banner()
        ads.attach(second)
        ads.detach(second)
        advanceTimeBy(10_000)
        assertTrue(second.created.isEmpty())
        val third = Banner()
        ads.attach(third)
        assertEquals(1, third.created.size, "more than 5 s after the last load")
        third.created.single().second()
        assertFalse(ads.shown.value, "a failed load shows nothing")
    }

    @Test
    fun aLoadAnsweringAfterItsActivityWentShowsNothing() = runTest {
        val ads = ads()
        val banner = Banner()
        ads.attach(banner)
        runCurrent()
        ads.onSdkReady()
        ads.detach(banner)
        banner.load()
        assertFalse(ads.shown.value, "no activity, no banner to show")
    }

    @Test
    fun theStoredPolicyIsReadBeforeTheFetch() = runTest {
        val config = RemoteBannerConfig(Source(policy("true", "45"), policy("true", "15"), fetch = null), backgroundScope)
        config.load()
        assertEquals(RemoteBannerConfig.State(BannerPolicy(true, 45), ready = false), config.policy.value)
        val invalid = RemoteBannerConfig(Source(policy("true", "x"), policy("TRUE", "0")), backgroundScope)
        invalid.load()
        assertEquals(RemoteBannerConfig.State(BannerPolicy.DEFAULT, ready = true), invalid.policy.value, "an invalid pair is ignored whole")
    }
}
