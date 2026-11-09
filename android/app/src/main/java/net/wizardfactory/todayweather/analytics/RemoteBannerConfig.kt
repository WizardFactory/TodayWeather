package net.wizardfactory.todayweather.analytics

import android.util.Log
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.domain.ads.BannerPolicy
import net.wizardfactory.todayweather.core.domain.ads.RemoteBannerPolicy

/** The Remote Config calls of `Monetization.loadConfig` (the plugin's bridge); each answers once on the main thread. */
interface RemoteConfigSource {
    fun setDefaults(defaults: Map<String, Any>, done: (Boolean) -> Unit)
    fun setSettings(fetchTimeoutSeconds: Long, minimumFetchIntervalSeconds: Long, done: (Boolean) -> Unit)

    /** The stored activated values loaded (an offline start keeps the last fetched policy). */
    fun loadActivated(done: (Boolean) -> Unit)
    fun fetchAndActivate(done: (Boolean) -> Unit)

    /** The activated values and defaults as strings (`getAll`). */
    fun values(): Map<String, String>
}

class FirebaseRemoteConfigSource(private val config: FirebaseRemoteConfig) : RemoteConfigSource {
    override fun setDefaults(defaults: Map<String, Any>, done: (Boolean) -> Unit) {
        config.setDefaultsAsync(defaults).addOnCompleteListener { done(it.isSuccessful) }
    }

    override fun setSettings(fetchTimeoutSeconds: Long, minimumFetchIntervalSeconds: Long, done: (Boolean) -> Unit) {
        val settings = FirebaseRemoteConfigSettings.Builder().setFetchTimeoutInSeconds(fetchTimeoutSeconds)
            .setMinimumFetchIntervalInSeconds(minimumFetchIntervalSeconds).build()
        config.setConfigSettingsAsync(settings).addOnCompleteListener { done(it.isSuccessful) }
    }

    override fun loadActivated(done: (Boolean) -> Unit) {
        config.ensureInitialized().addOnCompleteListener { done(it.isSuccessful) }
    }

    override fun fetchAndActivate(done: (Boolean) -> Unit) {
        config.fetchAndActivate().addOnCompleteListener { done(it.isSuccessful) }
    }

    override fun values(): Map<String, String> = config.all.mapValues { it.value.asString() }
}

/**
 * The banner policy of an app open (`Monetization.loadConfig`): the defaults, then the activated values, then a fetch;
 * each valid pair applies. It is ready ([State.ready]) when the fetch has applied or failed, or after 12 s; answers
 * after that are ignored. Without Firebase ([source] null) the defaults apply at once.
 */
class RemoteBannerConfig(private val source: RemoteConfigSource?, private val scope: CoroutineScope) {
    data class State(val policy: BannerPolicy, val ready: Boolean)

    private val state = MutableStateFlow(State(BannerPolicy.DEFAULT, ready = false))
    private var started = false
    private var closed = false
    private var timeout: Job? = null

    val policy: StateFlow<State> = state.asStateFlow()

    fun load() {
        if (started) return
        started = true
        if (source == null) {
            state.value = State(BannerPolicy.DEFAULT, ready = true)
            return
        }
        timeout = scope.launch {
            delay(TIMEOUT_MS)
            finish("timeout")
        }
        try {
            source.setDefaults(RemoteBannerPolicy.DEFAULTS) { ok ->
                if (closed) return@setDefaults
                if (!ok) return@setDefaults fail()
                source.setSettings(FETCH_TIMEOUT_S, MINIMUM_INTERVAL_S) { set ->
                    if (closed) return@setSettings
                    if (!set) return@setSettings fail()
                    // The activated values first, so an offline start keeps the kill switch.
                    source.loadActivated { loaded ->
                        if (closed) return@loadActivated
                        if (!loaded) return@loadActivated fail()
                        apply(source.values())
                        source.fetchAndActivate { fetched ->
                            if (closed) return@fetchAndActivate
                            if (!fetched) return@fetchAndActivate fail()
                            apply(source.values())
                            finish("applied")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            fail()
        }
    }

    /** A valid pair applies whole; an invalid one is ignored (`invalid_values`). */
    private fun apply(values: Map<String, String>) {
        val policy = RemoteBannerPolicy.parse(values)
        if (policy == null) {
            Log.i(TAG, "remote_config invalid_values")
            return
        }
        state.value = state.value.copy(policy = policy)
    }

    private fun fail() = finish("bridge_or_fetch_failed")

    private fun finish(result: String) {
        if (closed) return
        closed = true
        timeout?.cancel()
        Log.i(TAG, "remote_config $result")
        state.value = state.value.copy(ready = true)
    }

    companion object {
        const val TIMEOUT_MS = 12_000L
        const val FETCH_TIMEOUT_S = 10L
        const val MINIMUM_INTERVAL_S = 3600L
        private const val TAG = "TwAnalytics"
    }
}
