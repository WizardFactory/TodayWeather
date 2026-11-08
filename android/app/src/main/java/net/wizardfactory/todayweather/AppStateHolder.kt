package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.storage.AppState

/**
 * The saved app state of the process, once the migration has finished: the only writer of the store from then on.
 * The screens' changes ([change]) show at once and the other writers of the process (PushSync, through [dataStore])
 * wait for their turn; one writer saves everything in the order it was asked for, as the Cordova app set its
 * in-memory city list and then its storage. The screens see the last saved state with the screens' changes not yet
 * saved applied on top, in order. Since nothing else writes the store, the last saved state is always the newest.
 */
class AppStateHolder(private val store: DataStore<AppState>, private val scope: CoroutineScope, migration: Deferred<AppState>) : StateAccess {
    private sealed interface Write {
        /** A screen change, already shown. */
        class Change(val update: (AppState) -> AppState) : Write

        /** Another writer's update, shown once saved. */
        class Update(val transform: suspend (AppState) -> AppState, val done: CompletableDeferred<AppState>) : Write
    }

    private val lock = Any()
    private var saved: AppState? = null
    private val unsaved = ArrayDeque<(AppState) -> AppState>()
    private val flow = MutableStateFlow<AppState?>(null)
    private val writes = Channel<Write>(Channel.UNLIMITED)

    /** The state; null until the migration has finished. */
    val state: StateFlow<AppState?> = flow.asStateFlow()

    /** The store for the process's other writers: reads give the saved state, updates are saved in turn. */
    val dataStore: DataStore<AppState> = object : DataStore<AppState> {
        override val data: Flow<AppState> get() = store.data

        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState {
            val done = CompletableDeferred<AppState>()
            writes.send(Write.Update(transform, done))
            return done.await()
        }
    }

    init {
        scope.launch {
            migration.await()
            val initial = store.data.first()
            synchronized(lock) {
                saved = initial
                publish()
            }
            for (write in writes) {
                when (write) {
                    is Write.Change -> {
                        val result = save { write.update(it) }
                        synchronized(lock) {
                            unsaved.removeFirst()
                            // A change that could not be saved stays on the screens.
                            saved = result.getOrNull() ?: saved?.let(write.update)
                            publish()
                        }
                    }
                    is Write.Update -> {
                        val result = save(write.transform)
                        result.getOrNull()?.let { synchronized(lock) { saved = it; publish() } }
                        result.fold(write.done::complete, write.done::completeExceptionally)
                    }
                }
            }
        }
    }

    override fun current(): AppState? = flow.value

    override fun change(update: (AppState) -> AppState) {
        synchronized(lock) {
            if (saved == null) return
            unsaved.addLast(update)
            writes.trySend(Write.Change(update))
            publish()
        }
    }

    private suspend fun save(transform: suspend (AppState) -> AppState): Result<AppState> = try {
        Result.success(store.updateData(transform))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

    /** The saved state with the unsaved changes on top; under [lock]. */
    private fun publish() {
        flow.value = unsaved.fold(saved ?: return) { state, update -> update(state) }
    }
}
