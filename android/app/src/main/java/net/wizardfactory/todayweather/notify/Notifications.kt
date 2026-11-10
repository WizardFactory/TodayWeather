package net.wizardfactory.todayweather.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.RemoteMessage
import kotlin.random.Random
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.MainActivity
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.NotificationAccess
import net.wizardfactory.todayweather.core.domain.alarms.NotificationTap
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The notification channel of the Cordova build (AN-14): firebasex's default, `fcm_default_channel` named "Default", which
 * every notification used. It is created only when missing, so a channel the Cordova build left keeps the user's settings
 * (firebasex deleted and recreated it at every start, which Android restores with them); the manifest names it for the
 * notifications FCM posts itself.
 */
object NotificationChannels {
    const val ID = "fcm_default_channel"
    const val NAME = "Default"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(ID) != null) return
        // firebasex's defaults for a channel with only an id and a name.
        manager.createNotificationChannel(NotificationChannel(ID, NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = ""
            enableLights(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
        })
    }
}

/**
 * A message as firebasex reads it: a notification message's title and body, the data's `notification_title` and
 * `notification_body` over them, its id (the message id, `notification_android_id`, else a random number up to 50) and
 * whether it asks to show in the foreground too (`notification_foreground`).
 */
data class PushMessage(val title: String?, val body: String?, val data: Map<String, String>, val id: String, val foreground: Boolean) {
    val hasText: Boolean get() = !title.isNullOrEmpty() || !body.isNullOrEmpty()

    companion object {
        fun of(message: RemoteMessage): PushMessage {
            val notification = message.notification
            val data = message.data
            var title = notification?.title
            var body = notification?.body
            var id = if (notification != null) message.messageId else null
            data["notification_title"]?.let { title = it }
            data["notification_body"]?.let { body = it }
            data["notification_android_id"]?.let { id = it }
            return PushMessage(title, body, data, id?.takeIf { it.isNotEmpty() } ?: (Random.nextInt(50) + 1).toString(),
                "notification_foreground" in data)
        }
    }
}

/**
 * Messages while the app is open (O07): the shown activity marks itself [resumed], and the open tabs take a message
 * ([offer]). firebasex's rule: with the app in the foreground and its callback listening, a message goes to the page
 * (O07) and posts no notification unless it asks to.
 */
class ForegroundNotifications {
    @Volatile var resumed = false
    private val _messages = MutableSharedFlow<PushMessage>(extraBufferCapacity = 8)
    val messages: SharedFlow<PushMessage> = _messages.asSharedFlow()

    /** True when an open page took [message]. */
    fun offer(message: PushMessage): Boolean = resumed && _messages.subscriptionCount.value > 0 && _messages.tryEmit(message)
}

/**
 * Posts a message as firebasex did when the page did not take it: big text, high priority, public, auto-cancel, the app
 * icon, the color #FFFFFF, on the Cordova channel; its tap opens the app with the message's data ([NotificationTaps]).
 * Nothing without a title or body, or without the notification permission (Android 13+).
 */
object NotificationPoster {
    fun post(context: Context, message: PushMessage) {
        if (!message.hasText) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationChannels.ensure(context)
        val extras = Bundle().apply {
            message.data.forEach { (k, v) -> putString(k, v) }
            putString("messageType", if (message.title != null || message.body != null) "notification" else "data")
            putString("id", message.id)
            message.title?.let { putString("title", it) }
            message.body?.let { putString("body", it) }
            putBoolean(NotificationTaps.MARKER, true)
        }
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK).putExtras(extras)
        val pending = PendingIntent.getActivity(context, message.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, NotificationChannels.ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(message.title)
            .setContentText(message.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.body))
            .setColor(0xFFFFFFFF.toInt())
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        NotificationManagerCompat.from(context).notify(message.id.hashCode(), notification)
    }
}

/**
 * Notification taps (AN-14): the launcher intent of a notification FCM posted (with `google.message_id`), or the app's
 * own (with [MARKER]), on a cold or warm start after the migration ([net.wizardfactory.todayweather.EntryIntents]).
 * `cityIndex` (a string) is parsed like `parseInt` and queued; the open app's session selects it and reloads
 * (`reloadEvent 'push'`). A task reopened from Recents gets the tap that started it again: that one selects nothing.
 */
class NotificationTaps {
    val indexes = Channel<Double>(Channel.UNLIMITED)

    fun accept(intent: Intent): Boolean {
        val extras = intent.extras ?: return false
        if (!extras.containsKey("google.message_id") && !extras.getBoolean(MARKER)) return false
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return true
        NotificationTap.placeIndex(extras.getString("cityIndex"))?.let { indexes.trySend(it) }
        return true
    }

    /** Hands each queued index to [open] once the saved state is read and [ready] (the start page closed). */
    suspend fun deliver(state: StateFlow<AppState?>, ready: (AppState) -> Boolean = { true }, open: (Double) -> Unit) {
        state.first { it != null && ready(it) }
        for (index in indexes) open(index)
    }

    companion object {
        /** On the tap intents of the notifications this app posts and of those the Cordova build posted itself. */
        const val MARKER = "net.wizardfactory.todayweather.NOTIFICATION_TAP"
    }
}

/**
 * The notification permission as firebasex reported it to S09: `hasPermission` is `POST_NOTIFICATIONS` on Android 13+, else
 * whether the app's notifications are on; `grantPermission` asks on Android 13+ through the shown activity. The push
 * plugin runs ([available]) when Firebase is configured.
 */
class AndroidNotificationAccess(private val context: Context) : NotificationAccess {
    private var launcher: ActivityResultLauncher<String>? = null
    private var answer: CompletableDeferred<Boolean>? = null

    fun attach(activity: ComponentActivity) {
        launcher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> answer?.complete(granted) }
    }

    fun detach() {
        launcher = null
    }

    override val available: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

    override fun enabled(): Boolean = if (Build.VERSION.SDK_INT >= 33) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    } else {
        NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    override suspend fun request(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        if (enabled()) return true
        val l = launcher ?: return false
        val a = CompletableDeferred<Boolean>()
        answer?.cancel()
        answer = a
        l.launch(Manifest.permission.POST_NOTIFICATIONS)
        return a.await()
    }
}
