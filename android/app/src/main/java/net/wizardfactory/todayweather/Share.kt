package net.wizardfactory.todayweather

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.share.EntryLink
import net.wizardfactory.todayweather.core.domain.share.ShareMessage
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The share button of S03, S04 and S05 (TabCtrl's `doTabShare`, O16): the selected place's message through the system
 * chooser, as the socialsharing plugin sent it. Without a location nothing is shared; the Cordova build opened O02
 * there, which comes with AN-10.
 */
class WeatherShare(private val context: Context, private val state: () -> AppState?, private val weather: () -> Map<String, WeatherEntry>) {
    fun share() {
        val s = state() ?: return
        val record = s.places.getOrNull(s.placeIndex)?.let { cityRecord(it, weather()[WeatherRepository.key(it)]) }
        val texts = ShareMessage.Texts(context.getString(R.string.LOC_CURRENT), context.getString(R.string.LOC_HIGHEST),
            context.getString(R.string.LOC_LOWEST), context.getString(R.string.LOC_TODAYWEATHER))
        val message = ShareMessage.build(record, texts, AppLocale.systemTags().firstOrNull().orEmpty()) ?: return
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
 * `todayweather://N` links (AN-16): [accept] takes the place index of a link that opened the app, after the migration
 * ([EntryIntents]); the open app's session selects it ([indexes]), on cold and warm starts alike.
 */
class EntryLinks {
    val indexes = Channel<Double>(Channel.UNLIMITED)

    /**
     * True when [intent] is an entry link; one with an index is queued. A task opened again from Recents after its
     * activity finished gets the link that started it again: that one selects nothing.
     */
    fun accept(intent: Intent): Boolean {
        if (intent.action != Intent.ACTION_VIEW || intent.data?.scheme != EntryLink.SCHEME) return false
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return true
        intent.dataString?.let(EntryLink::placeIndex)?.let { indexes.trySend(it) }
        return true
    }

    /**
     * Hands each queued place index to [open] once the saved state is there ([state] is null until it has been read
     * after the migration): a cold start's link arrives with the migration's end, which can come first.
     */
    suspend fun deliver(state: StateFlow<AppState?>, open: (Double) -> Unit) {
        state.first { it != null }
        for (index in indexes) open(index)
    }
}
