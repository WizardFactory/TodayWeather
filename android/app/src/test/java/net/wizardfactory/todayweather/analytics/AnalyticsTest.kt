package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The usage analytics choice (`Monetization`, #2894 AC1, V22), on by default outside the opt-in regions (AK 2026-11-24,
 * specs/analytics-default-on.md): in an opt-in region (here DE) collection only after an explicit grant, with analytics
 * storage granted and advertising denied; elsewhere (here KR) collection from the start without a stored choice; a stored
 * choice wins over the region; a withdrawal that stops collection at once; failed writes that never leave a grant behind;
 * the start's corroboration of a stored grant; the event schema and the screens.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AnalyticsTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val choices = FailingPrefs(context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE))
    private val collection = FailingPrefs(context.getSharedPreferences(ConsentStore.COLLECTION_FILE, Context.MODE_PRIVATE))

    /** The SDK calls in order; [failOn] makes the matching call throw. */
    private class Sdk(var failOn: String? = null) : AnalyticsSdk {
        val calls = mutableListOf<String>()
        val events = mutableListOf<Pair<String, Map<String, Any>>>()
        private fun call(name: String) {
            calls += name
            if (name == failOn) throw IllegalStateException(name)
        }
        override fun setCollectionEnabled(enabled: Boolean) = call("collection $enabled")
        override fun setConsent(analytics: Boolean) = call("analytics storage ${if (analytics) "granted" else "denied"}")
        override fun logEvent(name: String, params: Map<String, Any>) {
            call("event $name")
            events += name to params
        }
    }

    private fun analytics(sdk: Sdk, region: String? = "DE") =
        Analytics(sdk, ConsentStore(choices, collection), "development") { region }.also { it.start() }

    private val collectionOn = listOf("collection false", "analytics storage granted", "collection true")
    private val collectionOff = listOf("collection false", "analytics storage denied")

    private val fetch = mapOf("outcome" to "success", "duration_ms" to 120)

    @Test
    fun aFreshInstallCollectsNothing() {
        val sdk = Sdk()
        val a = analytics(sdk)
        assertEquals(listOf("collection false", "analytics storage denied"), sdk.calls)
        assertFalse(a.choice.value)
        assertFalse(a.track("weather_fetch", fetch))
        a.screen("tab.forecast")
        assertTrue(sdk.events.isEmpty())
    }

    @Test
    fun aFreshInstallOutsideTheOptInRegionsCollectsWithoutStoringAChoice() {
        for (region in listOf("KR", "US", "JP")) {
            val sdk = Sdk()
            val a = analytics(sdk, region)
            assertEquals(collectionOn, sdk.calls, region)
            assertTrue(a.choice.value, region)
            assertTrue(a.track("weather_fetch", fetch), region)
            a.screen("tab.forecast")
            assertEquals(listOf("weather_fetch", "screen_view"), sdk.events.map { it.first }, region)
            assertEquals(null, choices.getString(ConsentStore.KEY, null), "the default writes no choice")
            assertTrue(collection.getBoolean(ConsentStore.ENABLED, false), "the collection state is recorded")
        }
    }

    @Test
    fun aFreshInstallInAnOptInOrUnknownRegionCollectsNothing() {
        for (region in listOf("DE", "FR", "NO", "GB", "CH", "", "150", null)) {
            val sdk = Sdk()
            val a = analytics(sdk, region)
            assertEquals(collectionOff, sdk.calls, "$region")
            assertFalse(a.choice.value, "$region")
            assertFalse(a.track("weather_fetch", fetch), "$region")
            assertEquals(null, choices.getString(ConsentStore.KEY, null))
        }
    }

    @Test
    fun theStoredChoiceWinsOverTheRegion() {
        choices.edit().putString(ConsentStore.KEY, "false").commit()
        val declined = Sdk()
        assertFalse(analytics(declined, "KR").choice.value, "a stored decline stays off where the default is on")
        assertEquals(collectionOff, declined.calls)
        assertEquals("false", choices.getString(ConsentStore.KEY, null))

        choices.edit().putString(ConsentStore.KEY, "true").commit()
        collection.edit().putBoolean(ConsentStore.ENABLED, true).commit()
        val granted = Sdk()
        assertTrue(analytics(granted, "DE").choice.value, "a stored grant collects in an opt-in region")
        assertEquals(collectionOn, granted.calls)
    }

    @Test
    fun theRegionDecidesAgainAtEachStartWhileNothingIsStored() {
        assertTrue(analytics(Sdk(), "KR").choice.value)
        val moved = Sdk()
        assertFalse(analytics(moved, "DE").choice.value)
        assertEquals(collectionOff, moved.calls)
        assertEquals(null, choices.getString(ConsentStore.KEY, null))
    }

    @Test
    fun turningItOffWhereTheDefaultIsOnHoldsAfterARestart() {
        val sdk = Sdk()
        val a = analytics(sdk, "KR")
        sdk.calls.clear()
        assertTrue(a.setCollectionEnabled(false))
        assertEquals(collectionOff + collectionOff, sdk.calls)
        assertFalse(a.choice.value)
        assertFalse(a.track("weather_fetch", fetch))
        assertEquals("false", choices.getString(ConsentStore.KEY, null))
        val restarted = Sdk()
        assertFalse(analytics(restarted, "KR").choice.value)
        assertEquals(collectionOff, restarted.calls)

        assertTrue(analytics(Sdk(), "KR").setCollectionEnabled(true))
        assertEquals("true", choices.getString(ConsentStore.KEY, null), "turning it on again writes a grant")
    }

    @Test
    fun aFailureWhileApplyingTheDefaultLeavesEverythingOffAndStoresNoChoice() {
        val sdk = Sdk(failOn = "collection true")
        val a = analytics(sdk, "KR")
        assertEquals(collectionOn + collectionOff, sdk.calls)
        assertFalse(a.choice.value)
        assertFalse(a.track("weather_fetch", fetch))
        assertFalse(collection.getBoolean(ConsentStore.ENABLED, true))
        assertEquals(null, choices.getString(ConsentStore.KEY, null), "a failure is not the user's choice")
        val next = Sdk()
        assertTrue(analytics(next, "KR").choice.value, "the next start applies the default again")
        assertEquals(collectionOn, next.calls)
    }

    /** A grant that cannot be written keeps the stored choice: a decline is not erased into "no choice" (CODEX-3178-8). */
    @Test
    fun aGrantThatCannotBeWrittenKeepsAStoredDecline() {
        choices.edit().putString(ConsentStore.KEY, "false").commit()
        val a = analytics(Sdk(), "KR")
        choices.failPuts = true
        assertFalse(a.setCollectionEnabled(true))
        assertFalse(a.choice.value)
        choices.failPuts = false
        assertEquals("false", choices.getString(ConsentStore.KEY, null))
        val restarted = Sdk()
        assertFalse(analytics(restarted, "KR").choice.value)
        assertEquals(collectionOff, restarted.calls)
    }

    /** Any record the start cannot read as expected leaves collection off (CODEX-3178-10). */
    @Test
    fun anUnreadableCollectionRecordDoesNotCollect() {
        for (region in listOf("KR", "DE")) {
            choices.edit().remove(ConsentStore.KEY).commit()
            collection.edit().putString(ConsentStore.ENABLED, "true").commit()
            val sdk = Sdk()
            assertFalse(analytics(sdk, region).choice.value, "no choice ($region)")
            assertEquals(collectionOff, sdk.calls)
            choices.edit().putString(ConsentStore.KEY, "true").commit()
            collection.edit().putString(ConsentStore.ENABLED, "true").commit()
            assertFalse(analytics(Sdk(), region).choice.value, "a stored grant ($region)")
        }
    }

    @Test
    fun anUnreadableChoiceDoesNotCollect() {
        choices.edit().putBoolean(ConsentStore.KEY, true).commit()
        val sdk = Sdk()
        assertFalse(analytics(sdk, "KR").choice.value, "a stored value of another type is not 'no choice'")
        assertEquals(collectionOff, sdk.calls)
    }

    @Test
    fun theCollectionStateIsRecordedBeforeTheSdkCollects() {
        collection.fail = true
        val sdk = Sdk()
        val a = analytics(sdk, "KR")
        assertFalse(a.choice.value)
        assertEquals(collectionOn.dropLast(1) + collectionOff, sdk.calls, "the SDK is never told to collect")
        assertEquals(null, choices.getString(ConsentStore.KEY, null))
        sdk.calls.clear()
        assertFalse(a.setCollectionEnabled(true))
        assertFalse("collection true" in sdk.calls)
    }

    @Test
    fun aGrantEnablesOnlyAnalyticsStorageAndSurvivesARestart() {
        val sdk = Sdk()
        val a = analytics(sdk)
        sdk.calls.clear()
        assertTrue(a.setCollectionEnabled(true))
        assertEquals(listOf("collection false", "analytics storage granted", "collection true"), sdk.calls)
        assertTrue(a.choice.value)
        assertTrue(a.track("weather_fetch", fetch))
        assertEquals("weather_fetch" to mapOf<String, Any>("outcome" to "success", "duration_ms" to 120L, "measurement_version" to 1L,
            "traffic_type" to "development"), sdk.events.single())

        val restarted = Sdk()
        val again = analytics(restarted)
        assertEquals(listOf("collection false", "analytics storage granted", "collection true"), restarted.calls)
        assertTrue(again.choice.value)
    }

    @Test
    fun aWithdrawalStopsCollectionAtOnceAndPersists() {
        val sdk = Sdk()
        val a = analytics(sdk)
        a.setCollectionEnabled(true)
        sdk.calls.clear()
        assertTrue(a.setCollectionEnabled(false))
        assertEquals(collectionOff + collectionOff, sdk.calls, "the SDK stops before the choice is written, then the choice applies")
        assertFalse(a.track("weather_fetch", fetch))
        assertEquals("false", choices.getString(ConsentStore.KEY, null))

        val restarted = Sdk()
        assertFalse(analytics(restarted).choice.value)
        assertEquals(listOf("collection false", "analytics storage denied"), restarted.calls)
    }

    @Test
    fun aGrantThatCannotBeSavedLeavesCollectionOff() {
        val sdk = Sdk()
        val a = analytics(sdk)
        choices.fail = true
        sdk.calls.clear()
        assertFalse(a.setCollectionEnabled(true), "the dialog reports LOC_PRIVACY_SAVE_FAILED")
        assertFalse(a.choice.value)
        assertEquals(listOf("collection false", "analytics storage denied"), sdk.calls)
        assertFalse(a.track("weather_fetch", fetch))
    }

    @Test
    fun aWithdrawalThatCannotBeSavedStillHoldsAfterARestart() {
        val a = analytics(Sdk())
        a.setCollectionEnabled(true)
        // Every write of the choice fails, its removal too: the grant stays in its file.
        choices.fail = true
        assertFalse(a.setCollectionEnabled(false))
        assertFalse(a.choice.value)
        assertEquals("true", choices.getString(ConsentStore.KEY, null))
        // The collection state was written, so the stale grant does not come back.
        choices.fail = false
        val restarted = Sdk()
        assertFalse(analytics(restarted).choice.value)
        assertEquals(listOf("collection false", "analytics storage denied"), restarted.calls)
        assertEquals("false", choices.getString(ConsentStore.KEY, null))
    }

    /**
     * A withdrawal that cannot be written keeps the stored value; collection stays off for the session, and an old grant
     * is withdrawn at the next start because the collection state says off (simplified design, 2026-11-24).
     */
    @Test
    fun aFailedWithdrawalKeepsTheStoredValueAndStaysOff() {
        for (region in listOf("DE", "KR")) {
            choices.failPuts = false
            choices.edit().remove(ConsentStore.KEY).commit()
            val a = analytics(Sdk(), region)
            assertTrue(a.setCollectionEnabled(true))
            choices.failPuts = true
            val sdk = Sdk()
            val b = Analytics(sdk, ConsentStore(choices, collection), "development") { region }.also { it.start() }
            sdk.calls.clear()
            assertFalse(b.setCollectionEnabled(false), "the save-failed notice ($region)")
            assertFalse(b.choice.value)
            assertEquals(collectionOff + collectionOff, sdk.calls, "the SDK stops before the write ($region)")
            assertEquals("true", choices.getString(ConsentStore.KEY, null), "the stored value stays ($region)")
            choices.failPuts = false
            assertFalse(analytics(Sdk(), region).choice.value, "the next start withdraws the old grant ($region)")
            assertEquals("false", choices.getString(ConsentStore.KEY, null))
        }
    }

    @Test
    fun anSdkFailureWithdrawsTheGrant() {
        val sdk = Sdk(failOn = "collection true")
        val a = analytics(sdk)
        sdk.calls.clear()
        assertFalse(a.setCollectionEnabled(true))
        assertFalse(a.choice.value)
        assertEquals("false", choices.getString(ConsentStore.KEY, null))
        assertEquals(listOf("collection false", "analytics storage granted", "collection true", "collection false", "analytics storage denied"), sdk.calls)
        assertFalse(a.track("weather_fetch", fetch))

        val unrecorded = Sdk()
        val b = analytics(unrecorded)
        collection.fail = true
        assertFalse(b.setCollectionEnabled(true), "a grant whose collection state cannot be written is not kept")
        assertFalse(b.choice.value)
    }

    @Test
    fun onlyTheExactStoredGrantCounts() {
        for (region in listOf("DE", "KR")) {
            for (stored in listOf("TRUE", "1", "yes", "")) {
                choices.edit().putString(ConsentStore.KEY, stored).commit()
                collection.edit().putBoolean(ConsentStore.ENABLED, true).commit()
                assertFalse(analytics(Sdk(), region).choice.value, "$stored $region")
            }
            choices.edit().putString(ConsentStore.KEY, "true").commit()
            collection.edit().remove(ConsentStore.ENABLED).commit()
            assertFalse(analytics(Sdk(), region).choice.value, "a grant without the collection state ($region)")
            assertEquals("false", choices.getString(ConsentStore.KEY, null), "is withdrawn ($region)")
        }
    }

    @Test
    fun screensAreSentOnlyAfterAGrantWithoutRepeats() {
        val sdk = Sdk()
        val a = analytics(sdk)
        a.screen("tab.forecast")
        a.setCollectionEnabled(true)
        assertTrue(sdk.events.isEmpty(), "no screen before the grant is replayed")
        for (screen in listOf("tab.forecast", "tab.forecast", "units", "setting-radio", "unknown", "units", "tab.forecast")) a.screen(screen)
        assertEquals(listOf("tab.forecast", "units", "setting-radio", "units", "tab.forecast"), sdk.events.map { it.second["screen_name"] })
        assertEquals(mapOf<String, Any>("screen_name" to "units", "screen_class" to "Cordova", "measurement_version" to 1L, "traffic_type" to "development"),
            sdk.events[1].second)
        a.onOpened()
        a.screen("tab.forecast")
        assertEquals(6, sdk.events.size, "a new app open counts its first screen again")
    }

    @Test
    fun aBrokenBridgeNeverBreaksTheApp() {
        val sdk = Sdk(failOn = "event weather_fetch")
        val a = analytics(sdk)
        a.setCollectionEnabled(true)
        assertFalse(a.track("weather_fetch", fetch))
        assertFalse(a.track("weather_fetch", mapOf("outcome" to "success", "duration_ms" to -1)))
        assertTrue(a.track("ad_lifecycle", mapOf("action" to "show", "ad_format" to "banner")))
    }

    /** Preferences whose writes fail while [fail] is set: nothing changes, as when the file cannot be written. */
    private class FailingPrefs(private val real: SharedPreferences) : SharedPreferences by real {
        var fail = false

        /** Only writes of a value fail; a removal succeeds. */
        var failPuts = false

        override fun edit(): SharedPreferences.Editor = when {
            fail -> Failing(real.edit())
            failPuts -> object : SharedPreferences.Editor by real.edit() {
                private val staged = real.edit()
                private var put = false
                override fun putString(key: String?, value: String?) = also { put = true }
                override fun remove(key: String?) = also { staged.remove(key) }
                override fun commit() = !put && staged.commit()
            }
            else -> real.edit()
        }

        /** An editor that stages changes and never writes them. */
        private class Failing(private val staged: SharedPreferences.Editor) : SharedPreferences.Editor by staged {
            override fun putString(key: String?, value: String?) = also { staged.putString(key, value) }
            override fun putBoolean(key: String?, value: Boolean) = also { staged.putBoolean(key, value) }
            override fun remove(key: String?) = also { staged.remove(key) }
            override fun commit() = false
            override fun apply() {}
        }
    }
}
