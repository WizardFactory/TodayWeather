package net.wizardfactory.todayweather

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Browser
import android.webkit.WebSettings
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.storage.DeviceIdentity

/** What the menu's rows open outside the app (#2891); the defaults open nothing. */
class MenuHandoffs(
    /** A page opened with the system (널스쿨 풍향, 응원리뷰쓰기): `cordova.InAppBrowser.open(url, "_system")`. */
    val openSystem: (String) -> Unit = {},
    /** 의견보내기 (`Util.sendMail`). */
    val sendFeedback: () -> Unit = {},
)

/** The intents the Cordova build sent for the menu's hand-offs, sent from [activity] (no new task). */
object Handoff {
    /**
     * InAppBrowser's `openExternal`: VIEW with the app's package as the browser's application id. Without an app for it
     * nothing opens, as the plugin caught the failure.
     */
    fun openSystem(activity: Context, url: String) =
        start(activity, Intent(Intent.ACTION_VIEW, Uri.parse(url)).putExtra(Browser.EXTRA_APPLICATION_ID, activity.packageName))

    /** A link the WebView did not load itself (`mailto:`, CordovaWebViewImpl.showWebPage): VIEW, BROWSABLE. */
    fun openLink(activity: Context, url: String) =
        start(activity, Intent(Intent.ACTION_VIEW).addCategory(Intent.CATEGORY_BROWSABLE).setData(Uri.parse(url)))

    /**
     * `Util.sendMail`: to the private feedback address ([BuildConfig.MAIL_TO]), with the translated subject, the app's
     * version, the device UUID (`device.uuid`, the Cordova `Device-Id`) and the WebView's user agent, which the Cordova
     * build sent as its own.
     */
    fun feedbackMail(activity: Context): String = Handoffs.feedbackMail(BuildConfig.MAIL_TO, activity.getString(R.string.LOC_SEND_FEEDBACK),
        BuildConfig.VERSION_NAME, DeviceIdentity.deviceId(activity) ?: "undefined",
        runCatching { WebSettings.getDefaultUserAgent(activity) }.getOrDefault(""))

    private fun start(activity: Context, intent: Intent) {
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
        }
    }
}
