package net.wizardfactory.todayweather

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.concurrent.ExecutionException
import net.wizardfactory.todayweather.notify.PushMessage

/**
 * FCM entry point. Token changes are registered as the Cordova app's token callback does. A message FCM hands over (one
 * that arrived while the app was in the foreground, or a data message) goes to the open page as O07, else it is posted
 * as firebasex did ([TodayWeatherApp.receive], AN-14); FCM itself posts the notification messages of an app in the
 * background, on the channel the manifest names.
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

    override fun onMessageReceived(message: RemoteMessage) {
        (application as TodayWeatherApp).receive(PushMessage.of(message))
    }
}
