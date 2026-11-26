package net.wizardfactory.todayweather.ads

import android.content.Context
import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.R
import com.google.android.gms.ads.nativead.NativeAdView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeCardLayoutTest {
    @Test
    fun returningToAPlacementMountsTheSameRegisteredSdkViewAndAdaptsTheTheme() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val first = FrameLayout(context)
        val second = FrameLayout(context)
        var registrations = 0
        var releases = 0
        val card = NativeCard(register = { host, compact ->
            assertTrue(compact)
            registrations++
            LayoutInflater.from(context).inflate(R.layout.native_forecast_ad_compact, host, false) as NativeAdView
        }, releaseAd = { releases++ })
        card.mount(first, compact = true, dark = false)
        val registered = first.getChildAt(0)
        card.mount(second, compact = true, dark = true)
        first.removeAllViews() // Compose can release an old wrapper after the new one was mounted.
        assertSame(registered, second.getChildAt(0))
        assertEquals(Color.WHITE, registered.findViewById<TextView>(R.id.ad_attribution).currentTextColor)
        assertEquals(1, registrations)
        card.destroy()
        card.mount(first, compact = true, dark = false)
        card.destroy()
        assertEquals(0, first.childCount)
        assertEquals(0, second.childCount)
        assertEquals(1, releases)
    }

    @Test
    fun aPhoneUsesRoughlyHalfTheHeightForTheSameAd() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val density = context.resources.displayMetrics.density
        val width = ((411 - 24) * density).roundToInt()
        fun height(layout: Int): Int {
            val card = LayoutInflater.from(context).inflate(layout, null)
            card.findViewById<TextView>(R.id.ad_headline).text = "Weather journal"
            card.findViewById<TextView>(R.id.ad_advertiser).text = "Publisher"
            card.findViewById<TextView>(R.id.ad_body).text = "Follow the weather in your city."
            card.findViewById<TextView>(R.id.ad_cta).text = "Install"
            card.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            return card.measuredHeight
        }
        val stacked = height(R.layout.native_forecast_ad)
        val compact = height(R.layout.native_forecast_ad_compact)
        assertTrue("Compact card $compact vs stacked $stacked", compact.toDouble() / stacked in 0.4..0.6)
    }

    @Test
    fun aNewCardStartsHiddenAndARemountKeepsTheLastViewportState() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val card = NativeCard(register = { host, _ ->
            LayoutInflater.from(context).inflate(R.layout.native_forecast_ad_compact, host, false) as NativeAdView
        }, releaseAd = {})
        val first = FrameLayout(context)
        card.mount(first, compact = true, dark = false)
        val view = first.getChildAt(0)
        assertEquals("not measured yet: hidden from the SDK", View.INVISIBLE, view.visibility)
        card.showInViewport(true)
        assertEquals(View.VISIBLE, view.visibility)
        card.mount(FrameLayout(context), compact = true, dark = false)
        assertEquals("a tab return draws its card in the first frame", View.VISIBLE, view.visibility)
        card.showInViewport(false)
        assertEquals(View.INVISIBLE, view.visibility)
    }
}
