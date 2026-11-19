package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.graphics.Color
import android.os.SystemClock
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdLoader
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.nativead.MediaView
import com.google.android.gms.ads.nativead.NativeAd
import com.google.android.gms.ads.nativead.NativeAdView
import net.wizardfactory.todayweather.R

/** Owns SDK creatives for one activity. The caller supplies combined consent, SDK and remote policy eligibility. */
class NativeForecastAds(
    private val activity: Activity,
    private val unitId: String,
    private val track: (String, Map<String, Any?>) -> Boolean,
) {
    private val inventory = NativeInventory<NativeAd>(::load, NativeAd::destroy, SystemClock::elapsedRealtime)

    fun setEnabled(allowed: Boolean) = inventory.setEnabled(allowed && unitId.isNotBlank())
    fun destroy() = inventory.setEnabled(false)
    internal fun open(visitKey: Any, show: (NativeAd?) -> Unit) = inventory.open(visitKey, show)
    internal fun displayedFor(visitKey: Any) = inventory.displayedFor(visitKey)
    internal fun end(visitKey: Any) = inventory.end(visitKey)

    private fun load(settle: (NativeAd?) -> Unit) {
        val loader = AdLoader.Builder(activity, unitId)
            .forNativeAd { creative ->
                lifecycle("loaded")
                settle(creative)
            }
            .withAdListener(object : AdListener() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    lifecycle("failed")
                    track("ad_load_error", mapOf("ad_format" to "native", "error_code" to error.code))
                    settle(null)
                }

                override fun onAdImpression() = lifecycle("impression")
            })
            .build()
        lifecycle("request")
        loader.loadAd(AdRequest.Builder().build())
    }

    private fun lifecycle(action: String) {
        track("ad_lifecycle", mapOf("ad_format" to "native", "action" to action))
    }
}

private class SlotPosition {
    var visit: NativeInventory<NativeAd>.Visit? = null
    var belowViewport: Boolean? = null
}

/** Keep ownership in the tab/city composition even when an overlay removes its on-screen slot. */
@Composable
fun rememberNativeAdSlot(ads: NativeForecastAds, compact: Boolean, dark: Boolean): @Composable () -> Unit {
    val visitKey = remember(ads) { Any() }
    DisposableEffect(ads, visitKey) { onDispose { ads.end(visitKey) } }
    return { NativeAdSlot(ads, visitKey, compact, dark) }
}

/** Zero height while empty. An arriving creative may be inserted only below the reader's viewport. */
@Composable
private fun NativeAdSlot(ads: NativeForecastAds, visitKey: Any, compact: Boolean, dark: Boolean) {
    var creative by remember(ads, visitKey) { mutableStateOf(ads.displayedFor(visitKey)) }
    val position = remember(ads, visitKey) { SlotPosition() }
    DisposableEffect(ads, visitKey) {
        val visit = ads.open(visitKey) { creative = it }
        position.visit = visit
        position.belowViewport?.let(visit::position)
        onDispose {
            position.visit = null
            visit.detach()
        }
    }
    Box(Modifier.fillMaxWidth().onGloballyPositioned { coordinates ->
        val below = coordinates.positionInWindow().y >= coordinates.findRootCoordinates().boundsInWindow().bottom
        position.belowViewport = below
        position.visit?.position(below)
    }) {
        creative?.let { ad ->
            key(ad, dark, compact) {
                AndroidView(
                    factory = { context ->
                        val layout = if (compact) R.layout.native_forecast_ad_compact else R.layout.native_forecast_ad
                        val view = LayoutInflater.from(context).inflate(layout, null) as NativeAdView
                        bindNativeCreative(view, ad, dark)
                        view
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (compact) 6.dp else 12.dp).testTag("admob-native-card"),
                    onRelease = { it.destroy() },
                )
            }
        }
    }
}

private fun bindNativeCreative(view: NativeAdView, ad: NativeAd, dark: Boolean) {
    val text = if (dark) Color.WHITE else Color.rgb(32, 32, 32)
    view.setBackgroundColor(if (dark) Color.rgb(30, 30, 30) else Color.WHITE)
    view.findViewById<TextView>(R.id.ad_attribution).setTextColor(text)
    fun asset(id: Int, value: String?): TextView = view.findViewById<TextView>(id).apply {
        this.text = value
        setTextColor(text)
        visibility = if (value.isNullOrBlank()) View.GONE else View.VISIBLE
    }
    view.headlineView = asset(R.id.ad_headline, ad.headline)
    view.advertiserView = asset(R.id.ad_advertiser, ad.advertiser)
    view.bodyView = asset(R.id.ad_body, ad.body)
    view.callToActionView = asset(R.id.ad_cta, ad.callToAction)
    view.iconView = view.findViewById<ImageView>(R.id.ad_icon).apply {
        val drawable = ad.icon?.drawable
        setImageDrawable(drawable)
        visibility = if (drawable == null) View.GONE else View.VISIBLE
    }
    view.mediaView = view.findViewById<MediaView>(R.id.ad_media).apply {
        setImageScaleType(ImageView.ScaleType.FIT_CENTER)
        mediaContent = ad.mediaContent
        visibility = if (ad.mediaContent == null) View.GONE else View.VISIBLE
    }
    view.setNativeAd(ad)
}
