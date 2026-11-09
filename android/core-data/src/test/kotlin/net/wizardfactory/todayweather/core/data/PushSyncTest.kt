package net.wizardfactory.todayweather.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateSerializer
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushRequest
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings

/** Registrations do not overlap: each one reads the token the previous one stored (#2883 review F2). */
class PushSyncTest {
    private val record = Json.parseToJsonElement(
        """{"cityIndex":1,"id":1,"category":"alarm","time":"2026-11-07T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],
            "enable":true,"name":"명동","source":"KMA","location":{"lat":37.56,"long":126.98}}""",
    ).jsonObject
    private val ctx = PushRegistration.Context("device", "ko-KR", "2.0.0", UnitSettings.defaults("KR"), 0, TimeZone.getTimeZone("Asia/Seoul"))

    private fun store(token: String): DataStore<AppState> {
        val dir = Files.createTempDirectory("push-sync").toFile().apply { deleteOnExit() }
        val store = DataStoreFactory.create(AppStateSerializer, scope = CoroutineScope(Dispatchers.IO + Job())) { File(dir, "state.json") }
        runBlocking { store.updateData { it.copy(push = PushState(fcmToken = token, records = listOf(record))) } }
        return store
    }

    /** The first request waits until [release]; the others go through. */
    private class HeldTransport : PushTransport {
        val sent: MutableList<PushRequest> = Collections.synchronizedList(mutableListOf())
        val firstArrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        override suspend fun send(request: PushRequest): Int {
            sent += request
            if (sent.size == 1) { firstArrived.complete(Unit); release.await() }
            return 200
        }

        /** Gives a registration that does not wait for the lock time to send, then lets the first one finish. */
        suspend fun releaseAfterOthersHadTheirChance() {
            withTimeoutOrNull(500) { while (sent.size < 2) delay(10) }
            release.complete(Unit)
        }
    }

    private fun PushRequest.tokens() = (body as JsonObject).let { it["oldToken"]!!.jsonPrimitive.content to it["newToken"]!!.jsonPrimitive.content }

    @Test
    fun consecutiveTokensAreReplacedInOrder() = runBlocking {
        val store = store("A")
        val transport = HeldTransport()
        val sync = PushSync(store, transport) { ctx }
        val b = async(Dispatchers.Default) { sync.onNewToken("B") }
        transport.firstArrived.await()
        val c = async(Dispatchers.Default) { sync.onNewToken("C") }
        transport.releaseAfterOthersHadTheirChance()
        b.await(); c.await()
        assertEquals(listOf("A" to "B", "B" to "C"), transport.sent.map { it.tokens() })
        assertEquals("C", store.data.first().push.fcmToken)
    }

    @Test
    fun aTokenArrivingDuringTheStartRegistrationWaitsForIt() = runBlocking {
        val store = store("A")
        val transport = HeldTransport()
        val sync = PushSync(store, transport) { ctx }
        val start = async(Dispatchers.Default) { sync.onStart { "B" } }
        transport.firstArrived.await()
        val refresh = async(Dispatchers.Default) { sync.onNewToken("C") }
        transport.releaseAfterOthersHadTheirChance()
        start.await(); refresh.await()
        assertEquals(listOf("PUT", "POST", "PUT"), transport.sent.map { it.method })
        assertEquals("A" to "B", transport.sent[0].tokens())
        assertEquals("B", (transport.sent[1].body as kotlinx.serialization.json.JsonArray)[0].jsonObject["fcmToken"]!!.jsonPrimitive.content)
        assertEquals("B" to "C", transport.sent[2].tokens())
        assertEquals("C", store.data.first().push.fcmToken)
    }

    @Test
    fun nothingIsSentOrStoredWithoutAContext() = runBlocking {
        val store = store("A")
        val transport = HeldTransport()
        assertEquals(null, PushSync(store, transport) { null }.onNewToken("B"))
        assertEquals(emptyList(), transport.sent)
        assertEquals("A", store.data.first().push.fcmToken)
    }
}
