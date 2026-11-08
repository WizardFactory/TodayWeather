package net.wizardfactory.todayweather

import androidx.datastore.core.DataStore
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.core.storage.AppState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #2913 F3: changes are saved in the order they were made, even when the dispatcher runs the newest work first (as a
 * thread pool may); the screens see each change at once.
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
