package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
 * be written still holds after a restart when the collection state was written.
 */
class ConsentStore(private val choices: SharedPreferences, private val collection: SharedPreferences) {
    constructor(context: Context) : this(
        context.getSharedPreferences(CHOICE_FILE, Context.MODE_PRIVATE),
        context.getSharedPreferences(COLLECTION_FILE, Context.MODE_PRIVATE),
    )

    /** The choice at the start (`init`); a grant the collection state does not confirm is withdrawn and written so. */
    fun startChoice(): Boolean {
        if (runCatching { choices.getString(KEY, null) }.getOrNull() != "true") return false
        if (runCatching { collection.getBoolean(ENABLED, false) }.getOrDefault(false)) return true
        write(false)
        return false
    }

    /** Writes the choice (`persistChoice`); when that fails it removes the choice, so an old grant cannot survive. */
    fun write(value: Boolean): Boolean {
        if (choices.edit().putString(KEY, value.toString()).commit()) return true
        choices.edit().remove(KEY).commit()
        Log.w(TAG, "collection storage_write_failed")
        return false
    }

    /** The collection state after the SDK calls (the flag the plugin persisted). */
    fun recordCollection(enabled: Boolean): Boolean = collection.edit().putBoolean(ENABLED, enabled).commit()

    companion object {
        const val KEY = "twAnalyticsConsentV1"
        const val ENABLED = "collectionEnabled"
        const val CHOICE_FILE = "tw_analytics_consent"
        const val COLLECTION_FILE = "tw_analytics_collection"
    }
}

/**
 * `Monetization` (service.monetization.js) without the bridge's callbacks: the SDK calls are synchronous here.
 * Collection runs only after an explicit opt-in on the menu's 선택적 이용 통계, with analytics storage granted and
 * advertising denied; events follow [AnalyticsSchema] and carry `measurement_version` and [trafficType].
 */
class Analytics(private val sdk: AnalyticsSdk, private val store: ConsentStore, private val trafficType: String) {
    private val choiceFlow = MutableStateFlow(false)
    private var enabled = false
    private var started = false
    private var lastScreen: String? = null
    private var pendingScreen: String? = null

    /** The choice the menu row shows (동의함 or 꺼짐). */
    val choice: StateFlow<Boolean> = choiceFlow.asStateFlow()

    /** `init` at `platformReady`: applies the stored choice before Firebase starts collecting (EarlyStartProvider). */
    @Synchronized
    fun start() {
        if (started) return
        started = true
        choiceFlow.value = store.startChoice()
        applyCollection(choiceFlow.value)
    }

    /**
     * The choice of the dialog (`setCollectionEnabled`): collection stops at once, the choice is written, then applied.
     * False when it could not be fully applied (`LOC_PRIVACY_SAVE_FAILED`); the choice is then off.
     */
    @Synchronized
    fun setCollectionEnabled(value: Boolean): Boolean {
        enabled = false
        pendingScreen = null
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
     * A route shown (`$stateChangeSuccess`): only after an opt-in, only the fixed names, not the same one twice in a row.
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

    /** Collection off, the consent mode, then collection on for a grant; any failure leaves everything off. */
    private fun applyCollection(value: Boolean): Boolean {
        enabled = false
        lastScreen = null
        try {
            sdk.setCollectionEnabled(false)
            store.recordCollection(false)
            sdk.setConsent(value)
            if (!value) return true
            sdk.setCollectionEnabled(true)
            check(store.recordCollection(true)) { "collection state not written" }
            enabled = true
            pendingScreen?.let(::screen)
            return true
        } catch (e: Exception) {
            choiceFlow.value = false
            pendingScreen = null
            store.write(false)
            Log.w(TAG, "collection write_failed")
            runCatching { sdk.setCollectionEnabled(false) }
            store.recordCollection(false)
            runCatching { sdk.setConsent(false) }.onFailure { Log.w(TAG, "collection rollback_failed") }
            return false
        }
    }

    companion object {
        /** `screen_class` of the Cordova build's screen views, kept so reports continue (B16). */
        const val SCREEN_CLASS = "Cordova"
    }
}

private const val TAG = "TwAnalytics"
