package net.wizardfactory.todayweather

import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * Holds the intents that open the app (launcher, notification taps, links) until the Cordova data migration
 * ([migration]) has finished, then hands them to [handle] in arrival order on the main thread (#2886).
 */
class EntryIntents(scope: CoroutineScope, migration: Deferred<*>, handle: (Intent) -> Unit) {
    private val queue = Channel<Intent>(Channel.UNLIMITED)

    init {
        scope.launch(Dispatchers.Main) {
            migration.await()
            for (intent in queue) handle(intent)
        }
    }

    fun submit(intent: Intent) {
        queue.trySend(Intent(intent))
    }
}
