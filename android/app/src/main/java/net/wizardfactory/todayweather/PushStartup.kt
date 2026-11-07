package net.wizardfactory.todayweather

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.tasks.await
import net.wizardfactory.todayweather.core.data.PushTransport
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.core.storage.DeviceIdentity
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushRequest

/** The current FCM registration token, or null when Firebase is not configured or the token is unavailable. */
fun interface TokenSource {
    suspend fun token(): String?
}

class FirebaseTokenSource(private val context: Context) : TokenSource {
    override suspend fun token(): String? {
        if (FirebaseApp.getApps(context).isEmpty()) return null
        return runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
    }
}

/**
 * On every start, after the migration: what the Cordova `Push.init` does (token replacement, first-token
 * post, 3-second repost of the list), through [PushRegistration]. The stored token is updated as the
 * Cordova app does, whether or not the request succeeded.
 */
class PushStartup(
    private val context: Context,
    private val serverUrl: String,
    private val tokens: TokenSource,
    private val transport: PushTransport,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    data class Outcome(val requests: List<PushRequest>, val statuses: List<Int?>)

    suspend fun run(state: AppState): Outcome? {
        val ctx = context(state) ?: return null
        return send(state, PushRegistration.onStart(state.push, state.places, tokens.token(), ctx))
    }

    /** A token delivered while the app runs. */
    suspend fun onNewToken(state: AppState, token: String): Outcome? {
        val ctx = context(state) ?: return null
        return send(state, PushRegistration.onTokenRefresh(state.push, state.places, token, ctx))
    }

    private fun context(state: AppState): PushRegistration.Context? {
        if (serverUrl.isBlank()) return null // no server configured: no requests
        return PushRegistration.Context(
            deviceId = DeviceIdentity.deviceId(context) ?: return null,
            language = Locale.getDefault().toLanguageTag(),
            appVersion = BuildConfig.VERSION_NAME,
            units = state.units,
            nowMillis = clock(),
            zone = TimeZone.getDefault(),
        )
    }

    private suspend fun send(state: AppState, result: PushRegistration.Result): Outcome {
        val statuses = result.requests.map { transport.send(it) }
        if (result.state.fcmToken != state.push.fcmToken) {
            AppStateStore.get(context).updateData { it.copy(push = it.push.copy(fcmToken = result.state.fcmToken)) }
        }
        return Outcome(result.requests, statuses)
    }
}
