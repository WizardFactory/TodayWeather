package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.wizardfactory.todayweather.core.domain.analytics.AnalyticsDefault
import net.wizardfactory.todayweather.core.domain.analytics.AnalyticsSchema

/** The Firebase Analytics calls the app makes (the Cordova plugin's bridge). */
interface AnalyticsSdk {
    fun setCollectionEnabled(enabled: Boolean)

    /** Consent mode: analytics storage as [analytics]; ad storage, ad user data and ad personalization always denied. */
    fun setConsent(analytics: Boolean)

    fun logEvent(name: String, params: Map<String, Any>)
}

class FirebaseAnalyticsSdk(private val context: Context) : AnalyticsSdk {
    private val analytics get() = FirebaseAnalytics.getInstance(context)

    override fun setCollectionEnabled(enabled: Boolean) = analytics.setAnalyticsCollectionEnabled(enabled)

    override fun setConsent(analytics: Boolean) {
        val denied = FirebaseAnalytics.ConsentStatus.DENIED
        this.analytics.setConsent(
            mapOf(
                FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE to if (analytics) FirebaseAnalytics.ConsentStatus.GRANTED else denied,
                FirebaseAnalytics.ConsentType.AD_STORAGE to denied,
                FirebaseAnalytics.ConsentType.AD_USER_DATA to denied,
                FirebaseAnalytics.ConsentType.AD_PERSONALIZATION to denied,
            ),
        )
    }

    override fun logEvent(name: String, params: Map<String, Any>) = analytics.logEvent(name, Bundle().apply {
        params.forEach { (key, value) -> if (value is Long) putLong(key, value) else putString(key, value.toString()) }
    })
}

/**
 * The usage analytics choice (`twAnalyticsConsentV1`) and the SDK's collection state, in two private preference files
 * written with `commit()` and read only through SharedPreferences. The Cordova app kept the choice in WebView storage and
 * the plugin persisted the collection flag on its own: a grant restores at the start only when both still hold it, so a
 * withdrawal whose choice could not be written still holds after a restart when the collection state was written.
 * Failure or corruption of these private files is outside the guarantee (specs/analytics-default-on.md): Android loads a
 * damaged file as empty, which reads as "no choice", so the region default may apply.
 */
class ConsentStore(private val choices: SharedPreferences, private val collection: SharedPreferences) {
    constructor(context: Context) : this(
        context.getSharedPreferences(CHOICE_FILE, Context.MODE_PRIVATE),
        context.getSharedPreferences(COLLECTION_FILE, Context.MODE_PRIVATE),
    )

    /**
     * The stored choice at the start (`init`): `"true"`, `"false"`, none, or another value ([UNREADABLE] when a record
     * cannot be read), which does not collect. A grant the collection state does not confirm is withdrawn and written so.
     */
    fun startChoice(): String? {
        val stored = runCatching { choices.getString(KEY, null) }.getOrElse { return UNREADABLE }
        val enabled = runCatching { collection.getBoolean(ENABLED, false) }.getOrElse { return UNREADABLE }
        if (stored != "true") return stored
        if (enabled) return stored
        write(false)
        return "false"
    }

    /**
     * Writes the choice (`persistChoice`). When that fails the stored value stays as it was: a failed grant keeps a
     * decline, and an old grant after a failed withdrawal is withdrawn at the next start, because the collection state
     * recorded for this session says off.
     */
    fun write(value: Boolean): Boolean {
        if (choices.edit().putString(KEY, value.toString()).commit()) return true
        Log.w(TAG, "collection storage_write_failed")
        return false
    }

    /** The stored choice as written (`"true"`, `"false"` or none), for the hand-back (AN-17). */
    fun storedChoice(): String? = runCatching { choices.getString(KEY, null) }.getOrNull()

    /** The collection state after the SDK calls (the flag the plugin persisted). */
    fun recordCollection(enabled: Boolean): Boolean = collection.edit().putBoolean(ENABLED, enabled).commit()

    companion object {
        const val KEY = "twAnalyticsConsentV1"
        const val ENABLED = "collectionEnabled"

        /** [startChoice] when a record cannot be read. */
        const val UNREADABLE = "unreadable"
        const val CHOICE_FILE = "tw_analytics_consent"
        const val COLLECTION_FILE = "tw_analytics_collection"
    }
}

/**
 * `Monetization` (service.monetization.js) without the bridge's callbacks: the SDK calls are synchronous here.
 * Collection follows [AnalyticsDefault] (AK 2026-11-24): a stored choice from the menu's 이용 통계 wins; without one it is
 * on by default for the device [region] outside the opt-in regions and off there until the user allows it. Collecting
 * grants analytics storage with advertising denied; events follow [AnalyticsSchema] and carry `measurement_version` and
 * [trafficType]. Applying the default writes no choice.
 */
class Analytics(
    private val sdk: AnalyticsSdk,
    private val store: ConsentStore,
    private val trafficType: String,
    /** The device region at the start (`TodayWeatherApp.deviceRegion`); null or empty when unknown. */
    private val region: () -> String?,
    /**
     * Commits the choice to the Cordova hand-back suite on the caller's serialized background writer before
     * enabling collection or returning success; defaults to a no-op when no suite is wired.
     */
    private val onChoiceWritten: () -> Boolean,
) {
    constructor(
        sdk: AnalyticsSdk,
        store: ConsentStore,
        trafficType: String,
        region: () -> String?,
    ) : this(sdk, store, trafficType, region, { true })

    enum class ChoiceOutcome { APPLIED, SUPERSEDED, FAILED }

    /** Serializes [start], [setCollectionEnabled], and [commitChoice] so consent transitions never interleave. */
    private val transitionLock = Any()

    /** Guards in-memory state, [choiceGeneration], and SDK calls; never held across SharedPreferences commits. */
    private val stateLock = Any()

    private val choiceFlow = MutableStateFlow(false)
    private val collectingFlow = MutableStateFlow(false)
    private var enabled = false
    private var started = false
    private var lastScreen: String? = null
    private var pendingScreen: String? = null
    private var choiceGeneration = 0L

    /** Whether it collects, as the menu row shows it (켜짐 or 꺼짐). */
    val choice: StateFlow<Boolean> = choiceFlow.asStateFlow()

    /** Whether the SDK is currently enabled and ready to log events. */
    val collecting: StateFlow<Boolean> = collectingFlow.asStateFlow()

    /** The start's region keeps the opt-in (the popup asks for consent); false where usage analytics is on by default. */
    @Volatile
    var optInRegion: Boolean = true
        private set

    /**
     * `init` at `platformReady`, before Firebase starts collecting (EarlyStartProvider): the stored choice, else the
     * region's default. A failure while applying the default leaves everything off and stores nothing, so the next
     * start applies it again.
     */
    fun start() {
        synchronized(transitionLock) {
            if (started) return
            started = true
            val stored = store.startChoice()
            val region = runCatching { region() }.getOrNull()
            optInRegion = !AnalyticsDefault.onByDefault(region)
            val collects = AnalyticsDefault.collects(stored, region)
            synchronized(stateLock) {
                choiceFlow.value = collects
            }
            applyCollection(collects, storeOnFailure = stored != null, generation = null)
        }
    }

    /**
     * Registers a new user choice generation under [stateLock] only (no [transitionLock], no disk I/O).
     * A withdrawal stops collection and the SDK immediately so no further events are logged while
     * [commitChoice] waits its turn on the background writer.
     */
    fun beginChoice(value: Boolean): Long = synchronized(stateLock) {
        val generation = ++choiceGeneration
        if (!value) {
            enabled = false
            collectingFlow.value = false
            choiceFlow.value = false
            pendingScreen = null
            stopSdk()
        }
        generation
    }

    /**
     * The choice of the dialog (`setCollectionEnabled`): collection stops at once (a withdrawal also turns the SDK off
     * and denies every consent type before any file is written), the choice and suite hand-back are written, then
     * applied. False when it could not be fully applied (`LOC_PRIVACY_SAVE_FAILED`); the choice is then off.
     */
    fun setCollectionEnabled(value: Boolean): Boolean = commitChoice(value, beginChoice(value)) == ChoiceOutcome.APPLIED

    /**
     * Persists and applies the choice registered by [beginChoice] under [transitionLock].
     * Commits the Cordova hand-back ([onChoiceWritten]) before enabling the SDK or returning [ChoiceOutcome.APPLIED],
     * and aborts without enabling collection if a newer [beginChoice] supersedes [generation].
     */
    fun commitChoice(value: Boolean, generation: Long): ChoiceOutcome = synchronized(transitionLock) {
        synchronized(stateLock) {
            if (choiceGeneration != generation) return ChoiceOutcome.SUPERSEDED
            enabled = false
            collectingFlow.value = false
            pendingScreen = null
            if (!value) {
                choiceFlow.value = false
            }
        }
        val saved = store.write(value)
        if (!isCurrent(generation)) return ChoiceOutcome.SUPERSEDED
        if (saved) {
            val handedBack = runCatching { onChoiceWritten() }.getOrElse { false }
            if (!isCurrent(generation)) return ChoiceOutcome.SUPERSEDED
            if (!handedBack) {
                if (value) {
                    val superseded = synchronized(stateLock) {
                        if (choiceGeneration != generation) {
                            true
                        } else {
                            enabled = false
                            collectingFlow.value = false
                            choiceFlow.value = false
                            pendingScreen = null
                            stopSdk()
                            false
                        }
                    }
                    if (superseded) return ChoiceOutcome.SUPERSEDED
                    store.recordCollection(false)
                    store.write(false)
                    runCatching { onChoiceWritten() }
                    return ChoiceOutcome.FAILED
                } else {
                    val outcome = applyCollection(false, storeOnFailure = false, generation = generation)
                    return if (outcome == ChoiceOutcome.SUPERSEDED) ChoiceOutcome.SUPERSEDED else ChoiceOutcome.FAILED
                }
            }
        }
        val collects = saved && value
        synchronized(stateLock) {
            if (choiceGeneration != generation) return ChoiceOutcome.SUPERSEDED
            choiceFlow.value = collects
            if (!collects) pendingScreen = null
        }
        // A grant that was not written keeps the stored choice, also when the SDK then fails (CODEX-3178-23).
        val applied = applyCollection(collects, storeOnFailure = saved || !value, generation = generation)
        when {
            applied == ChoiceOutcome.SUPERSEDED -> ChoiceOutcome.SUPERSEDED
            applied == ChoiceOutcome.APPLIED && saved -> ChoiceOutcome.APPLIED
            else -> ChoiceOutcome.FAILED
        }
    }

    /** An event of the schema with its own fields only; false when it is dropped or not sent. */
    fun track(name: String, params: Map<String, Any?>): Boolean = synchronized(stateLock) {
        val safe = AnalyticsSchema.validate(name, params) ?: return false
        emit(name, safe)
    }

    /**
     * A route shown (`$stateChangeSuccess`): only while collecting, only the fixed names, not the same one twice in a row.
     * The latest one before collection is enabled is sent once it is.
     */
    fun screen(name: String) = synchronized(stateLock) {
        screenLocked(name)
    }

    /** An app open: a new Cordova page, whose first screen counts again. */
    fun onOpened() = synchronized(stateLock) {
        lastScreen = null
    }

    private fun isCurrent(generation: Long): Boolean = synchronized(stateLock) { choiceGeneration == generation }

    private fun screenLocked(name: String) {
        if (!choiceFlow.value) {
            pendingScreen = null
            return
        }
        if (name !in AnalyticsSchema.SCREENS || name == lastScreen) return
        pendingScreen = name
        if (emit("screen_view", mapOf("screen_name" to name, "screen_class" to SCREEN_CLASS))) {
            lastScreen = name
            pendingScreen = null
        }
    }

    private fun emit(name: String, params: Map<String, Any>): Boolean {
        if (!enabled) return false
        return try {
            sdk.logEvent(name, params + mapOf("measurement_version" to AnalyticsSchema.MEASUREMENT_VERSION, "traffic_type" to trafficType))
            true
        } catch (e: Exception) {
            Log.w(TAG, "analytics bridge_error")
            false
        }
    }

    /**
     * Collection off and the consent mode first, then the collection state; when collecting, the state is recorded once
     * before the SDK collects (no intermediate false write). Any failure turns the SDK off and denies every consent type
     * before it writes anything, and, for a stored or chosen value ([storeOnFailure]), then writes a withdrawal.
     */
    private fun applyCollection(
        value: Boolean,
        storeOnFailure: Boolean = true,
        generation: Long? = null,
    ): ChoiceOutcome {
        try {
            synchronized(stateLock) {
                if (generation != null && choiceGeneration != generation) return ChoiceOutcome.SUPERSEDED
                enabled = false
                collectingFlow.value = false
                lastScreen = null
                sdk.setCollectionEnabled(false)
                sdk.setConsent(value)
            }
            if (!value) {
                store.recordCollection(false)
                return if (generation != null && !isCurrent(generation)) ChoiceOutcome.SUPERSEDED else ChoiceOutcome.APPLIED
            }
            check(store.recordCollection(true)) { "collection state not written" }
            val superseded = synchronized(stateLock) {
                if (generation != null && choiceGeneration != generation) {
                    enabled = false
                    collectingFlow.value = false
                    pendingScreen = null
                    stopSdk()
                    true
                } else {
                    sdk.setCollectionEnabled(true)
                    enabled = true
                    collectingFlow.value = true
                    pendingScreen?.let(::screenLocked)
                    false
                }
            }
            if (superseded) {
                store.recordCollection(false)
                return ChoiceOutcome.SUPERSEDED
            }
            return ChoiceOutcome.APPLIED
        } catch (e: Exception) {
            val superseded = synchronized(stateLock) {
                if (generation != null && choiceGeneration != generation) {
                    true
                } else {
                    enabled = false
                    collectingFlow.value = false
                    stopSdk()
                    choiceFlow.value = false
                    pendingScreen = null
                    false
                }
            }
            if (superseded) return ChoiceOutcome.SUPERSEDED
            Log.w(TAG, "collection write_failed")
            store.recordCollection(false)
            if (storeOnFailure) {
                store.write(false)
                runCatching { onChoiceWritten() }
            }
            return ChoiceOutcome.FAILED
        }
    }

    /** The SDK off with every consent type denied, each call on its own so one failure does not skip the other. */
    private fun stopSdk() {
        runCatching { sdk.setCollectionEnabled(false) }.onFailure { Log.w(TAG, "collection rollback_failed") }
        runCatching { sdk.setConsent(false) }.onFailure { Log.w(TAG, "collection rollback_failed") }
    }

    companion object {
        /** `screen_class` of the Cordova build's screen views, kept so reports continue (B16). */
        const val SCREEN_CLASS = "Cordova"
    }
}

private const val TAG = "TwAnalytics"
