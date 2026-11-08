package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The saved app state for the screens, from the store once the migration has finished: a [change] shows at once and
 * is saved in the order of the calls, one at a time, as the Cordova app set its in-memory city list and then its
 * storage. A stored value that comes in while changes are being saved is left for the one after them, which contains it.
 */
class AppStateHolder(private val store: DataStore<AppState>, private val scope: CoroutineScope, migration: Deferred<AppState>) : StateAccess {
    private val flow = MutableStateFlow<AppState?>(null)
    private val pending = AtomicInteger()
    private val writes = Channel<(AppState) -> AppState>(Channel.UNLIMITED)

    /** The state; null until the migration has finished. */
    val state: StateFlow<AppState?> = flow.asStateFlow()

    init {
        scope.launch {
            migration.await()
            store.data.collect { if (pending.get() == 0) flow.value = it }
        }
        // One writer takes the changes in the order they were made.
        scope.launch {
            for (update in writes) {
                try {
                    store.updateData { update(it) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // The change stays in memory; the next one is saved on top of the stored state.
                } finally {
                    pending.decrementAndGet()
                }
            }
        }
    }

    override fun current(): AppState? = flow.value

    override fun change(update: (AppState) -> AppState) {
        if (flow.value == null) return
        flow.update { it?.let(update) }
        pending.incrementAndGet()
        writes.trySend(update)
    }
}
