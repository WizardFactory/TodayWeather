package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.storage.AppState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #2913 F3, F6: changes are saved in the order they were made, even when the dispatcher runs the newest work first (as
 * a thread pool may); the screens see each change at once, and another writer's update is saved in turn.
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

    /** A store that commits each save at once and announces it, but returns only when the test says. */
    private class HeldStore(initial: AppState) : DataStore<AppState> {
        var value = initial
        val stored = MutableStateFlow(initial)
        val gate = Channel<Unit>(Channel.UNLIMITED)
        override val data: Flow<AppState> = stored
        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState {
            val committed = transform(value)
            value = committed
            stored.value = committed
            gate.receive()
            return committed
        }
    }

    /**
     * #2913 F6: the holder is the store's only writer, so a save that returns late cannot hide a newer one. Another
     * writer of the process (PushSync, through [AppStateHolder.dataStore]) waits for its turn while a screen change's
     * save has committed but not returned; the screens keep that change and the next one, then show the other writer's
     * value once it is saved, and end with what the store holds.
     */
    @Test
    fun anotherWritersUpdateIsSavedInTurnAndNeverHidden() = runTest {
        val store = HeldStore(AppState(placeIndex = 0))
        val holder = AppStateHolder(store, CoroutineScope(StandardTestDispatcher(testScheduler)), CompletableDeferred(AppState()).also { it.complete(AppState()) })
        runCurrent()
        holder.change { it.copy(placeIndex = 1) }
        runCurrent() // committed, not returned
        val push = async(start = CoroutineStart.UNDISPATCHED) { holder.dataStore.updateData { it.copy(push = it.push.copy(registrationId = "r1")) } }
        holder.change { it.copy(expandShortChart = true) }
        runCurrent()
        assertEquals(1, holder.current()?.placeIndex)
        assertTrue(holder.current()!!.expandShortChart)
        assertEquals("the other writer waits for its turn", null, store.value.push.registrationId)
        store.gate.trySend(Unit) // the first change returns
        runCurrent()
        store.gate.trySend(Unit) // the other writer's update returns
        runCurrent()
        assertEquals("r1", push.await().push.registrationId)
        assertEquals("r1", holder.current()?.push?.registrationId)
        assertTrue("the unsaved change stays on top", holder.current()!!.expandShortChart)
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
