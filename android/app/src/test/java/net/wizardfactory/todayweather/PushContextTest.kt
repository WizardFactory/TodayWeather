package net.wizardfactory.todayweather

import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import kotlin.test.assertEquals
import kotlin.test.assertNull
import net.wizardfactory.todayweather.core.storage.AppState
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The app's push registrations use the decided path version (AN-06), as core-data's `RequestPathsTest` sends them (#2897 AC3). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PushContextTest {
    @Test
    fun pushRequestsUseV000903() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "device")
        assertEquals("/v000903", pushContext(context, "https://server.test.invalid", AppState())!!.versionPath)
        assertNull(pushContext(context, "", AppState()), "without a server URL nothing is sent")
    }
}
