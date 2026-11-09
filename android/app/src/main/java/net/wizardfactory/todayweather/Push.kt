package net.wizardfactory.todayweather

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.DeviceIdentity
import net.wizardfactory.todayweather.core.storage.PushRegistration

/** The current FCM registration token, or null when Firebase is not configured or the token is unavailable. */
fun interface TokenSource {
    suspend fun token(): String?
}

class FirebaseTokenSource(private val context: Context) : TokenSource {
    override suspend fun token(): String? {
        if (FirebaseApp.getApps(context).isEmpty()) return null
        // The start registration waits for the token while it holds the push lock; an unreachable FCM must not keep it.
        return try {
            withTimeoutOrNull(30_000) { FirebaseMessaging.getInstance().token.await() }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            null
        }
    }
}

/** The request context of [PushRegistration], or null (no requests) without a server URL or device id. */
fun pushContext(context: Context, serverUrl: String, state: AppState, now: Long = System.currentTimeMillis()): PushRegistration.Context? {
    if (serverUrl.isBlank()) return null
    return PushRegistration.Context(
        deviceId = DeviceIdentity.deviceId(context) ?: return null,
        language = Locale.getDefault().toLanguageTag(),
        appVersion = BuildConfig.VERSION_NAME,
        units = state.units,
        nowMillis = now,
        zone = TimeZone.getDefault(),
    )
}
