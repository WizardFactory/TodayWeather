package net.wizardfactory.todayweather.analytics

import kotlin.test.assertEquals
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.assertTrue
import net.wizardfactory.todayweather.core.domain.ads.BannerPolicy
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** #3213: `tw_interstitial_chance` is an integer percentage from 0 to 100; a missing or invalid value uses 30. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InterstitialChanceConfigTest {
    /** Answers like Firebase: `getAll` returns the registered defaults overlaid by the activated values. */
    private class Source(var activated: Map<String, String>, val fetched: Map<String, String>?) : RemoteConfigSource {
        var defaults: Map<String, String> = emptyMap()
        var fetch: ((Boolean) -> Unit)? = null
        override fun setDefaults(defaults: Map<String, Any>, done: (Boolean) -> Unit) {
            this.defaults = defaults.mapValues { it.value.toString() }
            done(true)
        }
        override fun setSettings(fetchTimeoutSeconds: Long, minimumFetchIntervalSeconds: Long, done: (Boolean) -> Unit) = done(true)
        override fun loadActivated(done: (Boolean) -> Unit) = done(true)
        override fun fetchAndActivate(done: (Boolean) -> Unit) {
            fetch = { ok -> if (ok) fetched?.let { activated = it }; done(ok) }
        }
        override fun values() = defaults + activated
    }

    @Test fun parsesOnlyAnIntegerPercentFrom0To100() {
        val cases = mapOf(
            null to 30, "" to 30, "0" to 0, "1" to 1, "30" to 30, "050" to 50, "100" to 100, "101" to 30,
            "-1" to 30, "+5" to 30, "30.0" to 30, " 40" to 30, "40 " to 30, "abc" to 30, "true" to 30,
            "99999999999999999999" to 30, "٣٠" to 30,
        )
        for ((value, expected) in cases) assertEquals(expected, RemoteBannerConfig.interstitialChance(value), "value $value")
    }

    @Test fun theDefaultIsRegisteredAndAppliesWhenTheKeyIsAbsent() = runTest {
        val source = Source(emptyMap(), null)
        val config = RemoteBannerConfig(source, backgroundScope)
        assertEquals(30, config.interstitialChance)
        config.load()
        assertEquals("30", source.defaults[RemoteBannerConfig.INTERSTITIAL_CHANCE])
        assertEquals(30, config.interstitialChance)
    }

    @Test fun storedThenFetchedValuesApplyAndAnInvalidValueFallsBackTo30() = runTest {
        val key = RemoteBannerConfig.INTERSTITIAL_CHANCE
        val source = Source(mapOf(key to "0"), mapOf(key to "100"))
        val config = RemoteBannerConfig(source, backgroundScope)
        config.load()
        assertEquals(0, config.interstitialChance)
        source.fetch!!(true)
        assertEquals(100, config.interstitialChance)

        val invalid = Source(mapOf(key to "75"), mapOf(key to "150"))
        val other = RemoteBannerConfig(invalid, backgroundScope)
        other.load()
        assertEquals(75, other.interstitialChance)
        invalid.fetch!!(true)
        assertEquals(30, other.interstitialChance)
    }

    /** CODEX-1: a fetch activated after the 12 s timeout still sets the chance of later draws, and nothing else. */
    @Test fun aFetchActivatedAfterTheTimeoutStillAppliesTheChanceOnly() = runTest {
        val key = RemoteBannerConfig.INTERSTITIAL_CHANCE
        val source = Source(emptyMap(), mapOf(key to "0", "tw_banner_enabled" to "false", "tw_banner_delay_seconds" to "0",
            RemoteBannerConfig.INTERSTITIAL_ENABLED to "false"))
        val config = RemoteBannerConfig(source, backgroundScope)
        config.load()
        advanceTimeBy(RemoteBannerConfig.TIMEOUT_MS + 1)
        val final = config.policy.value
        assertTrue(final.ready)
        source.fetch!!(true)
        assertEquals(0, config.interstitialChance)
        assertEquals(final, config.policy.value, "the finished policy and format switches stay as they were")
        assertEquals(BannerPolicy.DEFAULT, config.policy.value.policy)
    }

    @Test fun aChangedChanceDoesNotPublishANewState() = runTest {
        val key = RemoteBannerConfig.INTERSTITIAL_CHANCE
        val source = Source(emptyMap(), mapOf(key to "80"))
        val config = RemoteBannerConfig(source, backgroundScope)
        config.load()
        val before = config.policy.value
        source.fetch!!(true)
        assertEquals(80, config.interstitialChance)
        assertEquals(before.copy(ready = true), config.policy.value)
    }
}
