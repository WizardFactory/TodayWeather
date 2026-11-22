package net.wizardfactory.todayweather.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

/** Exercise the merged app's discovery metadata and the activity the host launches after binding an ID. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 34])
class WidgetRegistrationTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val androidXml = "http://schemas.android.com/apk/res/android"

    @Test fun fourReceiversPublishResizableLayoutsAndTheRegisteredConfigurationActivity() {
        val manager = context.packageManager
        val action = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setPackage(context.packageName)
        val receivers = manager.queryBroadcastReceivers(action, PackageManager.GET_META_DATA)
            .map { it.activityInfo }.filter { it.metaData?.containsKey(AppWidgetManager.META_DATA_APPWIDGET_PROVIDER) == true }
        assertEquals(setOf(CurrentReceiver::class.java.name, ForecastReceiver::class.java.name,
            ClockReceiver::class.java.name, AirReceiver::class.java.name), receivers.map { it.name }.toSet())
        val configure = manager.getActivityInfo(ComponentName(context, WidgetConfigureActivity::class.java), 0)
        assertTrue(configure.exported)
        for (receiver in receivers) {
            val metadata = receiver.loadXmlMetaData(manager, AppWidgetManager.META_DATA_APPWIDGET_PROVIDER)!!
            metadata.use { xml ->
                while (xml.next() != XmlPullParser.START_TAG && xml.eventType != XmlPullParser.END_DOCUMENT) { /* find the root */ }
                assertEquals("appwidget-provider", xml.name)
                assertEquals(configure.name, xml.getAttributeValue(androidXml, "configure"))
                assertTrue(xml.getAttributeResourceValue(androidXml, "initialLayout", 0) != 0)
                assertTrue(xml.getAttributeResourceValue(androidXml, "previewImage", 0) != 0)
                assertEquals(AppWidgetProviderInfo.RESIZE_BOTH, xml.getAttributeIntValue(androidXml, "resizeMode", 0))
                if (Build.VERSION.SDK_INT >= 31) {
                    assertTrue(xml.getAttributeIntValue(androidXml, "targetCellWidth", 0) > 0)
                    assertTrue(xml.getAttributeResourceValue(androidXml, "previewLayout", 0) != 0)
                }
            }
        }
    }

    @Test fun cancelingConfigurationOfABoundWidgetPreservesItsSettingsAndExpiredWindow() {
        val id = 57
        val configure = Intent(context, WidgetConfigureActivity::class.java).setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        val previous = WidgetOptions("current", daily = true, yesterday = true)
        WidgetOptions.save(context, id, previous)
        val expired = System.currentTimeMillis() - WidgetAccess.visitWindow
        context.getSharedPreferences("widget_access", Context.MODE_PRIVATE).edit().putLong("last_visit", expired).commit()

        Robolectric.buildActivity(WidgetConfigureActivity::class.java, configure).use { controller ->
            val activity = controller.get()
            val manager = AppWidgetManager.getInstance(activity)
            val forecast = ComponentName(activity, ForecastReceiver::class.java)
            shadowOf(manager).addBoundWidget(id, AppWidgetProviderInfo().apply { provider = forecast })
            assertTrue(id in manager.getAppWidgetIds(forecast))
            controller.create().start().resume()
            assertFalse(activity.isFinishing)
            assertEquals(expired, WidgetAccess.lastVisit(context))
            activity.onBackPressedDispatcher.onBackPressed()
            assertEquals(Activity.RESULT_CANCELED, shadowOf(activity).resultCode)
            assertEquals(id, shadowOf(activity).resultIntent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1))
        }
        assertEquals(previous, WidgetOptions.read(context, id))
        assertEquals(expired, WidgetAccess.lastVisit(context))
        assertFalse(WidgetAccess.allowed(context))
    }
}
