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
 * written with `commit()`. The Cordova app kept the choice in WebView storage and the plugin persisted the collection
 * flag on its own: a grant restores at the start only when both still hold it, so a withdrawal whose choice could not
 * be written still holds after a restart when the collection state was written. Since the region default
 * (2026-11-24) a missing choice can collect, so a withdrawal that could not be written is also recorded beside the
 * collection state ([DECLINED]) and counts as `"false"` at the next start.
 */
class ConsentStore(private val choices: SharedPreferences, private val collection: SharedPreferences) {
    constructor(context: Context) : this(
        context.getSharedPreferences(CHOICE_FILE, Context.MODE_PRIVATE),
        context.getSharedPreferences(COLLECTION_FILE, Context.MODE_PRIVATE),
    )

    /**
     * The stored choice at the start (`init`): `"true"`, `"false"`, none, or another value ([UNREADABLE] when the
     * choice cannot be read), which does not collect. A recorded withdrawal that could not be written is `"false"`
     * and is written now; a grant the collection state does not confirm is withdrawn and written so.
     */
    fun startChoice(): String? {
        // A record that cannot be read counts as a withdrawal: any state the start cannot read leaves collection off.
        if (runCatching { collection.getBoolean(DECLINED, false) }.getOrDefault(true)) {
            write(false)
            return "false"
        }
        val stored = runCatching { choices.getString(KEY, null) }.getOrElse { return UNREADABLE }
        if (stored != "true") return stored
        if (runCatching { collection.getBoolean(ENABLED, false) }.getOrDefault(false)) return stored
        write(false)
        return "false"
    }

    /**
     * Writes the choice (`persistChoice`). When a withdrawal cannot be written it records it beside the collection state
     * ([DECLINED]) first, so the region default cannot turn it back on even if the process ends here, and then removes the
     * choice, so an old grant cannot survive. When a grant cannot be written the stored choice stays as it was, so a
     * decline is never erased into "no choice" (the grant's collection state is not recorded, so an old grant is
     * withdrawn at the next start).
     */
    fun write(value: Boolean): Boolean {
        if (choices.edit().putString(KEY, value.toString()).commit()) {
            if (runCatching { collection.contains(DECLINED) }.getOrDefault(true)) collection.edit().remove(DECLINED).commit()
            return true
        }
        if (!value) {
            collection.edit().putBoolean(DECLINED, true).commit()
            choices.edit().remove(KEY).commit()
        }
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

        /** A withdrawal whose choice could not be written (in the collection file). */
        const val DECLINED = "declinePending"

        /** [startChoice] when the stored choice cannot be read. */
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
) {
    private val choiceFlow = MutableStateFlow(false)
    private var enabled = false
    private var started = false
    private var lastScreen: String? = null
    private var pendingScreen: String? = null

    /** Whether it collects, as the menu row shows it (켜짐 or 꺼짐). */
    val choice: StateFlow<Boolean> = choiceFlow.asStateFlow()

    /** The start's region keeps the opt-in (the popup asks for consent); false where usage analytics is on by default. */
    @Volatile
    var optInRegion: Boolean = true
        private set

    /**
     * `init` at `platformReady`, before Firebase starts collecting (EarlyStartProvider): the stored choice, else the
     * region's default. A failure while applying the default leaves everything off and stores nothing, so the next
     * start applies it again.
     */
    @Synchronized
    fun start() {
        if (started) return
        started = true
        val stored = store.startChoice()
        val region = runCatching { region() }.getOrNull()
        optInRegion = !AnalyticsDefault.onByDefault(region)
        choiceFlow.value = AnalyticsDefault.collects(stored, region)
        applyCollection(choiceFlow.value, storeOnFailure = stored != null)
    }

    /**
     * The choice of the dialog (`setCollectionEnabled`): collection stops at once (a withdrawal also turns the SDK off
     * and denies every consent type before any file is written), the choice is written, then applied. False when it
     * could not be fully applied (`LOC_PRIVACY_SAVE_FAILED`); the choice is then off.
     */
    @Synchronized
    fun setCollectionEnabled(value: Boolean): Boolean {
        enabled = false
        pendingScreen = null
        if (!value) stopSdk()
        val saved = store.write(value)
        choiceFlow.value = saved && value
        return applyCollection(choiceFlow.value) && saved
    }

    /** An event of the schema with its own fields only; false when it is dropped or not sent. */
    @Synchronized
    fun track(name: String, params: Map<String, Any?>): Boolean {
        val safe = AnalyticsSchema.validate(name, params) ?: return false
        return emit(name, safe)
    }

    /**
     * A route shown (`$stateChangeSuccess`): only while collecting, only the fixed names, not the same one twice in a row.
     * The latest one before collection is enabled is sent once it is.
     */
    @Synchronized
    fun screen(name: String) {
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

    /** An app open: a new Cordova page, whose first screen counts again. */
    @Synchronized
    fun onOpened() {
        lastScreen = null
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
     * Collection off and the consent mode first, then the collection state; when collecting, the state is recorded before
     * the SDK collects. Any failure turns the SDK off and denies every consent type before it writes anything, and, for a
     * stored or chosen value ([storeOnFailure]), then writes a withdrawal.
     */
    private fun applyCollection(value: Boolean, storeOnFailure: Boolean = true): Boolean {
        enabled = false
        lastScreen = null
        try {
            sdk.setCollectionEnabled(false)
            sdk.setConsent(value)
            store.recordCollection(false)
            if (!value) return true
            check(store.recordCollection(true)) { "collection state not written" }
            sdk.setCollectionEnabled(true)
            enabled = true
            pendingScreen?.let(::screen)
            return true
        } catch (e: Exception) {
            stopSdk()
            choiceFlow.value = false
            pendingScreen = null
            Log.w(TAG, "collection write_failed")
            store.recordCollection(false)
            if (storeOnFailure) store.write(false)
            return false
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
