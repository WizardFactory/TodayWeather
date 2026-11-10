package org.apache.cordova.firebasex

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import net.wizardfactory.todayweather.notify.NotificationTaps

/**
 * The tap targets of notifications the Cordova build posted itself (firebasex 2.0.3, while the app was in the foreground
 * without its callback): their pending intents name these classes, so a notification still in the tray after the update
 * opens the app (AN-14). Each forwards the notification's extras to the launcher activity as firebasex did.
 */
private fun forward(context: Context, intent: Intent) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.extras?.let(launch::putExtras)
    launch.putExtra(NotificationTaps.MARKER, true)
    context.startActivity(launch)
}

/** firebasex's target on Android 12 and later. */
class OnNotificationReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        forward(this, intent)
        finish()
    }
}

/** firebasex's target below Android 12. */
class OnNotificationOpenReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = forward(context, intent)
}
