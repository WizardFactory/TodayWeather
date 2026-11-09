package net.wizardfactory.todayweather.ads

import android.app.Activity
import android.os.Build
import android.util.DisplayMetrics
import android.util.Log
import android.view.ViewGroup
import android.view.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError

/**
 * The AdMob banner of an activity (the emi plugin's banner with `size: 'adaptive'`, `autoShow: false`): the anchored
 * adaptive size for the window's width without the side system bars, the unit [unitId]. It reports `ad_lifecycle`
 * request, loaded, failed and impression and `ad_load_error` with the SDK's numeric code only (the message can carry
 * ad unit IDs) to [track]. [BannerSlot] shows it.
 */
class AdMobBanner(
    private val activity: Activity,
    private val unitId: String,
    private val track: (String, Map<String, Any?>) -> Boolean,
) : BannerAdapter {
    /** The loaded or loading banner view. */
    var view: AdView? by mutableStateOf(null)
        private set

    override fun create(onLoaded: () -> Unit, onFailed: () -> Unit) {
        destroy()
        var settled = false
        val banner = AdView(activity)
        banner.adUnitId = unitId
        banner.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp(activity)))
        banner.adListener = object : AdListener() {
            override fun onAdLoaded() {
                lifecycle("loaded")
                if (!settled) {
                    settled = true
                    onLoaded()
                }
            }

            override fun onAdFailedToLoad(error: LoadAdError) {
                lifecycle("failed")
                val code = error.code.takeIf { it in 0..999 }
                Log.i(TAG, "banner_load load_failed error_code=${code ?: "unavailable"}")
                if (code != null) track("ad_load_error", mapOf("ad_format" to "banner", "error_code" to code))
                if (!settled) {
                    settled = true
                    onFailed()
                }
            }

            override fun onAdImpression() {
                lifecycle("impression")
            }
        }
        view = banner
        lifecycle("request")
        banner.loadAd(AdRequest.Builder().build())
    }

    override fun destroy() {
        view?.destroy()
        view = null
    }

    fun pause() {
        view?.pause()
    }

    fun resume() {
        view?.resume()
    }

    private fun lifecycle(action: String) {
        track("ad_lifecycle", mapOf("action" to action, "ad_format" to "banner"))
    }

    companion object {
        /** The plugin's `adWidth`: the window's width without the side system bars, in whole dp. */
        fun widthDp(activity: Activity): Int {
            val density = activity.resources.displayMetrics.density
            val px = if (Build.VERSION.SDK_INT >= 30) {
                val metrics = activity.windowManager.currentWindowMetrics
                val insets = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars())
                metrics.bounds.width() - insets.left - insets.right
            } else {
                @Suppress("DEPRECATION")
                DisplayMetrics().also { activity.windowManager.defaultDisplay.getMetrics(it) }.widthPixels
            }
            return (px / density).toInt()
        }
    }
}

/** The banner view in the layout, full width with the ad centered, as tall as the ad. */
@Composable
fun BannerSlot(banner: AdMobBanner) {
    val view = banner.view ?: return
    key(view) {
        AndroidView(factory = { view.also { (it.parent as? ViewGroup)?.removeView(it) } }, modifier = Modifier.fillMaxWidth())
    }
}

private const val TAG = "TwAds"
