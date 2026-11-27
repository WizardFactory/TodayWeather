package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import net.wizardfactory.todayweather.AnalyticsGuard
import net.wizardfactory.todayweather.HandBackConsent
import net.wizardfactory.todayweather.HandBackWriter
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaHandBack
import net.wizardfactory.todayweather.core.storage.CordovaMigration
import net.wizardfactory.todayweather.core.storage.Place
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

    /**
     * A withdrawal whose first SDK stop fails is still written, and the decision applied after the write turns the SDK
     * off; a failure there too shows the notice (CODEX-3178-20, order of writes in the spec).
     */
    @Test
    fun aWithdrawalIsWrittenEvenWhenTheFirstSdkStopFails() {
        for (failing in listOf("collection false", "analytics storage denied")) {
            choices.edit().remove(ConsentStore.KEY).commit()
            val sdk = OnceFailing(failing)
            val a = Analytics(sdk, ConsentStore(choices, collection), "development") { "KR" }.also { it.start() }
            assertTrue(a.choice.value)
            sdk.calls.clear()
            sdk.armed = true
            assertTrue(a.setCollectionEnabled(false), failing)
            assertEquals("false", choices.getString(ConsentStore.KEY, null), failing)
            assertEquals(collectionOff, sdk.calls.takeLast(2), "the SDK ends off and denied ($failing)")
            assertFalse(a.track("weather_fetch", fetch))
        }
        val sdk = Sdk(failOn = "collection false")
        choices.edit().remove(ConsentStore.KEY).commit()
        val a = Analytics(sdk, ConsentStore(choices, collection), "development") { "DE" }.also { it.start() }
        assertFalse(a.setCollectionEnabled(false), "an SDK that keeps failing shows the notice")
        assertEquals("false", choices.getString(ConsentStore.KEY, null))
    }

    /** An SDK double whose [failing] call throws once after [armed] is set. */
    private class OnceFailing(private val failing: String) : AnalyticsSdk {
        val calls = mutableListOf<String>()
        var armed = false
        private fun call(name: String) {
            calls += name
            if (armed && name == failing) {
                armed = false
                throw IllegalStateException(name)
            }
        }
        override fun setCollectionEnabled(enabled: Boolean) = call("collection $enabled")
        override fun setConsent(analytics: Boolean) = call("analytics storage ${if (analytics) "granted" else "denied"}")
        override fun logEvent(name: String, params: Map<String, Any>) = call("event $name")
    }

    /**
     * A grant whose commit fails keeps the stored choice even when the SDK then throws while it is turned off: "no
     * choice" does not become a decline (CODEX-3178-23), and the SDK ends off.
     */
    @Test
    fun aFailedGrantKeepsNoChoiceWhenTheSdkFailsAfterIt() {
        for (region in listOf("DE", "KR")) {
            choices.failPuts = false
            choices.edit().remove(ConsentStore.KEY).commit()
            val sdk = OnceFailing("collection false")
            val a = Analytics(sdk, ConsentStore(choices, collection), "development") { region }.also { it.start() }
            if (region == "KR") assertTrue(a.setCollectionEnabled(true)).also { choices.edit().remove(ConsentStore.KEY).commit() }
            choices.failPuts = true
            choices.failValue = "true"
            sdk.calls.clear()
            sdk.armed = true
            assertFalse(a.setCollectionEnabled(true), region)
            assertEquals(null, choices.getString(ConsentStore.KEY, null), "no choice stays no choice ($region)")
            assertFalse(a.choice.value)
            assertEquals(collectionOff, sdk.calls.takeLast(2), "the SDK ends off and denied ($region)")
            choices.failValue = null
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

    /** #3238 AC4: a cold start with stored "collecting" state writes collectionEnabled once (true), not false-then-true. */
    @Test
    fun coldStartWithStoredCollectingStateWritesCollectionOnceWithoutIntermediateFalse() {
        for ((region, storedChoice) in listOf("DE" to "true", "KR" to null)) {
            choices.edit().apply {
                if (storedChoice != null) putString(ConsentStore.KEY, storedChoice) else remove(ConsentStore.KEY)
            }.commit()
            collection.edit().putBoolean(ConsentStore.ENABLED, true).commit()
            collection.recordedBooleans.clear()

            val sdk = Sdk()
            val a = analytics(sdk, region)
            assertTrue(a.choice.value, "collecting in $region")
            assertEquals(collectionOn, sdk.calls, "SDK sequence in $region")
            assertEquals(listOf(true), collection.recordedBooleans, "must not write intermediate false before true ($region)")
        }
    }

    /** #3238 AC4: AnalyticsGuard.beforeFirebase commits synchronously unless both SDK keys are already present and false. */
    @Test
    fun beforeFirebaseSkipsCommitOnlyWhenBothKeysArePresentAndFalse() {
        val prefs = context.getSharedPreferences("com.google.android.gms.measurement.prefs", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        AnalyticsGuard.beforeFirebase(context)
        assertTrue(prefs.contains("measurement_enabled_from_api"))
        assertTrue(prefs.contains("measurement_enabled"))
        assertFalse(prefs.getBoolean("measurement_enabled_from_api", true))
        assertFalse(prefs.getBoolean("measurement_enabled", true))

        // Calling again when both keys are present and false should be a no-op (no commit).
        val counting = CountingContext(context, "com.google.android.gms.measurement.prefs")
        AnalyticsGuard.beforeFirebase(counting)
        assertEquals(0, counting.commits, "both keys present and false: skip commit")

        // When one key is true, must commit both false.
        prefs.edit().putBoolean("measurement_enabled", true).commit()
        counting.commits = 0
        AnalyticsGuard.beforeFirebase(counting)
        assertEquals(1, counting.commits, "one key true: must commit")
        assertFalse(prefs.getBoolean("measurement_enabled", true))

        // When one key is missing, must commit both false.
        prefs.edit().remove("measurement_enabled_from_api").commit()
        counting.commits = 0
        AnalyticsGuard.beforeFirebase(counting)
        assertEquals(1, counting.commits, "missing key: must commit")
        assertTrue(prefs.contains("measurement_enabled_from_api"))
        assertFalse(prefs.getBoolean("measurement_enabled_from_api", true))
    }

    /** #3238 AC2: setCollectionEnabled on a background thread must not hold the monitor used by screen() or track() across commits. */
    @Test
    fun setCollectionEnabledOnBackgroundDoesNotBlockConcurrentScreenOrTrack() {
        for (blockOnChoices in listOf(true, false)) {
            choices.edit().clear().commit()
            collection.edit().clear().commit()
            val sdk = Sdk()
            val a = analytics(sdk, "DE")
            val enteredCommit = CountDownLatch(1)
            val releaseCommit = CountDownLatch(1)
            val targetPrefs = if (blockOnChoices) choices else collection
            targetPrefs.onCommit = {
                enteredCommit.countDown()
                releaseCommit.await(5, TimeUnit.SECONDS)
            }
            val saveResult = AtomicReference<Boolean>()
            val bg = thread(name = "analytics-commit-test") {
                saveResult.set(a.setCollectionEnabled(true))
            }
            try {
                assertTrue(enteredCommit.await(5, TimeUnit.SECONDS), "must enter commit (choices=$blockOnChoices)")
                val probeDone = CountDownLatch(1)
                val probe = thread(name = "main-screen-probe") {
                    a.screen("tab.forecast")
                    a.track("weather_fetch", fetch)
                    probeDone.countDown()
                }
                assertTrue(
                    probeDone.await(500, TimeUnit.MILLISECONDS),
                    "screen() and track() must not block while setCollectionEnabled commits (choices=$blockOnChoices)",
                )
                probe.join(1_000)
            } finally {
                targetPrefs.onCommit = null
                releaseCommit.countDown()
                bg.join(5_000)
            }
            assertEquals(true, saveResult.get())
            assertTrue(a.choice.value)
            assertTrue(a.collecting.value)
        }
    }

    /** #3238 CODEX-2: delayed suite hand-back delays completion and SDK enablement; once finished, HandBackConsent preserves the grant. */
    @Test
    fun setCollectionEnabledWaitsForDelayedSuiteHandBackBeforeEnablingSdk() {
        choices.edit().clear().commit()
        collection.edit().clear().commit()
        val suite = context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)
        suite.edit().clear().commit()
        val store = ConsentStore(choices, collection)
        val writer = HandBackWriter(suite) { store.storedChoice() }
        store.write(false)
        writer.write(AppState(places = listOf(Place.currentPositionPlaceholder()), placeIndex = 0))
        assertEquals("false", suite.getString(CordovaHandBack.CONSENT, null))

        val enteredHandBack = CountDownLatch(1)
        val releaseHandBack = CountDownLatch(1)
        val sdk = Sdk()
        val a = Analytics(sdk, store, "development", { "DE" }, onChoiceWritten = {
            enteredHandBack.countDown()
            assertTrue(releaseHandBack.await(5, TimeUnit.SECONDS))
            writer.rewrite()
        }).also { it.start() }
        sdk.calls.clear()

        val done = CountDownLatch(1)
        val result = AtomicReference<Boolean>()
        val bg = thread(name = "delayed-handback-codex2") {
            result.set(a.setCollectionEnabled(true))
            done.countDown()
        }
        try {
            assertTrue(enteredHandBack.await(5, TimeUnit.SECONDS), "must enter onChoiceWritten")
            assertFalse(done.await(200, TimeUnit.MILLISECONDS), "setCollectionEnabled(true) must wait for suite hand-back")
            assertFalse(a.collecting.value, "must not collect before suite hand-back commits")
            assertFalse("collection true" in sdk.calls, "SDK must not enable before suite hand-back commits")

            releaseHandBack.countDown()
            assertTrue(done.await(5, TimeUnit.SECONDS))
            assertEquals(true, result.get())
            assertTrue(a.choice.value)
            assertTrue(a.collecting.value)
            assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))

            // Restart path: HandBackConsent preserves the grant and next Analytics.start() restores collection.
            HandBackConsent.beforeStart(context)
            val restartedSdk = Sdk()
            val restarted = Analytics(restartedSdk, ConsentStore(context), "development") { "DE" }.also { it.start() }
            assertTrue(restarted.choice.value)
            assertTrue(restarted.collecting.value)
            assertEquals(collectionOn, restartedSdk.calls)
        } finally {
            releaseHandBack.countDown()
            bg.join(5_000)
        }
    }

    /** #3238 CODEX-2: a failed suite hand-back rolls back a grant without enabling the SDK and reports failure. */
    @Test
    fun failedSuiteHandBackRollsBackGrantAndDoesNotEnableSdk() {
        choices.edit().clear().commit()
        collection.edit().clear().commit()
        val store = ConsentStore(choices, collection)
        val sdk = Sdk()
        val a = Analytics(sdk, store, "development", { "DE" }, onChoiceWritten = { false }).also { it.start() }
        sdk.calls.clear()

        assertFalse(a.setCollectionEnabled(true))
        assertFalse(a.choice.value)
        assertFalse(a.collecting.value)
        assertEquals("false", store.storedChoice())
        assertFalse(collection.getBoolean(ConsentStore.ENABLED, true))
        assertFalse("collection true" in sdk.calls, "SDK must never be enabled when hand-back fails")

        // Withdrawal with failed hand-back still records collection off and reports failure.
        assertFalse(a.setCollectionEnabled(false))
        assertFalse(a.choice.value)
        assertFalse(a.collecting.value)
        assertFalse(collection.getBoolean(ConsentStore.ENABLED, true))
    }

    /** #3238 CODEX-3: beginChoice(false) returns immediately without blocking on recordCollection(true) and supersedes the in-flight opt-in. */
    @Test
    fun optOutWhileOptInIsBlockedInRecordCollectionPreventsSdkEnableAndEvents() {
        choices.edit().clear().commit()
        collection.edit().clear().commit()
        val sdk = Sdk()
        val a = analytics(sdk, "DE")
        sdk.calls.clear()
        val enteredRecord = CountDownLatch(1)
        val releaseRecord = CountDownLatch(1)
        collection.onCommit = {
            enteredRecord.countDown()
            releaseRecord.await(5, TimeUnit.SECONDS)
        }
        val gen1 = a.beginChoice(true)
        val gen1Outcome = AtomicReference<Analytics.ChoiceOutcome>()
        val optInThread = thread(name = "opt-in-codex3") {
            gen1Outcome.set(a.commitChoice(true, gen1))
        }
        val gen2Outcome = AtomicReference<Analytics.ChoiceOutcome>()
        var optOutThread: Thread? = null
        try {
            assertTrue(enteredRecord.await(5, TimeUnit.SECONDS), "opt-in must enter recordCollection(true)")
            a.screen("tab.forecast")
            assertFalse(a.collecting.value, "collecting must stay false while recordCollection(true) is still in flight")

            // beginChoice(false) must return immediately without waiting for the latch and stop the SDK at once.
            val beginDone = CountDownLatch(1)
            val gen2Ref = AtomicReference<Long>()
            val mainCaller = thread(name = "main-begin-optout") {
                gen2Ref.set(a.beginChoice(false))
                beginDone.countDown()
            }
            assertTrue(beginDone.await(500, TimeUnit.MILLISECONDS), "beginChoice(false) must not block on disk commit")
            mainCaller.join(1_000)
            val gen2 = gen2Ref.get()!!
            assertFalse(a.choice.value)
            assertFalse(a.collecting.value)
            assertEquals(collectionOff, sdk.calls.takeLast(2), "beginChoice(false) must stop SDK immediately")

            optOutThread = thread(name = "opt-out-codex3") {
                gen2Outcome.set(a.commitChoice(false, gen2))
            }
            collection.onCommit = null
            releaseRecord.countDown()
            optInThread.join(5_000)
            optOutThread.join(5_000)

            assertEquals(Analytics.ChoiceOutcome.SUPERSEDED, gen1Outcome.get())
            assertEquals(Analytics.ChoiceOutcome.APPLIED, gen2Outcome.get())
            assertFalse("collection true" in sdk.calls, "opt-in superseded by opt-out must never enable SDK")
            assertTrue(sdk.events.isEmpty(), "superseded opt-in must not flush pendingScreen or log events")
            assertFalse(a.choice.value)
            assertFalse(a.collecting.value)
            assertEquals("false", choices.getString(ConsentStore.KEY, null))
        } finally {
            collection.onCommit = null
            releaseRecord.countDown()
            optInThread.join(5_000)
            optOutThread?.join(5_000)
        }
    }

    private class CountingContext(base: Context, private val fileName: String) : android.content.ContextWrapper(base) {
        var commits = 0
        override fun getSharedPreferences(name: String?, mode: Int): SharedPreferences {
            val real = super.getSharedPreferences(name, mode)
            if (name != fileName) return real
            return object : SharedPreferences by real {
                override fun edit(): SharedPreferences.Editor {
                    val staged = real.edit()
                    return object : SharedPreferences.Editor by staged {
                        override fun putBoolean(key: String?, value: Boolean) = also { staged.putBoolean(key, value) }
                        override fun commit(): Boolean {
                            commits++
                            return staged.commit()
                        }
                    }
                }
            }
        }
    }

    /** Preferences whose writes fail while [fail] is set: nothing changes, as when the file cannot be written. */
    private class FailingPrefs(private val real: SharedPreferences) : SharedPreferences by real {
        var fail = false

        /** Only writes of a value fail ([failValue] only, when set); a removal succeeds. */
        var failPuts = false
        var failValue: String? = null
        val recordedBooleans = mutableListOf<Boolean>()
        var onCommit: (() -> Unit)? = null

        override fun edit(): SharedPreferences.Editor = when {
            fail -> Failing(real.edit())
            failPuts -> object : SharedPreferences.Editor by real.edit() {
                private val staged = real.edit()
                private var put = false
                override fun putString(key: String?, value: String?) =
                    also { if (failValue == null || value == failValue) put = true else staged.putString(key, value) }
                override fun remove(key: String?) = also { staged.remove(key) }
                override fun commit(): Boolean {
                    onCommit?.invoke()
                    return !put && staged.commit()
                }
            }
            else -> object : SharedPreferences.Editor by real.edit() {
                private val staged = real.edit()
                private val booleans = mutableListOf<Boolean>()
                override fun putString(key: String?, value: String?) = also { staged.putString(key, value) }
                override fun putBoolean(key: String?, value: Boolean) = also {
                    if (key == ConsentStore.ENABLED) booleans += value
                    staged.putBoolean(key, value)
                }
                override fun remove(key: String?) = also { staged.remove(key) }
                override fun clear() = also { staged.clear() }
                override fun commit(): Boolean {
                    onCommit?.invoke()
                    recordedBooleans += booleans
                    return staged.commit()
                }
            }
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
