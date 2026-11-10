package net.wizardfactory.todayweather.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import java.io.File
import java.io.IOException
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
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

    /** S02's delete (AN-11): the place's records go and `DELETE /push` is sent once. */
    @Test
    fun aRemovedPlaceDropsItsRecordsAndDeletesThem() = runBlocking {
        val store = store("A")
        val other = record + ("cityIndex" to JsonPrimitive(2))
        runBlocking { store.updateData { it.copy(push = it.push.copy(records = listOf(JsonObject(record), JsonObject(other)))) } }
        val transport = HeldTransport()
        transport.release.complete(Unit)
        val sync = PushSync(store, transport) { ctx }
        val index = (record["cityIndex"] as JsonPrimitive).content.toInt()
        val outcome = sync.removeCity(index)!!
        assertEquals(listOf("DELETE /v000903/push"), outcome.requests.map { "${it.method} ${it.path}" })
        assertEquals(listOf(JsonObject(other)), store.data.first().push.records, "A24: the other place's record keeps its index")
        assertEquals(1, transport.sent.size)
    }

    /** A full disk: the store reads, and any change fails. */
    private class FullStore(private val state: AppState) : DataStore<AppState> {
        override val data = kotlinx.coroutines.flow.flowOf(state)
        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState {
            if (transform(state) != state) throw IOException("no space left on device")
            return state
        }
    }

    /** #2925 F1: an unsaved removal sends nothing and an unsaved update fails nothing; neither throws. */
    @Test
    fun aStoreThatCannotBeWrittenFailsNothing() = runBlocking {
        val moved = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.558, 126.978), source = "KMA")
        val town = Json.parseToJsonElement("""{"first":"서울특별시","second":"중구","third":"명동"}""")
        val state = AppState(places = listOf(Place.currentPositionPlaceholder(), moved),
            push = PushState(fcmToken = "A", records = listOf(JsonObject(record + ("town" to town)))))
        val transport = HeldTransport()
        transport.release.complete(Unit)
        val sync = PushSync(FullStore(state), transport) { ctx }
        assertEquals(null, sync.removeCity(1))
        // AN-14's S09 save and O06 answer are page changes: their unsaved case is AppStateHolderTest's.
        assertEquals(emptyList(), transport.sent)
        assertEquals(listOf("POST /v000903/push-list"), sync.updateCity(1)!!.requests.map { "${it.method} ${it.path}" })
    }

    private val places = listOf(Place.currentPositionPlaceholder(), Place(false, false, "명동", "대한민국 서울특별시 중구 명동", "KR",
        Location(37.56, 126.98), source = "KMA"), Place(false, false, "London", null, "GB", Location(51.51, -0.13), source = "VC"))

    /** The S09 save as the page changes the state (AN-14): the place's records replaced, as the state writer saves it. */
    private fun pageSave(store: DataStore<AppState>, index: Int, list: List<JsonObject>) = runBlocking {
        store.updateData { it.copy(push = PushRegistration.onPlaceSaved(it.push, it.places, list, index, null).state) }
    }

    /**
     * The post after an S09 save (AN-14, review F1): when its turn comes, after a registration that held the lock, it posts
     * only the place's list as stored then, so a second save in between is what the server gets; after the place's
     * records were removed it posts nothing.
     */
    @Test
    fun aSavedPlacesListIsPostedAsStoredWhenItsTurnComes() = runBlocking {
        val store = store("A")
        val other = JsonObject(record + ("cityIndex" to JsonPrimitive(2)))
        store.updateData { it.copy(places = places, push = it.push.copy(records = listOf(JsonObject(record), other))) }
        val transport = HeldTransport()
        val sync = PushSync(store, transport) { ctx }
        val units = async(Dispatchers.IO) { sync.updateUnits() }
        withTimeout(5_000) { transport.firstArrived.await() }
        pageSave(store, 1, listOf(JsonObject(record + ("enable" to JsonPrimitive(false)))))
        val post = async(Dispatchers.IO) { sync.postPlace(1) }
        val second = listOf(JsonObject(record + ("id" to JsonPrimitive(5))))
        pageSave(store, 1, second)
        transport.release.complete(Unit)
        withTimeout(5_000) { units.await() }
        val outcome = withTimeout(5_000) { post.await() }!!
        assertEquals(listOf("POST /v000903/push-list"), outcome.requests.map { "${it.method} ${it.path}" })
        val posted = outcome.requests.single().body as kotlinx.serialization.json.JsonArray
        assertEquals(listOf(5), posted.map { it.jsonObject["id"]!!.jsonPrimitive.content.toInt() }, "only the place's list, as stored at its turn")
        assertEquals(listOf(other) + second, store.data.first().push.records)
        store.updateData { it.copy(push = it.push.copy(records = listOf(other))) }
        assertEquals(emptyList(), sync.postPlace(1)!!.requests, "a removed place's list is not posted")
        assertEquals(2, transport.sent.size)
    }

    /**
     * A place's update while an S09 save is stored (AN-14, review F1): the city info applies to the records as stored when
     * it writes, so the alarms saved during its post stay.
     */
    @Test
    fun aCityUpdateKeepsAnAlarmSavedDuringItsPost() = runBlocking {
        val store = store("A")
        val moved = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.558, 126.978), source = "KMA")
        // A record without a town is left alone (`_getSimpleCityInfo`'s throw): these have the old place's.
        val town = Json.parseToJsonElement("""{"first":"서울특별시","second":"중구","third":"명동"}""")
        val withTown = JsonObject(record + ("town" to town))
        store.updateData { it.copy(places = listOf(Place.currentPositionPlaceholder(), moved), push = it.push.copy(records = listOf(withTown))) }
        val transport = HeldTransport()
        val sync = PushSync(store, transport) { ctx }
        val update = async(Dispatchers.IO) { sync.updateCity(1) }
        withTimeout(5_000) { transport.firstArrived.await() }
        pageSave(store, 1, listOf(JsonObject(withTown + ("id" to JsonPrimitive(5)))))
        transport.release.complete(Unit)
        assertEquals(listOf("POST /v000903/push-list"), withTimeout(5_000) { update.await() }!!.requests.map { "${it.method} ${it.path}" })
        val stored = store.data.first().push.records
        assertEquals(listOf(5), stored.map { it["id"]!!.jsonPrimitive.content.toInt() }, "the saved alarm stays")
        assertEquals("회현동", stored.single()["name"]!!.jsonPrimitive.content, "with the place's new name")
    }

    /** O06 (AN-14): a page change; OK turns the alerts on, ends the introduction and posts the whole list in its turn; Close only ends it. */
    @Test
    fun theAlertIntroductionIsAnsweredOnce() = runBlocking {
        val store = store("A")
        val alert = Json.parseToJsonElement("""{"cityIndex":1,"id":1,"startTime":"2026-11-06T22:00:00.000Z","endTime":"2026-11-07T13:00:00.000Z",
            "enable":false,"category":"alert","name":"명동","source":"KMA","location":{"lat":37.56,"long":126.98}}""").jsonObject
        store.updateData { it.copy(push = it.push.copy(records = listOf(alert, JsonObject(record)), needsAlertIntro = true)) }
        val state = object : StateAccess {
            override fun current(): AppState = runBlocking { store.data.first() }
            override fun change(update: (AppState) -> AppState) { runBlocking { store.updateData(update) } }
        }
        val transport = HeldTransport()
        transport.release.complete(Unit)
        val sync = PushSync(store, transport) { ctx }
        var posts = 0
        answerAlertIntro(state, false) { posts++ }
        assertEquals(0, posts)
        assertEquals(false, store.data.first().push.needsAlertIntro)
        assertEquals(JsonPrimitive(false), store.data.first().push.records[0]["enable"])
        store.updateData { it.copy(push = it.push.copy(needsAlertIntro = true)) }
        answerAlertIntro(state, true) { posts++ }
        assertEquals(1, posts)
        assertEquals(JsonPrimitive(true), store.data.first().push.records[0]["enable"])
        assertEquals(false, store.data.first().push.needsAlertIntro)
        val outcome = sync.postList()!!
        assertEquals(listOf("POST /v000903/push-list"), outcome.requests.map { "${it.method} ${it.path}" })
        assertEquals(2, (outcome.requests.single().body as kotlinx.serialization.json.JsonArray).size, "the whole list")
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
