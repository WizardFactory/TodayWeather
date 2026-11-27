package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.time.Duration
import net.wizardfactory.todayweather.core.domain.shell.Tab
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

/**
 * UMP and the Ads SDK start (#2894, #2871, #3234): UMP runs as soon as the tabs open, the consent form shows when
 * required, and the Ads SDK starts only after consent allows ads and the injected [SdkStartScheduler] fires (never
 * before, never twice across activity recreation, and never without consent or against a consent decision); release
 * builds show no ads when UMP fails, debug builds start without UMP once. The ad privacy row shows the form where one
 * is required and the cannot-open message otherwise.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AdsConsentTest {
    private val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    /**
     * UMP as told: [allowed] whether ads may be requested (a form is required while it is not); [update] null leaves the
     * update without an answer until [answerUpdate]; [formLoads] false holds the form's load until [answerLoad];
     * [formAnswers] false leaves a shown form open until [answerForm].
     */
    private class Platform(var allowed: Boolean, var update: String? = "ok", var formGivesConsent: Boolean = true) : AdsPlatform {
        val calls = mutableListOf<String>()
        val formActivities = mutableListOf<Activity>()
        var privacyRequired = false
        var privacyShows = true
        var formLoads = true
        var formAnswers = true
        private var pendingUpdate: (() -> Unit)? = null
        private var pendingLoad: (() -> Unit)? = null
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
        override fun consentFormRequired() = !allowed
        override fun loadConsentForm(onLoaded: (ConsentFormHandle) -> Unit, onFailed: () -> Unit) {
            calls += "load"
            val form = ConsentFormHandle { activity, onDone ->
                calls += "form"
                formActivities += activity
                if (!formAnswers) {
                    pendingForm = onDone
                } else {
                    if (formGivesConsent) allowed = true
                    onDone(false)
                }
            }
            if (formLoads) onLoaded(form) else pendingLoad = { onLoaded(form) }
        }
        fun answerLoad() = pendingLoad!!.invoke()
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

    /** Deterministic scheduler for JVM tests: holds scheduled runs until [runAll] and tracks cancellations. */
    private class TestScheduler : SdkStartScheduler {
        private class Entry(val run: () -> Unit, var cancelled: Boolean = false, var ran: Boolean = false)

        private val entries = mutableListOf<Entry>()
        var scheduledCount = 0
            private set
        var cancelledCount = 0
            private set

        val pendingCount: Int
            get() = entries.count { !it.cancelled && !it.ran }

        override fun schedule(activity: Activity, run: () -> Unit): CancelHandle {
            scheduledCount++
            val entry = Entry(run)
            entries += entry
            return CancelHandle {
                if (!entry.cancelled) {
                    entry.cancelled = true
                    cancelledCount++
                }
            }
        }

        fun runAll() {
            val active = entries.filter { !it.cancelled && !it.ran }
            for (entry in active) {
                if (!entry.cancelled && !entry.ran) {
                    entry.ran = true
                    entry.run()
                }
            }
        }

        /** Simulates a stale callback firing even after its [CancelHandle] was cancelled. */
        fun runCancelledCallbacks() {
            for (entry in entries.filter { it.cancelled && !it.ran }) {
                entry.ran = true
                entry.run()
            }
        }
    }

    private val events = mutableListOf<String>()
    private var ready = 0
    private val scheduler = TestScheduler()

    private fun consent(platform: Platform, release: Boolean = true, startScheduler: SdkStartScheduler = scheduler) =
        AdsConsent(platform, release, { _, params -> events += "${params["action"]}"; true }, startScheduler) { ready++ }

    @Test
    fun theFirstSessionStartsTheSdkOnceConsentAllowsAds() {
        val platform = Platform(allowed = false)
        consent(platform).start(activity)
        assertEquals(listOf("update", "load", "form"), platform.calls, "SDK start waits for the scheduler")
        assertEquals(0, ready)
        scheduler.runAll()
        assertEquals(listOf("update", "load", "form", "sdk"), platform.calls)
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
        assertEquals(0, ready, "SDK start waits for the scheduler after consent")
        scheduler.runAll()
        assertEquals(1, ready)
        c.start(second)
        scheduler.runAll()
        assertEquals(listOf("update", "load", "form", "sdk"), platform.calls, "the SDK starts once")
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
        scheduler.runAll()
        assertEquals(1, ready, "consent given on the new activity starts the SDK")
    }

    @Test
    fun aRotationWhileTheFormLoadsShowsItOnTheNewActivity() {
        val platform = Platform(allowed = false)
        platform.formLoads = false
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        first.pause().stop().destroy()
        c.stop(first.get())
        val second = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(second)
        platform.answerLoad()
        assertEquals(listOf(second), platform.formActivities, "never the destroyed activity")
        scheduler.runAll()
        assertEquals(listOf("update", "load", "form", "sdk"), platform.calls, "one load, the SDK once")
        assertEquals(1, ready)
    }

    @Test
    fun aFormLoadedWithoutAnActivityWaitsForTheNextOne() {
        val platform = Platform(allowed = false)
        platform.formLoads = false
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        first.pause().stop().destroy()
        c.stop(first.get())
        platform.answerLoad()
        assertTrue(platform.formActivities.isEmpty())
        val second = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(second)
        assertEquals(listOf(second), platform.formActivities)
        scheduler.runAll()
        assertEquals(1, ready)
    }

    @Test
    fun aStoredConsentDefersTheSdkStartUntilTheSchedulerFires() {
        val platform = Platform(allowed = true, update = null)
        val c = consent(platform)
        c.start(activity)
        assertEquals(listOf("update"), platform.calls, "UMP runs immediately, but SDK start waits for the scheduler")
        assertEquals(1, scheduler.pendingCount)
        assertEquals(0, ready)
        assertFalse(c.allowed.value)

        c.start(activity)
        assertEquals(1, scheduler.pendingCount, "repeated start on the same activity does not schedule twice")
        assertEquals(listOf("update"), platform.calls)

        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls)
        assertEquals(1, ready)
        assertTrue(c.allowed.value)

        c.start(activity)
        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls, "a later activity of the same app open starts nothing again")
        assertEquals(1, ready)
    }

    @Test
    fun recreationBeforeTheDeferredStartCancelsThePendingStartAndStartsOnce() {
        val platform = Platform(allowed = true, update = null)
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        assertEquals(listOf("update"), platform.calls)
        assertEquals(1, scheduler.pendingCount)
        assertEquals(0, ready)

        first.pause().stop().destroy()
        c.stop(first.get())
        assertEquals(0, scheduler.pendingCount, "destroying the activity cancels the pending SDK start")
        assertEquals(1, scheduler.cancelledCount)

        scheduler.runCancelledCallbacks()
        assertEquals(listOf("update"), platform.calls, "a stale callback from the destroyed activity cannot start the SDK")
        assertEquals(0, ready)

        val second = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(second.get())
        assertEquals(1, scheduler.pendingCount, "the recreated activity schedules the pending start")
        assertEquals(listOf("update"), platform.calls)

        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls, "the SDK starts exactly once")
        assertEquals(1, ready)
        assertTrue(c.allowed.value)

        // A further recreation after the SDK has started must not schedule or start it again.
        second.pause().stop().destroy()
        c.stop(second.get())
        val third = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(third)
        scheduler.runAll()
        assertEquals(0, scheduler.pendingCount)
        assertEquals(listOf("update", "sdk"), platform.calls)
        assertEquals(1, ready)
    }

    @Test
    fun recreationBeforeStopRebindsThePendingStartAndStartsOnce() {
        val platform = Platform(allowed = true, update = null)
        val c = consent(platform)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        val second = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        assertEquals(1, scheduler.pendingCount)

        c.start(second.get())
        assertEquals(1, scheduler.cancelledCount, "rebinding to the new activity cancels the old pending start")
        assertEquals(1, scheduler.pendingCount)

        first.pause().stop().destroy()
        c.stop(first.get())
        assertEquals(1, scheduler.pendingCount, "stopping the old activity keeps the new activity's pending start")

        scheduler.runCancelledCallbacks()
        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls, "the SDK starts exactly once")
        assertEquals(1, ready)
    }

    @Test
    fun revokingConsentBeforeTheDeferredStartFiresPreventsSdkStart() {
        val platform = Platform(allowed = true, update = null).apply { privacyRequired = true }
        val c = consent(platform)
        c.start(activity)
        assertEquals(1, scheduler.pendingCount)

        platform.allowed = false
        c.openPrivacyOptions(activity) { error("expected a form") }
        assertEquals(0, scheduler.pendingCount, "revoking consent cancels the pending SDK start")
        assertEquals(1, scheduler.cancelledCount)

        scheduler.runCancelledCallbacks()
        scheduler.runAll()
        assertEquals(listOf("update", "privacy form"), platform.calls, "no SDK start after consent is revoked")
        assertEquals(0, ready)
        assertFalse(c.allowed.value)
    }

    @Test
    fun noSdkStartWithoutConsentEvenIfConsentFlipsBeforeSchedulerFires() {
        val platform = Platform(allowed = true, update = null)
        val c = consent(platform)
        c.start(activity)
        assertEquals(1, scheduler.pendingCount)

        // Consent becomes false externally before the deferred callback fires.
        platform.allowed = false
        scheduler.runAll()
        assertEquals(listOf("update"), platform.calls, "SDK must not start when canRequestAds is false")
        assertEquals(0, ready)
        assertFalse(c.allowed.value)
    }

    @Test
    fun aDeclinedConsentStartsNothing() {
        val platform = Platform(allowed = false, formGivesConsent = false)
        consent(platform).start(activity)
        scheduler.runAll()
        assertEquals(0, scheduler.scheduledCount)
        assertEquals(listOf("update", "load", "form"), platform.calls)
        assertEquals(0, ready)
    }

    @Test
    fun aUmpFailureShowsNoAdsInReleaseBuilds() {
        val platform = Platform(allowed = false, update = "No form(s) configured")
        consent(platform, release = true).start(activity)
        scheduler.runAll()
        assertEquals(0, scheduler.scheduledCount)
        assertEquals(listOf("update"), platform.calls)
        assertEquals(listOf("consent_failed"), events)
        assertEquals(0, ready)

        val stored = Platform(allowed = true, update = "network")
        consent(stored, release = true).start(activity)
        assertEquals(listOf("update"), stored.calls, "stored consent defers SDK start until scheduler fires")
        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), stored.calls, "a stored consent still allows ads")
    }

    @Test
    fun debugBuildsStartWithoutUmpUnlessConsentWasDecided() {
        val platform = Platform(allowed = false, update = "No form(s) configured")
        consent(platform, release = false).start(activity)
        assertEquals(listOf("update"), platform.calls)
        assertEquals(0, ready)
        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls)
        assertEquals(1, ready)

        val before = scheduler.scheduledCount
        for (reason in listOf("Consent is required", "consent status unknown")) {
            val decided = Platform(allowed = false, update = reason)
            consent(decided, release = false).start(activity)
            scheduler.runAll()
            assertEquals(listOf("update"), decided.calls, reason)
        }
        assertEquals(before, scheduler.scheduledCount)
    }

    @Test
    fun withdrawingConsentRevokesPermissionAfterTheSdkStarted() {
        val platform = Platform(allowed = true)
        val consent = consent(platform)
        consent.start(activity)
        scheduler.runAll()
        assertTrue(consent.allowed.value)
        platform.privacyRequired = true
        platform.allowed = false
        val refreshed = mutableListOf<Boolean>()
        consent.openPrivacyOptions(activity, { refreshed += consent.nativeAllowed }) { error("expected a form") }
        assertEquals(listOf(false, false), refreshed)
        assertEquals(false, consent.allowed.value)
        assertEquals(1, ready)
    }

    @Test
    fun aPrivacyFormWithTheSamePermissionPausesNativeAdsWhileItIsVisible() {
        val original = Platform(allowed = true).apply { privacyRequired = true }
        val loads = mutableListOf<(String?) -> Unit>()
        val released = mutableListOf<String>()
        val inventory = NativeInventory<String>(loads::add, released::add, { 0L }, { it() })
        lateinit var c: AdsConsent
        val platform = object : AdsPlatform by original {
            override fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit) {
                assertTrue(!c.nativeAllowed)
                assertEquals(listOf("old-personalization"), released)
                loads[1]("stale-fill")
                inventory.open(Tab.DAILY, Any()) { assertEquals(null, it) }
                assertEquals(2, loads.size)
                onDone(true) // UMP can answer synchronously; canRequestAds stays true.
            }
        }
        c = AdsConsent(platform, true, { _, _ -> true }, scheduler) {}
        c.start(activity)
        scheduler.runAll()
        inventory.setForeground(true)
        inventory.setEnabled(c.nativeAllowed)
        loads.single()("old-personalization")
        inventory.open(Tab.HOURLY, Any()) {}
        c.openPrivacyOptions(activity, { inventory.setEnabled(c.nativeAllowed) }) { error("expected a form") }
        assertTrue(c.nativeAllowed)
        assertEquals(3, loads.size, "the next spare uses the new privacy choices")
        assertEquals(listOf("old-personalization", "stale-fill"), released)
    }

    @Test
    fun pendingPrivacyOptionsKeepNativeServingOffUntilTheCurrentFormCloses() {
        val original = Platform(allowed = true).apply { privacyRequired = true }
        lateinit var dismiss: (Boolean) -> Unit
        val platform = object : AdsPlatform by original {
            override fun showPrivacyOptionsForm(activity: Activity, onDone: (Boolean) -> Unit) { dismiss = onDone }
        }
        val c = AdsConsent(platform, true, { _, _ -> true }, scheduler) {}
        c.start(activity)
        scheduler.runAll()
        val refreshed = mutableListOf<Boolean>()
        c.openPrivacyOptions(activity, { refreshed += c.nativeAllowed }) { error("expected a form") }
        c.start(activity) // Rechecking UMP while the form is open still cannot authorize a native ad.
        assertTrue(!c.nativeAllowed)
        assertEquals(listOf(false), refreshed)
        dismiss(true)
        dismiss(true)
        assertEquals(listOf(false, true), refreshed)
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
        AdsConsent(broken, true, { _, _ -> true }, scheduler) {}.openPrivacyOptions(activity) { unavailable++ }
        assertEquals(3, unavailable)
    }

    @Test
    fun debugFallbackReschedulesCleanlyAcrossRecreationAndStartsOnce() {
        val platform = Platform(allowed = false, update = "No form(s) configured")
        val c = consent(platform, release = false)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        c.start(first.get())
        assertEquals(1, scheduler.pendingCount)
        assertEquals(listOf("update"), platform.calls)

        first.pause().stop().destroy()
        c.stop(first.get())
        assertEquals(0, scheduler.pendingCount)
        assertEquals(1, scheduler.cancelledCount)

        val second = Robolectric.buildActivity(Activity::class.java).setup().get()
        c.start(second)
        assertEquals(1, scheduler.pendingCount, "debug fallback re-schedules on the recreated activity")
        scheduler.runAll()
        assertEquals(listOf("update", "sdk"), platform.calls)
        assertEquals(1, ready)
        assertTrue(c.allowed.value)
    }

    @Test
    fun afterFirstFrameIdleSchedulerWaitsForActualActivityDrawBeforeStartingDelay() {
        val mainLooper = Shadows.shadowOf(Looper.getMainLooper())
        val prodScheduler = AfterFirstFrameIdleScheduler(minDelayMs = 1_000L, maxIdleWaitMs = 2_000L)
        val freshActivity = Robolectric.buildActivity(Activity::class.java).setup().get()
        var runs = 0

        prodScheduler.schedule(freshActivity) { runs++ }
        assertEquals(0, runs, "does not run synchronously")

        // Main looper runs well past minDelayMs + maxIdleWaitMs without a content draw: SDK must not start.
        mainLooper.idleFor(Duration.ofMillis(5_000))
        assertEquals(0, runs, "must not start while the activity has not drawn its first content frame")

        // Trigger the actual first content draw and finish its posted post-draw callback.
        freshActivity.window.decorView.viewTreeObserver.dispatchOnDraw()
        mainLooper.idleFor(Duration.ofMillis(0))
        assertEquals(0, runs, "does not run right after the first content draw")

        mainLooper.idleFor(Duration.ofMillis(999))
        assertEquals(0, runs, "does not run before the minimum post-frame delay elapses")

        mainLooper.idleFor(Duration.ofMillis(1))
        assertEquals(1, runs, "runs once after the first draw, minimum delay, and main-thread idle")

        // Cancelling before draw or before the delay completes prevents execution.
        val cancelActivity = Robolectric.buildActivity(Activity::class.java).setup().get()
        var cancelledRuns = 0
        val handle = prodScheduler.schedule(cancelActivity) { cancelledRuns++ }
        handle.cancel()
        cancelActivity.window.decorView.viewTreeObserver.dispatchOnDraw()
        mainLooper.idleFor(Duration.ofMillis(5_000))
        assertEquals(0, cancelledRuns, "cancelled schedule never fires")
    }

    @Test
    fun afterFirstFrameIdleSchedulerStartsTimerWithoutExtraDrawWhenActivityAlreadyDrew() {
        val mainLooper = Shadows.shadowOf(Looper.getMainLooper())
        val prodScheduler = AfterFirstFrameIdleScheduler(minDelayMs = 1_000L, maxIdleWaitMs = 2_000L)
        val freshActivity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val platform = Platform(allowed = false, update = null)
        val c = consent(platform, startScheduler = prodScheduler)

        // Activity starts showing content and draws its first frame before UMP returns.
        c.start(freshActivity)
        freshActivity.window.decorView.viewTreeObserver.dispatchOnDraw()
        mainLooper.idleFor(Duration.ofMillis(0))
        assertEquals(0, ready)

        // Screen stays static (no further onDraw or user input) when UMP resolves.
        platform.allowed = true
        platform.answerUpdate()
        assertEquals(listOf("update"), platform.calls, "still waits minDelayMs after resolving")
        assertEquals(0, ready)

        mainLooper.idleFor(Duration.ofMillis(999))
        assertEquals(0, ready, "does not start before minDelayMs")

        mainLooper.idleFor(Duration.ofMillis(1))
        assertEquals(listOf("update", "sdk"), platform.calls, "starts without waiting for another draw or user input")
        assertEquals(1, ready)
    }

    @Test
    fun afterFirstFrameIdleSchedulerCapsFallbackAtOriginalDeadlineWhenDelayRunsLate() {
        val mainLooper = Shadows.shadowOf(Looper.getMainLooper())
        val handler = Handler(Looper.getMainLooper())

        // Case 1: startIdleWait runs late at +2,500 ms and the queue never goes idle -> fires at +3,000 ms, not +4,500 ms.
        run {
            val prodScheduler = AfterFirstFrameIdleScheduler(minDelayMs = 1_000L, maxIdleWaitMs = 2_000L)
            val freshActivity = Robolectric.buildActivity(Activity::class.java).setup().get()
            var runs = 0
            var firedAtElapsedMs = -1L
            var runsAt2900 = -1

            prodScheduler.schedule(freshActivity) {
                runs++
                firedAtElapsedMs = SystemClock.uptimeMillis()
            }
            freshActivity.window.decorView.viewTreeObserver.dispatchOnDraw()
            mainLooper.idleFor(Duration.ofMillis(0))
            val frameDoneMs = SystemClock.uptimeMillis()

            // Stall at +100 ms for 2,400 ms so startIdleWait runs late at +2,500 ms, then keep queue non-idle to +4,600 ms.
            handler.postDelayed({
                ShadowSystemClock.advanceBy(Duration.ofMillis(2_400))
                val busyUntil = frameDoneMs + 4_600L
                val keepBusy = object : Runnable {
                    override fun run() {
                        val elapsed = SystemClock.uptimeMillis() - frameDoneMs
                        if (elapsed == 2_900L) runsAt2900 = runs
                        if (SystemClock.uptimeMillis() < busyUntil) {
                            ShadowSystemClock.advanceBy(Duration.ofMillis(100))
                            handler.post(this)
                        }
                    }
                }
                handler.post(keepBusy)
            }, 100L)

            mainLooper.idleFor(Duration.ofMillis(100))
            assertEquals(0, runsAt2900, "must not fire before the 3,000 ms deadline while main thread stays busy")
            assertEquals(1, runs, "fallback must fire when main thread stays busy")
            assertEquals(
                3_000L,
                firedAtElapsedMs - frameDoneMs,
                "fallback must fire at the original minDelayMs + maxIdleWaitMs deadline (3,000 ms), not 4,500 ms",
            )
        }

        // Case 2: startIdleWait runs past the 3,000 ms deadline (at +3,500 ms) -> fires immediately.
        run {
            val prodScheduler = AfterFirstFrameIdleScheduler(minDelayMs = 1_000L, maxIdleWaitMs = 2_000L)
            val freshActivity = Robolectric.buildActivity(Activity::class.java).setup().get()
            var runs = 0
            var firedAtElapsedMs = -1L

            prodScheduler.schedule(freshActivity) {
                runs++
                firedAtElapsedMs = SystemClock.uptimeMillis()
            }
            freshActivity.window.decorView.viewTreeObserver.dispatchOnDraw()
            mainLooper.idleFor(Duration.ofMillis(0))
            val frameDoneMs = SystemClock.uptimeMillis()

            handler.postDelayed({
                ShadowSystemClock.advanceBy(Duration.ofMillis(3_400))
                val busyUntil = frameDoneMs + 5_000L
                val keepBusy = object : Runnable {
                    override fun run() {
                        if (SystemClock.uptimeMillis() < busyUntil) {
                            ShadowSystemClock.advanceBy(Duration.ofMillis(100))
                            handler.post(this)
                        }
                    }
                }
                handler.post(keepBusy)
            }, 100L)

            mainLooper.idleFor(Duration.ofMillis(100))
            assertEquals(1, runs, "must fire immediately when startIdleWait runs past the original deadline")
            assertEquals(3_500L, firedAtElapsedMs - frameDoneMs)
        }
    }
}
