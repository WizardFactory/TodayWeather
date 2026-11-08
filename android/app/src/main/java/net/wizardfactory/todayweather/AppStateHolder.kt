package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The saved app state for the screens, from the store once the migration has finished. A [change] shows at once and
 * is saved in the order of the calls, one at a time, as the Cordova app set its in-memory city list and then its
 * storage. The screens see the last state the store gave (which another writer, such as PushSync, may have changed)
 * with the changes not yet saved applied on top in order; changes set values, so one applied to a stored state that
 * already holds it changes nothing.
 */
class AppStateHolder(private val store: DataStore<AppState>, private val scope: CoroutineScope, migration: Deferred<AppState>) : StateAccess {
    private val lock = Any()
    private var stored: AppState? = null
    private val unsaved = ArrayDeque<(AppState) -> AppState>()
    private val flow = MutableStateFlow<AppState?>(null)
    private val writes = Channel<(AppState) -> AppState>(Channel.UNLIMITED)

    /** The state; null until the migration has finished. */
    val state: StateFlow<AppState?> = flow.asStateFlow()

    init {
        scope.launch {
            migration.await()
            store.data.collect { value -> synchronized(lock) { stored = value; publish() } }
        }
        // One writer takes the changes in the order they were made.
        scope.launch {
            for (update in writes) {
                val saved = try {
                    store.updateData { update(it) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    null
                }
                synchronized(lock) {
                    unsaved.removeFirst()
                    // A change that could not be saved stays on the screens.
                    stored = saved ?: stored?.let(update)
                    publish()
                }
            }
        }
    }

    override fun current(): AppState? = flow.value

    override fun change(update: (AppState) -> AppState) {
        synchronized(lock) {
            if (stored == null) return
            unsaved.addLast(update)
            writes.trySend(update)
            publish()
        }
    }

    /** The stored state with the unsaved changes on top; under [lock]. */
    private fun publish() {
        flow.value = unsaved.fold(stored ?: return) { state, update -> update(state) }
    }
}
