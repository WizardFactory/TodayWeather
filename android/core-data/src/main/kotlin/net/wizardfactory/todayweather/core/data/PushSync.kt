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
 * null when no request can be built (no server URL or device id); nothing is sent or stored then.
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

    private suspend fun send(state: AppState, result: PushRegistration.Result): Outcome {
        val statuses = result.requests.map { transport.send(it) }
        if (result.state.fcmToken != state.push.fcmToken) {
            store.updateData { it.copy(push = it.push.copy(fcmToken = result.state.fcmToken)) }
        }
        return Outcome(result.requests, statuses)
    }
}
