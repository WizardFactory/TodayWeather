package net.wizardfactory.todayweather.ads

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.R
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeCardLayoutTest {
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
}
