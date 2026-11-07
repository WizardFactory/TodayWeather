package net.wizardfactory.todayweather

import com.google.firebase.messaging.FirebaseMessagingService
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.storage.AppStateStore

/**
 * FCM entry point. Token changes are registered as the Cordova app's token callback does; showing and
 * opening notifications is AN-14's work (until then the system shows notification messages).
 */
class MessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as TodayWeatherApp
        app.appScope.launch {
            app.migration.await()
            app.pushStartup.await() // the start-time registration goes first
            val state = AppStateStore.get(app).data.first() // includes a token stored by the start
            PushStartup(app, app.serverUrl(), app.tokenSource(), app.pushTransport()).onNewToken(state, token)
        }
    }
}
