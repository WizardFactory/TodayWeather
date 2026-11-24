package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import kotlin.test.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Firebase Analytics settings of the merged manifest (#2894; analytics default-on, specs/analytics-default-on.md):
 * collection off and every consent type denied until the app decides, no advertising ID, no automatic screens, and no
 * TCF intake, so a UMP/TCF ad consent cannot overwrite the denied ad storage, ad user data and ad personalization
 * (`google_analytics_tcf_data_enabled`, a key of play-services-measurement 24.0.0; CODEX-3178-22).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AnalyticsManifestTest {
    @Test
    fun theAppDecidesAndAdConsentStaysDenied() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val meta = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
        val expected = mapOf(
            "firebase_analytics_collection_enabled" to false,
            "google_analytics_adid_collection_enabled" to false,
            "google_analytics_default_allow_analytics_storage" to false,
            "google_analytics_default_allow_ad_storage" to false,
            "google_analytics_default_allow_ad_user_data" to false,
            "google_analytics_default_allow_ad_personalization_signals" to false,
            "google_analytics_automatic_screen_reporting_enabled" to false,
            "google_analytics_tcf_data_enabled" to false,
        )
        assertEquals(expected, expected.keys.associateWith { meta.get(it) })
    }
}
