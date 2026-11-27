package net.wizardfactory.todayweather.analytics

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlin.test.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * `traffic_type` of the analytics events (#3228): `development` for builds with Google's test units, else `production`
 * for installs from Google Play and `internal` for any other installer or none (sideloaded release builds). A failed
 * read keeps `production`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TrafficTypeTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun testUnitBuildsAreDevelopmentWhateverTheInstaller() {
        for (installer in listOf(TrafficType.PLAY_STORE, "com.example.store", null)) {
            assertEquals("development", TrafficType.of(releaseAds = false) { installer })
        }
        assertEquals("development", TrafficType.of(releaseAds = false) { error("not read") })
    }

    @Test
    fun releaseBuildsFollowTheInstaller() {
        assertEquals("production", TrafficType.of(releaseAds = true) { TrafficType.PLAY_STORE })
        assertEquals("internal", TrafficType.of(releaseAds = true) { "com.sec.android.app.samsungapps" })
        assertEquals("internal", TrafficType.of(releaseAds = true) { "com.google.android.packageinstaller" })
        assertEquals("internal", TrafficType.of(releaseAds = true) { null })
    }

    @Test
    fun aFailedReadKeepsProduction() {
        assertEquals("production", TrafficType.of(releaseAds = true) { throw SecurityException("no access") })
    }

    @Test
    fun readsTheInstallingPackage() {
        val packages = shadowOf(context.packageManager)
        packages.setInstallSourceInfo(context.packageName, "com.android.shell", null)
        assertEquals(null, TrafficType.installer(context))
        packages.setInstallSourceInfo(context.packageName, TrafficType.PLAY_STORE, TrafficType.PLAY_STORE)
        assertEquals(TrafficType.PLAY_STORE, TrafficType.installer(context))
        packages.setInstallSourceInfo(context.packageName, "com.android.shell", "com.android.packageinstaller")
        assertEquals("com.android.packageinstaller", TrafficType.installer(context))
    }

    @Test
    @Config(sdk = [24])
    fun readsTheInstallerBeforeAndroid11() {
        assertEquals(null, TrafficType.installer(context))
        @Suppress("DEPRECATION")
        context.packageManager.setInstallerPackageName(context.packageName, TrafficType.PLAY_STORE)
        assertEquals(TrafficType.PLAY_STORE, TrafficType.installer(context))
    }
}
