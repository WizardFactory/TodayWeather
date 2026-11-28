package net.wizardfactory.todayweather

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Browser
import android.util.Log
import android.webkit.WebSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.analytics.Analytics
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.storage.DeviceIdentity

/** What the menu's rows open outside the app (#2891); the defaults open nothing. */
class MenuHandoffs(
    /** A page opened with the system (널스쿨 풍향, 응원리뷰쓰기): `cordova.InAppBrowser.open(url, "_system")`. */
    val openSystem: (String) -> Unit = {},
    /** 의견보내기 (`Util.sendMail`). */
    val sendFeedback: () -> Unit = {},
)

/** A one-shot usage analytics save failure owned by the app so Activity recreation does not drop it. */
data class PrivacySaveFailure(val requestId: Long, val messageRes: Int)

/**
 * Serializes usage analytics choices on an app-scoped background dispatcher and tracks the latest
 * unconsumed save failure across Activity recreations (#3238).
 */
class AnalyticsChoiceController(
    private val beginChoice: (Boolean) -> Long,
    private val commitChoice: suspend (Boolean, Long) -> Analytics.ChoiceOutcome,
    private val scope: CoroutineScope,
    private val writer: CoroutineDispatcher,
    private val failureMessageRes: Int = R.string.LOC_PRIVACY_SAVE_FAILED,
) {
    constructor(
        analytics: Analytics,
        scope: CoroutineScope,
        writer: CoroutineDispatcher,
    ) : this(analytics::beginChoice, { value, id -> analytics.commitChoice(value, id) }, scope, writer)

    private val lock = Any()
    private var latestRequestId = 0L
    private var suppressedUpToRequestId = 0L
    private val failureFlow = MutableStateFlow<PrivacySaveFailure?>(null)

    private val withdrawalPending = MutableStateFlow(false)

    val saveFailure: StateFlow<PrivacySaveFailure?> = failureFlow.asStateFlow()
    /** Collection stops at the tap. Keep the UI pending until the background writer finishes. */
    val savingWithdrawal: StateFlow<Boolean> = withdrawalPending.asStateFlow()

    fun submit(value: Boolean) {
        val id = beginChoice(value)
        synchronized(lock) {
            if (id <= latestRequestId) return
            latestRequestId = id
            withdrawalPending.value = !value
            failureFlow.value = null
        }
        scope.launch(writer) {
            var failed = false
            try {
                failed = commitChoice(value, id) == Analytics.ChoiceOutcome.FAILED
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
                Log.w("TwAnalytics", "choice persistence failed")
            } finally {
                synchronized(lock) {
                    if (id != latestRequestId) return@synchronized
                    if (failed && id > suppressedUpToRequestId) {
                        failureFlow.value = PrivacySaveFailure(id, failureMessageRes)
                    }
                    withdrawalPending.value = false
                }
            }
        }
    }

    fun onPopupOpened() {
        synchronized(lock) {
            suppressedUpToRequestId = maxOf(suppressedUpToRequestId, latestRequestId)
            failureFlow.value = null
        }
    }

    fun consumeFailure(requestId: Long) {
        synchronized(lock) {
            if (failureFlow.value?.requestId == requestId) {
                failureFlow.value = null
            }
        }
    }
}

/** The menu's privacy rows (#2894): the usage analytics choice and its change, and the ad privacy form. */
class PrivacyActions(
    val choice: StateFlow<Boolean>,
    /** Submits the popup's choice off the main thread; failures surface via [saveFailure]. */
    val setAnalytics: (Boolean) -> Unit,
    /** The popup asks for consent (an opt-in region at the start, `Analytics.optInRegion`); else it offers 끄기 and 켜기. */
    val optIn: Boolean,
    /** Unconsumed save failure from the latest usage analytics choice (`LOC_PRIVACY_SAVE_FAILED`). */
    val saveFailure: StateFlow<PrivacySaveFailure?> = MutableStateFlow(null),
    /** Marks a displayed [PrivacySaveFailure] as consumed so it does not reappear after recreation. */
    val consumeFailure: (Long) -> Unit = {},
    /** Suppresses any earlier in-flight save failure when the user reopens the analytics popup. */
    val onPopupOpened: () -> Unit = {},
    /** Keeps a withdrawal visibly pending until its background save finishes. */
    val savingWithdrawal: StateFlow<Boolean> = MutableStateFlow(false),
    /** 광고 개인정보 선택; the argument runs when no form can open (`LOC_AD_PRIVACY_UNAVAILABLE`). */
    val openAdPrivacy: (onUnavailable: () -> Unit) -> Unit,
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
