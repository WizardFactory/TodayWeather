package net.wizardfactory.todayweather.core.domain.ads

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * TwAds's `applyVisibility` (service.twads.js) as a decision (#2894 AC1, V21): when the banner shows, when it is
 * checked again, and when it counts as exposed; with the Remote Config pair as `Monetization.loadConfig` reads it.
 */
class BannerGateTest {
    private val ready = BannerInputs(ready = true, enableAds = true, requestShow = null, bannerLoaded = true,
        policy = BannerPolicy.DEFAULT, policyReady = true, sinceStartMs = 0)

    @Test
    fun nothingHappensBeforeTheAdsSdkIsReady() {
        assertNull(BannerGate.decide(ready.copy(ready = false)))
    }

    @Test
    fun aLoadedBannerShowsAtOnceWithTheDefaultPolicy() {
        assertEquals(BannerDecision(show = true, recheckInMs = null, eligible = true), BannerGate.decide(ready))
    }

    @Test
    fun theFirstBannerAndTheExposureWaitForTheFinishedPolicy() {
        assertEquals(BannerDecision(show = false, recheckInMs = null, eligible = false), BannerGate.decide(ready.copy(policyReady = false)))
    }

    @Test
    fun theDelayCountsFromTheAppOpeningAndTheExposureDoesNotWaitForIt() {
        val delayed = ready.copy(policy = BannerPolicy(enabled = true, delaySeconds = 30), sinceStartMs = 10_000)
        assertEquals(BannerDecision(show = false, recheckInMs = 20_000, eligible = true), BannerGate.decide(delayed))
        assertEquals(BannerDecision(show = true, recheckInMs = null, eligible = true), BannerGate.decide(delayed.copy(sinceStartMs = 30_000)))
    }

    @Test
    fun theDelayIsCheckedAgainBeforeTheBannerHasLoaded() {
        val delayed = ready.copy(policy = BannerPolicy(enabled = true, delaySeconds = 5), bannerLoaded = false, sinceStartMs = 1_000)
        assertEquals(BannerDecision(show = false, recheckInMs = 4_000, eligible = false), BannerGate.decide(delayed))
    }

    @Test
    fun theKillSwitchHidesTheBannerWithoutAnExposure() {
        val off = ready.copy(policy = BannerPolicy(enabled = false, delaySeconds = 30))
        assertEquals(BannerDecision(show = false, recheckInMs = null, eligible = false), BannerGate.decide(off))
    }

    @Test
    fun aPageThatHidesTheBannerWinsOverTheDelay() {
        val hidden = ready.copy(requestShow = false, policy = BannerPolicy(enabled = true, delaySeconds = 30))
        assertEquals(BannerDecision(show = false, recheckInMs = null, eligible = false), BannerGate.decide(hidden))
        assertEquals(BannerDecision(show = true, recheckInMs = null, eligible = true), BannerGate.decide(ready.copy(requestShow = true)))
    }

    @Test
    fun disabledAdsNeverShowEvenWhenAPageAsks() {
        assertEquals(BannerDecision(show = false, recheckInMs = null, eligible = false),
            BannerGate.decide(ready.copy(enableAds = false, requestShow = true)))
        assertEquals(BannerDecision(show = false, recheckInMs = null, eligible = false), BannerGate.decide(ready.copy(enableAds = null)))
    }

    @Test
    fun theRemoteConfigPairIsReadWholeOrNotAtAll() {
        fun read(flag: String?, delay: String?) =
            RemoteBannerPolicy.parse(mapOf(RemoteBannerPolicy.ENABLED to flag, RemoteBannerPolicy.DELAY to delay))
        assertEquals(BannerPolicy(enabled = true, delaySeconds = 0), read("true", "0"))
        assertEquals(BannerPolicy(enabled = false, delaySeconds = 120), read("false", "120"))
        assertEquals(BannerPolicy(enabled = true, delaySeconds = 7), read("true", "007"))
        for ((flag, delay) in listOf("TRUE" to "0", "1" to "0", "" to "0", null to "0", "true" to "-1", "true" to "1.5",
                "true" to " 5", "true" to "5 ", "true" to "121", "true" to "99999999999999999999", "true" to "", "true" to null,
                "true" to "٣", "false" to "1e2")) {
            assertNull(read(flag, delay), "$flag/$delay")
        }
        assertNull(RemoteBannerPolicy.parse(emptyMap()))
        assertEquals(BannerPolicy(enabled = true, delaySeconds = 0), BannerPolicy.DEFAULT)
        assertEquals(mapOf("tw_banner_enabled" to true, "tw_banner_delay_seconds" to 0L), RemoteBannerPolicy.DEFAULTS)
    }
}
