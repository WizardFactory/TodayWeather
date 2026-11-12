package net.wizardfactory.todayweather.core.data

import androidx.datastore.core.DataStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushRequest

/**
 * Runs push registrations ([PushRegistration]) one at a time: each reads the stored state, sends its requests
 * and stores the token before the next one starts, so a token that changes twice is replaced A→B and then B→C.
 * The stored token is updated as the Cordova app does, whether or not a request succeeded. [context] returns
 * null when no request can be built (no server URL or device id); nothing is sent or stored then. The S09 save and
 * O06's answer are page changes saved at once (AN-14); only their posts run here, so what a registration stores is
 * applied to the records as stored when it writes.
 */
class PushSync(
    private val store: DataStore<AppState>,
    private val transport: PushTransport,
    private val context: (AppState) -> PushRegistration.Context?,
) {
    data class Outcome(val requests: List<PushRequest>, val statuses: List<Int?>)

    private val lock = Mutex()

    /** What the Cordova `Push.init` does when the app opens. [token] is read inside the lock. */
    suspend fun onStart(token: suspend () -> String?): Outcome? = lock.withLock {
        val state = store.data.first()
        val ctx = context(state) ?: return null
        send(state, PushRegistration.onStart(state.push, state.places, token(), ctx))
    }

    /** A token FCM delivered (`onNewToken`). */
    suspend fun onNewToken(token: String): Outcome? = lock.withLock {
        val state = store.data.first()
        val ctx = context(state) ?: return null
        send(state, PushRegistration.onTokenRefresh(state.push, state.places, token, ctx))
    }

    /**
     * A unit changed on S08 (`Push.updateUnits`): the list again with the new units. The state is read through the
     * store's writer, after the writes asked for before this one, so the unit just chosen is in it. When the store
     * cannot be written (a full disk) nothing is sent and nothing fails: the next start posts the list again with the
     * units then saved (#2915 F1).
     */
    suspend fun updateUnits(): Outcome? = lock.withLock {
        val state = try {
            store.updateData { it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return@withLock null
        }
        val ctx = context(state) ?: return@withLock null
        send(state, PushRegistration.onUnitsChanged(state.push, state.places, ctx))
    }

    /**
     * `Push.updateCityInfo(index)` after a place's update (`WeatherInfo.updateCity`, AN-10): its records follow the
     * place; when anything changed they are posted (with a token) and the list is saved. The state is read through the
     * store's writer, after the place's own write. A list that cannot be saved fails nothing; the next change posts it.
     */
    suspend fun updateCity(index: Int): Outcome? = lock.withLock {
        val state = try {
            store.updateData { it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return@withLock null
        }
        val ctx = context(state) ?: return@withLock null
        val result = PushRegistration.onCityChanged(state.push, state.places, index, ctx)
        if (result.state == state.push) return@withLock Outcome(emptyList(), emptyList())
        val statuses = result.requests.map { transport.send(it) }
        // Applied to the records as stored now: an S09 save or an O06 answer saved meanwhile (a page change) stays.
        save { st -> st.copy(push = st.push.copy(records = PushRegistration.onCityChanged(st.push, st.places, index, ctx).state.records)) }
        Outcome(result.requests, statuses)
    }

    /**
     * `Push.removePushListByCityIndex(index)` (AN-11): the place's records are dropped and saved, then `DELETE /push` is
     * sent once and its answer ignored; nothing without a token or a registration ID. When the records cannot be saved
     * (a full disk) nothing is sent and nothing fails (#2925 F1).
     */
    suspend fun removeCity(index: Int): Outcome? = lock.withLock {
        val state = try {
            store.updateData { it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return@withLock null
        }
        val ctx = context(state) ?: return@withLock null
        val result = PushRegistration.onCityRemoved(state.push, index, ctx)
        if (result.requests.isEmpty()) return@withLock Outcome(emptyList(), emptyList())
        if (!save { it.copy(push = PushRegistration.onCityRemoved(it.push, index, ctx).state) }) return@withLock null
        Outcome(result.requests, result.requests.map { transport.send(it) })
    }

    /**
     * The post after an S09 save (`_postPushList`, AN-14). The save itself is a change of the page ([AlarmPage]), shown
     * and saved at once as the Cordova list changed before S09 went back, so S02's next visit sees it. When its turn
     * comes this posts [index]'s list as stored then, read through the store's writer after that save: a later save or
     * the place's removal in between is what the server gets. When the store cannot be written nothing is sent and
     * nothing fails, as for the other writes (#2915, #2925).
     */
    suspend fun postPlace(index: Int): Outcome? = post { PushRegistration.placePost(it.push, index, context(it)) }

    /** The post after O06's OK (`enableAlertForOldAlarm`, AN-14; the answer is a change, [answerAlertIntro]): the whole list as stored then. */
    suspend fun postList(): Outcome? = post { PushRegistration.listPost(it.push, context(it)) }

    private suspend fun post(requests: (AppState) -> List<PushRequest>): Outcome? = lock.withLock {
        val state = try {
            store.updateData { it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return@withLock null
        }
        val r = requests(state)
        Outcome(r, r.map { transport.send(it) })
    }

    /** Writes [update]; false when the store cannot be written. */
    private suspend fun save(update: (AppState) -> AppState): Boolean = try {
        store.updateData(update)
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    private suspend fun send(state: AppState, result: PushRegistration.Result): Outcome {
        val statuses = result.requests.map { transport.send(it) }
        if (result.state.fcmToken != state.push.fcmToken) {
            store.updateData { it.copy(push = it.push.copy(fcmToken = result.state.fcmToken)) }
        }
        return Outcome(result.requests, statuses)
    }
}
