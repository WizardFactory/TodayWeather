package net.wizardfactory.todayweather

import com.google.firebase.messaging.FirebaseMessagingService
import java.util.concurrent.ExecutionException

/**
 * FCM entry point. Token changes are registered as the Cordova app's token callback does; showing and
 * opening notifications is AN-14's work (until then the system shows notification messages).
 */
class MessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // Called on a background thread: return once WorkManager has stored the work. If it cannot store it,
        // the next app open registers the current token.
        try {
            PushTokenWorker.enqueue(this, token).result.get()
        } catch (_: ExecutionException) {
        }
    }
}
