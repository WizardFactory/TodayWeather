package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.storage.AppState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #2913 F3, F6: changes are saved in the order they were made, even when the dispatcher runs the newest work first (as
 * a thread pool may); the screens see each change at once, and every stored state with the unsaved changes on top.
 */
class AppStateHolderTest {
    /** Runs dispatched work when the test says, newest first. */
    private class Lifo : CoroutineDispatcher() {
        private val tasks = ArrayDeque<Runnable>()
        override fun dispatch(context: CoroutineContext, block: Runnable) { tasks += block }
        fun drain() { while (tasks.isNotEmpty()) tasks.removeLast().run() }
    }

    private class Store(initial: AppState) : DataStore<AppState> {
        val value = MutableStateFlow(initial)
        val writes = mutableListOf<Int>()
        override val data: Flow<AppState> = value
        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState =
            transform(value.value).also { writes += it.placeIndex; value.value = it }
    }

    /** A store whose saves wait for the test and which announces every stored state, as DataStore does. */
    private class HeldStore(initial: AppState) : DataStore<AppState> {
        var value = initial
        val stored = MutableSharedFlow<AppState>(replay = 1).also { it.tryEmit(initial) }
        val gate = Channel<Unit>(Channel.UNLIMITED)
        override val data: Flow<AppState> = stored
        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState {
            gate.receive()
            value = transform(value)
            stored.emit(value)
            return value
        }

        /** Another writer of the same store (PushSync). */
        suspend fun external(change: (AppState) -> AppState) {
            value = change(value)
            stored.emit(value)
        }
    }

    /**
     * #2913 F6: stored states that arrive while changes are being saved are not dropped. Another writer's change and
     * the saves announced while later changes wait all reach the screens, with the unsaved changes on top.
     */
    @Test
    fun theScreensKeepTheStoreAndTheUnsavedChanges() = runTest {
        val store = HeldStore(AppState(placeIndex = 0))
        val holder = AppStateHolder(store, CoroutineScope(StandardTestDispatcher(testScheduler)), CompletableDeferred(AppState()).also { it.complete(AppState()) })
        runCurrent()
        holder.change { it.copy(placeIndex = 1) }
        runCurrent()
        // Another writer stores a push registration while the change waits to be saved.
        store.external { it.copy(push = it.push.copy(registrationId = "r1")) }
        runCurrent()
        assertEquals("the unsaved change stays on the screens", 1, holder.current()?.placeIndex)
        assertEquals("the other writer's change shows", "r1", holder.current()?.push?.registrationId)
        holder.change { it.copy(expandShortChart = true) }
        store.gate.trySend(Unit)
        runCurrent()
        store.gate.trySend(Unit)
        runCurrent()
        assertEquals(store.value, holder.current())
        assertEquals(1, store.value.placeIndex)
        assertEquals("r1", store.value.push.registrationId)
        assertTrue(store.value.expandShortChart)
    }

    @Test
    fun changesAreSavedInTheOrderTheyWereMade() {
        val dispatcher = Lifo()
        val store = Store(AppState(placeIndex = 0))
        val holder = AppStateHolder(store, CoroutineScope(dispatcher), CompletableDeferred(AppState()).also { it.complete(AppState()) })
        dispatcher.drain()
        assertEquals(0, holder.current()?.placeIndex)
        for (i in 1..5) holder.change { it.copy(placeIndex = i) }
        assertEquals("the screens see the last change at once", 5, holder.current()?.placeIndex)
        dispatcher.drain()
        assertEquals(listOf(1, 2, 3, 4, 5), store.writes)
        assertEquals(5, store.value.value.placeIndex)
        assertEquals(5, holder.current()?.placeIndex)
    }
}
