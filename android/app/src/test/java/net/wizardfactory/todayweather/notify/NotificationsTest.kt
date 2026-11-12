package net.wizardfactory.todayweather.notify

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import net.wizardfactory.todayweather.MainActivity
import net.wizardfactory.todayweather.TodayWeatherApp
import org.apache.cordova.firebasex.OnNotificationOpenReceiver
import org.apache.cordova.firebasex.OnNotificationReceiverActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Notifications of AN-14 (#2893): the Cordova channel, messages read as firebasex read them, O07 or a posted notification,
 * taps from FCM's and the app's own notifications and from the Cordova build's (its trampolines), and the permission.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationsTest {
    private val app = ApplicationProvider.getApplicationContext<TodayWeatherApp>()
    private val manager = app.getSystemService(NotificationManager::class.java)

    @Test
    fun theCordovaChannelIsCreatedOnceAndAUsersChannelKept() {
        NotificationChannels.ensure(app)
        val channel = manager.getNotificationChannel("fcm_default_channel")
        assertEquals("Default", channel.name)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        // A channel the Cordova build left (here, muted by its user) is not replaced.
        manager.deleteNotificationChannel("fcm_default_channel")
        manager.createNotificationChannel(NotificationChannel("fcm_default_channel", "Default", NotificationManager.IMPORTANCE_LOW))
        NotificationChannels.ensure(app)
        assertEquals(NotificationManager.IMPORTANCE_LOW, manager.getNotificationChannel("fcm_default_channel").importance)
    }

    private fun remote(vararg pairs: Pair<String, String>) = RemoteMessage(Bundle().apply { pairs.forEach { (k, v) -> putString(k, v) } })

    @Test
    fun aMessageIsReadAsFirebasexReadsIt() {
        // A notification message: its title, body and id; the data without FCM's keys.
        val n = PushMessage.of(remote("gcm.notification.title" to "서울 맑음 3˚", "gcm.notification.body" to "내일 아침 -1˚", "gcm.n.e" to "1",
            "google.message_id" to "0:123", "cityIndex" to "2", "from" to "sender"))
        assertEquals("서울 맑음 3˚", n.title)
        assertEquals("내일 아침 -1˚", n.body)
        assertEquals("0:123", n.id)
        assertEquals("2", n.data["cityIndex"])
        assertFalse(n.foreground)
        // A data message: notification_title and notification_body, its own id, the foreground flag.
        val d = PushMessage.of(remote("notification_title" to "T", "notification_body" to "B", "notification_android_id" to "7",
            "notification_foreground" to "true", "cityIndex" to "1"))
        assertEquals(PushMessage("T", "B", d.data, "7", true), d)
        // Without text nothing is posted; the id is a number up to 50.
        val bare = PushMessage.of(remote("cityIndex" to "1"))
        assertFalse(bare.hasText)
        assertTrue(bare.id.toInt() in 1..50)
    }

    @Test
    fun theOpenTabsTakeAMessageElseItIsPosted() = runBlocking {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val message = PushMessage("서울 맑음 3˚", "내일 아침 -1˚", mapOf("cityIndex" to "2"), "0:9", false)
        // Resumed, with the tabs listening: O07, nothing posted.
        app.foreground.resumed = true
        val taken = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined).launch(start = CoroutineStart.UNDISPATCHED) {
            assertEquals(message, app.foreground.messages.first())
        }
        app.receive(message)
        assertTrue(taken.isCompleted)
        assertEquals(0, shadowOf(manager).allNotifications.size)
        // In the background: posted on the Cordova channel, its tap opening the app with the data.
        app.foreground.resumed = false
        app.receive(message)
        val posted = shadowOf(manager).allNotifications.single()
        assertEquals("fcm_default_channel", posted.channelId)
        val tap = shadowOf(posted.contentIntent).savedIntent
        assertEquals(MainActivity::class.java.name, tap.component?.className)
        assertEquals("2", tap.getStringExtra("cityIndex"))
        assertTrue(tap.getBooleanExtra(NotificationTaps.MARKER, false))
        // A message asking for the foreground shows as O07 and is posted too.
        app.foreground.resumed = true
        val second = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined).launch(start = CoroutineStart.UNDISPATCHED) { app.foreground.messages.first() }
        app.receive(message.copy(id = "0:10", foreground = true))
        assertTrue(second.isCompleted)
        assertEquals(2, shadowOf(manager).allNotifications.size)
        app.foreground.resumed = false
    }

    @Test
    fun withoutThePermissionNothingIsPosted() {
        shadowOf(app as Application).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        app.foreground.resumed = false
        app.receive(PushMessage("t", "b", emptyMap(), "1", false))
        assertEquals(0, shadowOf(manager).allNotifications.size)
        assertFalse(app.notifications.enabled())
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertTrue(app.notifications.enabled())
        // No Firebase configuration in the tests: the push plugin is not there (`Push.inited` false).
        assertFalse(app.notifications.available)
    }

    @Test
    fun tapsComeFromFcmsAndTheAppsNotifications() {
        val taps = NotificationTaps()
        fun intent(vararg pairs: Pair<String, Any>) = Intent(Intent.ACTION_MAIN).apply {
            pairs.forEach { (k, v) -> if (v is Boolean) putExtra(k, v) else putExtra(k, v.toString()) }
        }
        assertTrue(taps.accept(intent("google.message_id" to "0:1", "cityIndex" to "2")))
        assertEquals(2.0, taps.indexes.tryReceive().getOrNull())
        assertTrue(taps.accept(intent(NotificationTaps.MARKER to true, "cityIndex" to "0x1")))
        assertEquals(1.0, taps.indexes.tryReceive().getOrNull())
        // No number, or no cityIndex: taken, nothing selected.
        assertTrue(taps.accept(intent("google.message_id" to "0:2", "cityIndex" to "abc")))
        assertTrue(taps.accept(intent("google.message_id" to "0:3")))
        assertNull(taps.indexes.tryReceive().getOrNull())
        // Reopened from Recents: the tap that started the task selects nothing again.
        assertTrue(taps.accept(intent("google.message_id" to "0:4", "cityIndex" to "1").addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)))
        assertNull(taps.indexes.tryReceive().getOrNull())
        // A launcher intent is no tap.
        assertFalse(taps.accept(Intent(Intent.ACTION_MAIN)))
        assertFalse(taps.accept(intent("cityIndex" to "1")))
    }

    @Test
    fun theCordovaBuildsTapTargetsOpenTheApp() {
        val extras = Bundle().apply {
            putString("cityIndex", "1")
            putString("messageType", "notification")
            putString("id", "0:5")
        }
        Robolectric.buildActivity(OnNotificationReceiverActivity::class.java, Intent(app, OnNotificationReceiverActivity::class.java).putExtras(extras))
            .setup()
        val opened = shadowOf(app as Application).nextStartedActivity
        assertEquals(MainActivity::class.java.name, opened.component?.className)
        assertEquals("1", opened.getStringExtra("cityIndex"))
        assertTrue(opened.getBooleanExtra(NotificationTaps.MARKER, false))
        OnNotificationOpenReceiver().onReceive(app, Intent().putExtras(extras))
        val again = shadowOf(app as Application).nextStartedActivity
        assertEquals("1", again.getStringExtra("cityIndex"))
        assertTrue(again.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }
}
