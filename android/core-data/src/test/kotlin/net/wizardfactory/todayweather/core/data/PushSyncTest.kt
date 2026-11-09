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
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
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

    /** `updateCityInfo` after a place's update (AN-10): its records follow it and only they are posted; no change, no post. */
    @Test
    fun aMovedPlacePostsItsRecordsAndSavesThem() = runBlocking {
        val store = store("A")
        val moved = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.558, 126.978), source = "KMA")
        // A record of a KMA place has its town (a record without one stops `updateCityInfo`).
        val town = Json.parseToJsonElement("""{"first":"서울특별시","second":"중구","third":"명동"}""")
        runBlocking {
            store.updateData { it.copy(places = listOf(Place.currentPositionPlaceholder(), moved),
                push = it.push.copy(records = listOf(JsonObject(record + ("town" to town))))) }
        }
        val transport = HeldTransport()
        transport.release.complete(Unit)
        val sync = PushSync(store, transport) { ctx }
        val outcome = sync.updateCity(1)!!
        assertEquals(listOf("POST /v000903/push-list"), outcome.requests.map { "${it.method} ${it.path}" })
        val posted = (outcome.requests.single().body as kotlinx.serialization.json.JsonArray).single().jsonObject
        assertEquals("회현동", posted["name"]!!.jsonPrimitive.content)
        assertEquals("회현동", store.data.first().push.records.single()["name"]!!.jsonPrimitive.content)
        assertEquals(emptyList(), sync.updateCity(1)!!.requests, "unchanged now")
        assertEquals(emptyList(), sync.updateCity(0)!!.requests, "no records of the current position")
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
