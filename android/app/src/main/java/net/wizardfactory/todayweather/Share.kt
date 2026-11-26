package net.wizardfactory.todayweather

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.share.DeepLink
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.domain.share.EntryLink
import net.wizardfactory.todayweather.core.domain.share.ShareMessage
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The share button of S03, S04 and S05 (TabCtrl's `doTabShare`, O16): the selected place's message through the system
 * chooser, as the socialsharing plugin sent it, with the `link.todayweather.ai` link of the tab shared from ([view],
 * [pollutant] for Air). Without a selected place or its location nothing is shared, and O02 asks how to start instead
 * ([onNoLocation], `startPopup`).
 */
class WeatherShare(
    private val context: Context,
    private val state: () -> AppState?,
    private val weather: () -> Map<String, WeatherEntry>,
    private val onNoLocation: () -> Unit = {},
) {
    fun share(view: WeatherView = WeatherView.HOURLY, pollutant: String? = null) {
        val s = state() ?: return
        val place = s.places.getOrNull(s.placeIndex)
        if (place?.location == null) return onNoLocation()
        val record = cityRecord(place, weather()[WeatherRepository.key(place)])
        val texts = ShareMessage.Texts(context.getString(R.string.LOC_CURRENT), context.getString(R.string.LOC_HIGHEST),
            context.getString(R.string.LOC_LOWEST), context.getString(R.string.LOC_TODAYWEATHER))
        val message = ShareMessage.build(record, texts, view, pollutant) ?: return
        runCatching { context.startActivity(chooser(message)) }
    }

    companion object {
        /** The plugin's `doSendIntent`: `ACTION_SEND` of plain text in a chooser without a title. */
        fun chooser(message: String): Intent {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, message)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_WHEN_TASK_RESET or Intent.FLAG_ACTIVITY_NEW_TASK)
            return Intent.createChooser(send, null)
        }
    }
}

/**
 * The links that open the app, after the migration ([EntryIntents]): `todayweather://N` (AN-16), whose place index
 * [accept] queues in [indexes], and `link.todayweather.ai` links (verified `https://` App Links and Android web
 * fallback `todayweather://link.todayweather.ai/...` handoffs, specs/deeplink.md / #3219), whose targets it queues in
 * [targets]. The open app's session takes them, on cold and warm starts alike.
 */
class EntryLinks {
    val indexes = Channel<Double>(Channel.UNLIMITED)
    val targets = Channel<DeepLinkTarget>(Channel.UNLIMITED)

    /**
     * True when [intent] is an entry link; a valid one is queued. A task opened again from Recents after its activity
     * finished gets the link that started it again: that one opens nothing. Links of other hosts are not entry links.
     */
    fun accept(intent: Intent): Boolean {
        if (intent.action != Intent.ACTION_VIEW) return false
        val data = intent.data ?: return false
        val custom = data.scheme.equals(EntryLink.SCHEME, ignoreCase = true)
        val https = data.scheme.equals("https", ignoreCase = true)
        if (!custom && !(https && data.host.equals(DeepLink.HOST, ignoreCase = true))) return false
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return true
        val url = intent.dataString ?: return true
        when (val target = DeepLink.parse(url)) {
            is DeepLinkTarget.LegacyWidgetIndex -> indexes.trySend(target.index)
            null -> {}
            else -> targets.trySend(target)
        }
        return true
    }

    /**
     * Hands each queued place index to [open] once the saved state is there ([state] is null until it has been read
     * after the migration) and [ready]: a cold start's link arrives with the migration's end, which can come first, and
     * a link waits while the start page shows (AN-10).
     */
    suspend fun deliver(state: StateFlow<AppState?>, ready: (AppState) -> Boolean = { true }, open: (Double) -> Unit) {
        state.first { it != null && ready(it) }
        for (index in indexes) open(index)
    }

    /** Hands each queued link target to [open], in order, once the saved state is there; [open] decides when it applies. */
    suspend fun deliverTargets(state: StateFlow<AppState?>, open: suspend (DeepLinkTarget) -> Unit) {
        state.first { it != null }
        for (target in targets) open(target)
    }
}
