package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.MessageQueue
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import android.view.Choreographer
import android.view.View
import android.view.ViewTreeObserver
import com.google.android.gms.ads.MobileAds
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Cancels a scheduled deferred Ads SDK start. */
fun interface CancelHandle {
    fun cancel()
}

/**
 * Schedules [run] (the Ads SDK start) after [activity]'s first content draw and a main-thread idle point.
 * The returned [CancelHandle] cancels the pending start if the activity stops before it fires.
 */
fun interface SdkStartScheduler {
    /**
     * Begins observing [activity]'s first content draw so a later [schedule] call on the same activity can start
     * the post-frame timer immediately without hanging on a static screen if that draw has already finished.
     */
    fun observeFirstDraw(activity: Activity): CancelHandle = CancelHandle {}

    fun schedule(activity: Activity, run: () -> Unit): CancelHandle
}

/**
 * Production scheduler for the Ads SDK start (#3234):
 * 1. Waits for [activity]'s actual first content draw via [ViewTreeObserver.OnDrawListener] on its decor view
 *    (posting out of `onDraw` so the timer starts right after that draw pass finishes, or starting immediately if
 *    that activity's first draw was already observed via [observeFirstDraw]; falls back to
 *    [Choreographer.postFrameCallback] + `handler.post` only if no live view tree observer is available).
 * 2. Waits [minDelayMs] (default 1,000 ms) after that first draw so immediate post-TTID interactions (such as a tap
 *    200 ms after TTID) do not collide with `WebViewChromium.init`. Does not wait for user input.
 * 3. Waits for a main-thread idle point ([MessageQueue.IdleHandler]), capped at a fixed deadline of
 *    `minDelayMs + maxIdleWaitMs` (default 3,000 ms) after the first draw so a late timer or busy main thread cannot
 *    postpone ads beyond the total cap.
 */
class AfterFirstFrameIdleScheduler(
    private val minDelayMs: Long = DEFAULT_MIN_DELAY_MS,
    private val maxIdleWaitMs: Long = DEFAULT_MAX_IDLE_WAIT_MS,
    private val uptimeMillis: () -> Long = SystemClock::uptimeMillis,
) : SdkStartScheduler {
    init {
        require(minDelayMs >= 0L) { "minDelayMs must be non-negative: $minDelayMs" }
        require(maxIdleWaitMs >= 0L) { "maxIdleWaitMs must be non-negative: $maxIdleWaitMs" }
    }

    /** Per-decorView draw state, accessed on the main thread only; never strongly references the View or Activity. */
    private class DecorDrawState {
        var drawn = false
        var attachListener: View.OnAttachStateChangeListener? = null
        var listener: ViewTreeObserver.OnDrawListener? = null
        var savedVto: WeakReference<ViewTreeObserver>? = null
        var postDrawRunnable: Runnable? = null
        var observers = 0
        val waiters = mutableListOf<() -> Unit>()
    }

    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
    private val drawStates = WeakHashMap<View, DecorDrawState>()

    override fun observeFirstDraw(activity: Activity): CancelHandle {
        val mainLooper = Looper.getMainLooper()
        val handler = mainHandler
        val cancelled = AtomicBoolean(false)
        var activityRef: WeakReference<Activity>? = WeakReference(activity)
        var viewRef: WeakReference<View>? = null
        var registeredState: DecorDrawState? = null

        fun arm() {
            val target = activityRef?.get()
            activityRef = null
            if (cancelled.get() || target == null) return
            val decorView = target.window?.decorView ?: return
            val state = drawStates.getOrPut(decorView) { DecorDrawState() }
            if (state.drawn) return
            if (!ensureDrawListener(decorView, state)) {
                if (state.observers == 0 && state.waiters.isEmpty()) drawStates.remove(decorView)
                return
            }
            state.observers++
            viewRef = WeakReference(decorView)
            registeredState = state
        }

        val armRunnable = Runnable { arm() }
        if (Looper.myLooper() == mainLooper) {
            arm()
        } else {
            handler.post(armRunnable)
        }

        return CancelHandle {
            if (!cancelled.compareAndSet(false, true)) return@CancelHandle
            activityRef = null
            fun cleanup() {
                handler.removeCallbacks(armRunnable)
                val state = registeredState ?: return
                registeredState = null
                val view = viewRef?.get()
                viewRef = null
                if (state.observers > 0) state.observers--
                detachIfUnused(view, state)
            }
            if (Looper.myLooper() == mainLooper) cleanup() else handler.post { cleanup() }
        }
    }

    override fun schedule(activity: Activity, run: () -> Unit): CancelHandle {
        val mainLooper = Looper.getMainLooper()
        val handler = mainHandler
        val cancelled = AtomicBoolean(false)
        var done = false
        var activityRef: WeakReference<Activity>? = WeakReference(activity)
        var viewRef: WeakReference<View>? = null
        var drawState: DecorDrawState? = null
        var drawWaiter: (() -> Unit)? = null
        var frameCallback: Choreographer.FrameCallback? = null
        var postChoreographerRunnable: Runnable? = null
        var delayRunnable: Runnable? = null
        var fallbackRunnable: Runnable? = null
        var idleHandler: MessageQueue.IdleHandler? = null

        fun fire() {
            if (cancelled.get() || done) return
            done = true
            fallbackRunnable?.let(handler::removeCallbacks)
            fallbackRunnable = null
            idleHandler?.let(mainLooper.queue::removeIdleHandler)
            idleHandler = null
            run()
        }

        fun startPostFrameTimer() {
            if (cancelled.get() || done) return
            viewRef = null
            drawState = null
            drawWaiter = null
            val frameDoneMs = uptimeMillis()
            val deadlineMs = frameDoneMs + minDelayMs + maxIdleWaitMs
            val startIdleWait = Runnable {
                delayRunnable = null
                if (cancelled.get() || done) return@Runnable
                val remaining = (deadlineMs - uptimeMillis()).coerceAtLeast(0L)
                if (remaining == 0L) {
                    fire()
                    return@Runnable
                }
                val idle = MessageQueue.IdleHandler {
                    idleHandler = null
                    fire()
                    false
                }
                val fallback = Runnable {
                    fallbackRunnable = null
                    fire()
                }
                idleHandler = idle
                fallbackRunnable = fallback
                mainLooper.queue.addIdleHandler(idle)
                handler.postDelayed(fallback, remaining)
            }
            delayRunnable = startIdleWait
            handler.postDelayed(startIdleWait, minDelayMs)
        }

        fun scheduleChoreographerFallback() {
            val afterFrame = Runnable {
                postChoreographerRunnable = null
                startPostFrameTimer()
            }
            val frame = Choreographer.FrameCallback {
                frameCallback = null
                if (cancelled.get() || done) return@FrameCallback
                postChoreographerRunnable = afterFrame
                handler.post(afterFrame)
            }
            frameCallback = frame
            Choreographer.getInstance().postFrameCallback(frame)
        }

        fun arm() {
            val target = activityRef?.get()
            activityRef = null
            if (cancelled.get() || done) return
            val decorView = target?.window?.decorView
            if (decorView == null) {
                scheduleChoreographerFallback()
                return
            }
            val state = drawStates.getOrPut(decorView) { DecorDrawState() }
            if (state.drawn) {
                startPostFrameTimer()
                return
            }
            if (!ensureDrawListener(decorView, state)) {
                if (state.observers == 0 && state.waiters.isEmpty()) drawStates.remove(decorView)
                scheduleChoreographerFallback()
                return
            }
            val waiter = { startPostFrameTimer() }
            viewRef = WeakReference(decorView)
            drawState = state
            drawWaiter = waiter
            state.waiters += waiter
        }

        val armRunnable = Runnable { arm() }
        if (Looper.myLooper() == mainLooper) {
            arm()
        } else {
            handler.post(armRunnable)
        }

        return CancelHandle {
            if (!cancelled.compareAndSet(false, true)) return@CancelHandle
            activityRef = null
            fun cleanup() {
                handler.removeCallbacks(armRunnable)
                val state = drawState
                val waiter = drawWaiter
                val view = viewRef?.get()
                drawState = null
                drawWaiter = null
                viewRef = null
                if (state != null && waiter != null) {
                    state.waiters.remove(waiter)
                    detachIfUnused(view, state)
                }
                frameCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
                frameCallback = null
                postChoreographerRunnable?.let(handler::removeCallbacks)
                postChoreographerRunnable = null
                delayRunnable?.let(handler::removeCallbacks)
                delayRunnable = null
                fallbackRunnable?.let(handler::removeCallbacks)
                fallbackRunnable = null
                idleHandler?.let(mainLooper.queue::removeIdleHandler)
                idleHandler = null
            }
            if (Looper.myLooper() == mainLooper) cleanup() else handler.post { cleanup() }
        }
    }

    private fun ensureDrawListener(decorView: View, state: DecorDrawState): Boolean {
        if (state.drawn || state.postDrawRunnable != null) return true
        // Wait for window attachment before registering an OnDrawListener: on Android 7.0/7.1 (API 24–25),
        // ViewTreeObserver.merge() invalidates the floating observer without migrating OnDrawListeners.
        if (decorView.isAttachedToWindow) {
            state.attachListener?.let {
                decorView.removeOnAttachStateChangeListener(it)
                state.attachListener = null
            }
            if (state.listener != null && state.savedVto?.get()?.isAlive == true) return true
            state.listener?.let { removeOnDrawListenerSafely(decorView, state.savedVto?.get(), it) }
            state.listener = null
            state.savedVto = null
            return registerOnDrawListener(decorView, state)
        }
        if (state.attachListener != null) return true
        val attachListener = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                v.removeOnAttachStateChangeListener(this)
                if (state.attachListener === this) state.attachListener = null
                if (state.drawn || (state.observers == 0 && state.waiters.isEmpty())) {
                    detachIfUnused(v, state)
                    return
                }
                if (!registerOnDrawListener(v, state)) {
                    val callbacks = state.waiters.toList()
                    state.waiters.clear()
                    if (callbacks.isNotEmpty()) {
                        Choreographer.getInstance().postFrameCallback {
                            mainHandler.post { callbacks.forEach { it() } }
                        }
                    }
                    detachIfUnused(v, state)
                }
            }

            override fun onViewDetachedFromWindow(v: View) = Unit
        }
        state.attachListener = attachListener
        decorView.addOnAttachStateChangeListener(attachListener)
        return true
    }

    private fun registerOnDrawListener(decorView: View, state: DecorDrawState): Boolean {
        val vto = decorView.viewTreeObserver
        if (!vto.isAlive) return false
        val viewRef = WeakReference(decorView)
        var fired = false
        lateinit var onDrawListener: ViewTreeObserver.OnDrawListener
        onDrawListener = ViewTreeObserver.OnDrawListener {
            if (fired) return@OnDrawListener
            fired = true
            val postDraw = Runnable {
                val view = viewRef.get()
                removeOnDrawListenerSafely(view, state.savedVto?.get(), onDrawListener)
                state.listener = null
                state.savedVto = null
                state.postDrawRunnable = null
                state.drawn = true
                val callbacks = state.waiters.toList()
                state.waiters.clear()
                callbacks.forEach { it() }
            }
            state.postDrawRunnable = postDraw
            mainHandler.post(postDraw)
        }
        state.listener = onDrawListener
        state.savedVto = WeakReference(vto)
        vto.addOnDrawListener(onDrawListener)
        return true
    }

    private fun detachIfUnused(view: View?, state: DecorDrawState) {
        if (state.drawn || state.observers > 0 || state.waiters.isNotEmpty()) return
        state.postDrawRunnable?.let(mainHandler::removeCallbacks)
        state.postDrawRunnable = null
        state.attachListener?.let { listener ->
            view?.removeOnAttachStateChangeListener(listener)
        }
        state.attachListener = null
        state.listener?.let { listener ->
            removeOnDrawListenerSafely(view, state.savedVto?.get(), listener)
        }
        state.listener = null
        state.savedVto = null
        if (view != null) {
            drawStates.remove(view)
        }
    }

    private fun removeOnDrawListenerSafely(
        view: View?,
        savedVto: ViewTreeObserver?,
        listener: ViewTreeObserver.OnDrawListener,
    ) {
        val currentVto = view?.viewTreeObserver
        if (currentVto != null && currentVto.isAlive) {
            currentVto.removeOnDrawListener(listener)
        }
        if (savedVto != null && savedVto !== currentVto && savedVto.isAlive) {
            savedVto.removeOnDrawListener(listener)
        }
    }

    companion object {
        /** Minimum wait after the first content draw so early taps clear `WebViewChromium.init`. */
        const val DEFAULT_MIN_DELAY_MS = 1_000L

        /** Upper bound on waiting for a main-thread idle point after [DEFAULT_MIN_DELAY_MS]. */
        const val DEFAULT_MAX_IDLE_WAIT_MS = 2_000L
    }
}

/** A consent form loaded to be shown once. */
fun interface ConsentFormHandle {
    /** Shows it on [activity]; [onDone] runs when it closes, true on an error. */
    fun show(activity: Activity, onDone: (Boolean) -> Unit)
}

/** Google's consent platform (UMP) and the Ads SDK start, as the AdMob plugin calls them. */
interface AdsPlatform {
    /** Ads may be requested: consent obtained or not required, also as stored from an earlier session. */
    fun canRequestAds(): Boolean

    /** `requestConsentInfoUpdate`; [onFailed] gets the error's message. */
    fun requestConsentUpdate(activity: Activity, onUpdated: () -> Unit, onFailed: (String) -> Unit)

    /** Consent is required and UMP has a form for it (when `loadAndShowConsentFormIfRequired` would show one). */
    fun consentFormRequired(): Boolean

    /**
     * Loads the consent form without an activity, so the form shows on the activity shown when it has loaded:
     * [onLoaded] or [onFailed], once.
     */
    fun loadConsentForm(onLoaded: (ConsentFormHandle) -> Unit, onFailed: () -> Unit)

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

    override fun consentFormRequired() =
        info.consentStatus == ConsentInformation.ConsentStatus.REQUIRED && info.isConsentFormAvailable

    override fun loadConsentForm(onLoaded: (ConsentFormHandle) -> Unit, onFailed: () -> Unit) {
        UserMessagingPlatform.loadConsentForm(context, { form ->
            onLoaded { activity, onDone ->
                form.show(activity) { error ->
                    if (error != null) Log.w(TAG, "consent form_failed")
                    onDone(error != null)
                }
            }
        }, {
            Log.w(TAG, "consent form_load_failed")
            onFailed()
        })
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
 * The consent flow and the Ads SDK start of an app open (the emi adapter's `init` with the plugin's `initialize`, #2871,
 * deferred SDK start #3234): UMP is updated and the consent form shows when required as soon as the tabs open. Once ads
 * may be requested, the SDK start is scheduled through [startScheduler] (by default after the first content frame, a
 * short post-frame delay, and a main-thread idle point) so `WebViewChromium.init` does not block early interactions.
 * When UMP fails, release builds show no ads, as Google's consent guidance asks; debug builds, which use Google's test
 * units, schedule the SDK start without UMP once, unless the failure is a consent decision ([releaseAds]). [onReady]
 * runs once the SDK has started. The form loads without an activity and shows on the activity shown when it has loaded
 * ([start], [stop]), as the plugin loaded it and then showed it: an update or a form answered after a configuration
 * change, or a form lost with its activity, shows on the next one. A pending deferred SDK start is cancelled when its
 * activity stops and re-scheduled on the next activity so the SDK starts at most once without leaking the old activity.
 */
class AdsConsent(
    private val platform: AdsPlatform,
    private val releaseAds: Boolean,
    private val track: (String, Map<String, Any?>) -> Boolean,
    private val startScheduler: SdkStartScheduler = AfterFirstFrameIdleScheduler(),
    private val onReady: () -> Unit = {},
) {
    private val requestAllowed = MutableStateFlow(false)
    val allowed = requestAllowed.asStateFlow()
    private var privacyActivity: Activity? = null
    internal val nativeAllowed: Boolean get() = privacyActivity == null && allowed.value
    private var sdkReady = false
    private var requested = false
    private var updated = false
    private var formDone = false
    private var formLoading = false
    private var loadedForm: ConsentFormHandle? = null
    private var formActivity: Activity? = null
    private var current: Activity? = null
    private var started = false
    private var pendingStart: CancelHandle? = null
    private var drawObserver: CancelHandle? = null
    private var startGeneration = 0
    private var fellBack = false

    /**
     * An activity is shown: the first one of the app open runs the flow, a later one shows a form still due and
     * schedules what consent allows.
     */
    fun start(activity: Activity) {
        val previous = current
        current = activity
        if (previous != null && previous !== activity) {
            cancelPendingStart()
            cancelDrawObserver()
        }
        if (!started && drawObserver == null) {
            drawObserver = startScheduler.observeFirstDraw(activity)
        }
        if (!requested) {
            requested = true
            platform.requestConsentUpdate(activity, onUpdated = {
                updated = true
                showForm()
                startIfAllowed()
            }, onFailed = { reason ->
                startIfAllowed()
                consentFailed(reason)
            })
        } else if (updated && !formDone) {
            showForm()
        }
        startIfAllowed()
    }

    /** The activity is gone, with any form it showed and any pending deferred SDK start. */
    fun stop(activity: Activity) {
        if (current === activity) {
            current = null
            cancelDrawObserver()
        }
        if (formActivity === activity) formActivity = null
        if (privacyActivity === activity) privacyActivity = null
        if (current == null && privacyActivity == null) cancelPendingStart()
    }

    /** The plugin's `handleConsentForm`: the form when consent is required, loaded, then shown. */
    private fun showForm() {
        if (formDone || formLoading || formActivity != null) return
        loadedForm?.let { return show(it) }
        if (!platform.consentFormRequired()) {
            formDone = true
            return
        }
        formLoading = true
        platform.loadConsentForm(onLoaded = { form ->
            formLoading = false
            loadedForm = form
            show(form)
        }, onFailed = {
            formLoading = false
            formDone = true
            startIfAllowed()
        })
    }

    /** Shows the loaded [form] on the activity shown now; without one, the next activity shows it. */
    private fun show(form: ConsentFormHandle) {
        val activity = current?.takeUnless { it.isFinishing || it.isDestroyed } ?: return
        loadedForm = null
        formActivity = activity
        form.show(activity) { failed ->
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
    fun openPrivacyOptions(activity: Activity, onNativeEligibilityChanged: () -> Unit = {}, onUnavailable: () -> Unit) {
        if (privacyActivity != null) return
        val required = try {
            platform.privacyOptionsRequired()
        } catch (_: Exception) {
            false
        }
        if (!required) return onUnavailable()

        // UMP can keep canRequestAds() true across a personalization change. Discard the old cards before showing it.
        privacyActivity = activity
        onNativeEligibilityChanged()
        var settled = false
        fun finish(shown: Boolean) {
            if (settled || privacyActivity !== activity) return
            settled = true
            fellBack = false
            val updated = try {
                startIfAllowed()
                true
            } catch (_: Exception) {
                cancelPendingStart()
                requestAllowed.value = false
                false
            }
            privacyActivity = null
            onNativeEligibilityChanged()
            if (!shown || !updated) {
                Log.w(TAG, "privacy ad_choices form_unavailable")
                onUnavailable()
            }
        }
        try {
            platform.showPrivacyOptionsForm(activity, ::finish)
        } catch (_: Exception) {
            finish(false)
        }
    }

    private fun startIfAllowed() {
        val consent = platform.canRequestAds()
        if (consent || fellBack) {
            scheduleStartSdk()
        } else {
            cancelPendingStart()
        }
        requestAllowed.value = sdkReady && (consent || fellBack)
    }

    private fun consentFailed(reason: String) {
        Log.w(TAG, "consent ump_error retain_gate")
        track("ad_lifecycle", mapOf("action" to "consent_failed", "ad_format" to "banner"))
        // A consent decision is never bypassed.
        if (releaseAds || fellBack || CONSENT_DECISION.containsMatchIn(reason)) return
        fellBack = true
        scheduleStartSdk()
    }

    private fun scheduleStartSdk() {
        if (started || pendingStart != null) return
        val active = current ?: privacyActivity
        if (active == null || active.isFinishing || active.isDestroyed) return
        val generation = ++startGeneration
        var settled = false
        val handle = startScheduler.schedule(active) {
            if (generation != startGeneration || settled) return@schedule
            settled = true
            pendingStart = null
            val live = current ?: privacyActivity
            if (live == null || live.isFinishing || live.isDestroyed) return@schedule
            startSdkNow()
        }
        if (!settled && !started && generation == startGeneration) {
            pendingStart = handle
        }
    }

    private fun cancelPendingStart() {
        startGeneration++
        val handle = pendingStart ?: return
        pendingStart = null
        handle.cancel()
    }

    private fun cancelDrawObserver() {
        val handle = drawObserver ?: return
        drawObserver = null
        handle.cancel()
    }

    private fun startSdkNow() {
        if (started) return
        if (!platform.canRequestAds() && !fellBack) return
        started = true
        cancelDrawObserver()
        Trace.beginSection(TRACE_START_SDK)
        try {
            platform.startSdk {
                sdkReady = true
                requestAllowed.value = platform.canRequestAds() || fellBack
                onReady()
            }
        } finally {
            Trace.endSection()
        }
    }

    companion object {
        private val CONSENT_DECISION = Regex("consent is required|status unknown", RegexOption.IGNORE_CASE)
        internal const val TRACE_START_SDK = "ads.startSdk"
    }
}

private const val TAG = "TwAds"
