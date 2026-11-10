package net.wizardfactory.todayweather

import androidx.datastore.core.DataStoreFactory
import java.nio.file.Files
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateSerializer
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList
import net.wizardfactory.todayweather.core.storage.PushState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * S02's changes survive a restart (#2890 AC1): an add, a delete and the current position's switch, made through the
 * screens' writer ([AppStateHolder]) and the push writer's record removal, are in the store file a new process reads.
 */
class PlacesPersistenceTest {
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val busan = Place(false, false, "부산광역시", "대한민국 부산광역시", "KR", Location(35.18, 129.08))
    private val alarm = Json.parseToJsonElement("""{"cityIndex":1,"id":1,"category":"alarm","enable":true}""") as JsonObject

    @Test
    fun placesSelectionAndRecordsAreAsLeftAfterARestart() = runBlocking {
        val file = Files.createTempDirectory("places").resolve("app_state.json").toFile()
        val first = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store = DataStoreFactory.create(AppStateSerializer, scope = first) { file }
        store.updateData {
            AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, push = PushState(fcmToken = "t", records = listOf(alarm)))
        }
        val holder = AppStateHolder(store, first, CompletableDeferred(AppState()).also { it.complete(AppState()) })
        withTimeout(5_000) { holder.state.first { it != null } }
        holder.change { PlaceList.add(it, busan)!!.copy(placeIndex = 2) }
        holder.change { PlaceList.disableCurrent(it, false) }
        holder.change { PlaceList.remove(it, 1) }
        // The push writer's removal of the deleted place's records, after the screens' changes.
        holder.dataStore.updateData { it.copy(push = it.push.copy(records = emptyList())) }
        val expected = holder.state.value!!
        first.cancel()

        // What a new process reads from the file (one DataStore per file in a process: the serializer reads it directly).
        val reopened = file.inputStream().use { AppStateSerializer.readFrom(it) }
        assertEquals(listOf(null, "부산광역시"), reopened.places.map { it.name })
        assertEquals(false, reopened.places[0].disable)
        assertEquals("the selected last place gave way to the first enabled one, the current position", 0, reopened.placeIndex)
        assertEquals(emptyList<JsonObject>(), reopened.push.records)
        assertEquals(expected, reopened)
    }
}
