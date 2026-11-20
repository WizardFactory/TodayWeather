package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import net.wizardfactory.todayweather.core.domain.shell.Tab

/** Owns SDK creatives for one activity. The caller supplies combined consent, SDK and remote policy eligibility. */
class NativeForecastAds(
    private val activity: Activity,
    private val unitId: String,
    private val track: (String, Map<String, Any?>) -> Boolean,
) {
    private val main = Handler(Looper.getMainLooper())
    private val inventory = NativeInventory<NativeCard>(::load, NativeCard::destroy, SystemClock::elapsedRealtime) { main.post(it) }

    fun setEnabled(allowed: Boolean) = inventory.setEnabled(allowed && unitId.isNotBlank())
    fun destroy() = inventory.setEnabled(false)
    fun setForeground(value: Boolean) = inventory.setForeground(value)
    internal fun open(tab: Tab, visitKey: Any, show: (NativeCard?) -> Unit) = inventory.open(tab, visitKey, show)
    internal fun end(visitKey: Any) = inventory.end(visitKey)

    private fun load(settle: (NativeCard?) -> Unit) {
        val loader = AdLoader.Builder(activity, unitId)
            .forNativeAd { creative ->
                lifecycle("loaded")
                settle(NativeCard(register = { host, compact ->
                    val layout = if (compact) R.layout.native_forecast_ad_compact else R.layout.native_forecast_ad
                    val view = LayoutInflater.from(host.context).inflate(layout, host, false) as NativeAdView
                    bindNativeCreative(view, creative)
                    view
                }, releaseAd = creative::destroy))
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

/** The registered SDK view follows this ad across visits to its one placement. Compose owns only the wrapper. */
internal class NativeCard(
    private val register: (FrameLayout, Boolean) -> NativeAdView,
    private val releaseAd: () -> Unit,
) {
    private var view: NativeAdView? = null
    private var darkTheme: Boolean? = null
    private var destroyed = false

    fun mount(host: FrameLayout, compact: Boolean, dark: Boolean) {
        if (destroyed) return
        val card = view ?: register(host, compact).also { view = it }
        if (card.parent !== host) {
            (card.parent as? ViewGroup)?.removeView(card)
            host.removeAllViews()
            host.addView(card)
        }
        if (darkTheme != dark) {
            darkTheme = dark
            val text = if (dark) Color.WHITE else Color.rgb(32, 32, 32)
            card.setBackgroundColor(if (dark) Color.rgb(30, 30, 30) else Color.WHITE)
            for (id in listOf(R.id.ad_attribution, R.id.ad_headline, R.id.ad_advertiser, R.id.ad_body, R.id.ad_cta)) {
                card.findViewById<TextView>(id).setTextColor(text)
            }
        }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        view?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        view = null
        releaseAd()
    }
}

/** Keep the visit in the tab/city composition. A card requested after a miss belongs to a future visit. */
@Composable
fun rememberNativeAdSlot(ads: NativeForecastAds, tab: Tab, dark: Boolean): @Composable () -> Unit {
    val visitKey = remember(ads, tab) { Any() }
    DisposableEffect(ads, visitKey) { onDispose { ads.end(visitKey) } }
    return { NativeAdSlot(ads, tab, visitKey, dark) }
}

@Composable
private fun NativeAdSlot(ads: NativeForecastAds, tab: Tab, visitKey: Any, dark: Boolean) {
    var creative by remember(ads, visitKey) { mutableStateOf<NativeCard?>(null) }
    DisposableEffect(ads, visitKey) {
        val visit = ads.open(tab, visitKey) { creative = it }
        onDispose { visit.detach() }
    }
    creative?.let { card ->
        val compact = tab != Tab.LOCATIONS
        AndroidView(
            factory = { FrameLayout(it) },
            update = { card.mount(it, compact, dark) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (compact) 6.dp else 12.dp)
                .testTag("admob-native-card"),
            onRelease = { it.removeAllViews() },
        )
    }
}

private fun bindNativeCreative(view: NativeAdView, ad: NativeAd) {
    fun asset(id: Int, value: String?): TextView = view.findViewById<TextView>(id).apply {
        this.text = value
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
