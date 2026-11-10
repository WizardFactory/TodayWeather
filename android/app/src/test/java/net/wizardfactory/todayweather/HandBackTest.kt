package net.wizardfactory.todayweather

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaHandBack
import net.wizardfactory.todayweather.core.storage.CordovaMigration
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList
import net.wizardfactory.todayweather.core.storage.PushState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The rollback hand-back in the app (AN-17, #2896): every state the writer saved and every consent change reach the
 * Cordova suite in one commit with the next generation; a withdrawal made in a fallback build that claimed the state holds
 * at the next start.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HandBackTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val suite = context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978), source = "KMA")
    private val london = Place(false, false, "London", "United Kingdom London", "GB", Location(51.51, -0.13))
    private val alarm = Json.parseToJsonElement("""{"cityIndex":2,"id":2,"category":"alarm","enable":true,"time":"2026-11-07T21:00:00.000Z"}""").jsonObject

    private class Store(initial: AppState) : DataStore<AppState> {
        val value = MutableStateFlow(initial)
        override val data: Flow<AppState> = value
        override suspend fun updateData(transform: suspend (t: AppState) -> AppState): AppState = transform(value.value).also { value.value = it }
    }

    private fun marker() = CordovaHandBack.parse(suite.getString(CordovaHandBack.MARKER, null))
    private fun cities() = Json.parseToJsonElement(suite.getString("cities", null)!!).jsonArray.map { it.jsonObject["name"]?.jsonPrimitive?.content }

    @Test
    fun everySavedStateIsHandedBackWithTheNextGeneration() = runTest {
        // A string the plugin stored with its JSON-type flag, and legacy alarms: both go.
        suite.edit().putString("cities", "[]").putString("_cities_type", "json").putString("pushData", "{}").commit()
        val start = AppState(places = listOf(Place.currentPositionPlaceholder(), seoul, london), placeIndex = 2,
            push = PushState(fcmToken = "t", records = listOf(alarm)))
        val writer = HandBackWriter(suite) { "true" }
        val holder = AppStateHolder(Store(start), CoroutineScope(StandardTestDispatcher(testScheduler)),
            CompletableDeferred(start).also { it.complete(start) }, onSaved = writer::write)
        runCurrent()
        assertEquals(CordovaHandBack.Marker(1, 1, "native", true, CordovaHandBack.KEYS), marker())
        assertEquals(listOf(null, "서울", "London"), cities())
        assertFalse(suite.contains("_cities_type"))
        assertFalse(suite.contains("pushData"))
        assertEquals("2", suite.getString("cityIndex", null))
        assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
        holder.change { PlaceList.remove(it, 2).let { s -> s.copy(push = s.push.copy(records = emptyList())) } }
        runCurrent()
        assertEquals(2, marker()!!.generation)
        assertEquals(listOf(null, "서울"), cities())
        assertEquals(0, Json.parseToJsonElement(suite.getString("pushData2", null)!!).jsonObject["pushList"]!!.jsonArray.size)
        // A write of another writer of the process (PushSync, workers) through the holder's store.
        holder.dataStore.updateData { it.copy(expandShortChart = true) }
        assertEquals(3, marker()!!.generation)
        assertEquals("true", suite.getString("expandShortChart", null))
    }

    @Test
    fun aStateHandedBackAlreadyIsNotWrittenAgain() {
        val state = AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1)
        val writer = HandBackWriter(suite) { null }
        assertTrue(writer.write(state))
        assertTrue(writer.write(state))
        assertEquals(1, marker()!!.generation)
        assertFalse(suite.contains(CordovaHandBack.CONSENT))
    }

    @Test
    fun aConsentChangeIsHandedBackWithTheLastSavedState() {
        val state = AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1)
        var consent: String? = "false"
        val writer = HandBackWriter(suite) { consent }
        assertTrue("nothing saved yet: nothing to hand back", writer.rewrite())
        assertNull(marker())
        writer.write(state)
        consent = "true"
        assertTrue(writer.rewrite())
        assertEquals(2, marker()!!.generation)
        assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
        assertEquals(listOf(null, "서울"), cities())
    }

    @Test
    fun everyWriteOfTheChoiceIsHandedBackAWithdrawalWithoutAChoiceIncluded() {
        // The menu's withdrawal when nothing was chosen yet leaves collection off as it was, and still changes the choice.
        val store = ConsentStore(context)
        val writer = HandBackWriter(suite) { store.storedChoice() }
        writer.watchConsent(context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)) { it() }
        writer.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
        assertFalse(suite.contains(CordovaHandBack.CONSENT))
        store.write(false)
        assertEquals("false", suite.getString(CordovaHandBack.CONSENT, null))
        assertEquals(2, marker()!!.generation)
        store.write(true)
        assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
        assertEquals(3, marker()!!.generation)
        assertEquals(listOf(null, "서울"), cities())
    }

    @Test
    fun aGrantStandsAtTheStartOnlyWhileTheSuiteSaysTrue() {
        val consent = ConsentStore(context)
        val choices = context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)
        fun grant() { consent.write(true); consent.recordCollection(true) }
        fun start(marker: String?, choice: String?) {
            val edit = suite.edit()
            if (marker != null) edit.putString(CordovaHandBack.MARKER, marker) else edit.remove(CordovaHandBack.MARKER)
            if (choice != null) edit.putString(CordovaHandBack.CONSENT, choice) else edit.remove(CordovaHandBack.CONSENT)
            edit.commit()
            HandBackConsent.beforeStart(context)
        }
        val claim = """{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"""
        val own = CordovaHandBack.marker(5, CordovaHandBack.NATIVE)
        grant()
        start(null, null)
        assertTrue("nothing handed over yet: an earlier grant stands", consent.startChoice())
        start(own, "true")
        assertTrue("its own hand-back", consent.startChoice())
        start(claim, "true")
        assertTrue("a fallback build that kept the grant", consent.startChoice())
        start(claim, "false")
        assertFalse("withdrawn in the fallback build", consent.startChoice())
        grant()
        start(own, "false")
        assertFalse("withdrawn there while that build could not read the hand-back (so did not claim it)", consent.startChoice())
        grant()
        start(claim, null)
        assertFalse("no choice there (a mirror that failed removes it): off", consent.startChoice())
        choices.edit().remove(ConsentStore.KEY).commit()
        start(claim, "false")
        assertNull("no grant here: nothing is written", consent.storedChoice())
        consent.write(false)
        start(claim, "true")
        assertFalse("a grant there is not carried over", consent.startChoice())
    }
}
