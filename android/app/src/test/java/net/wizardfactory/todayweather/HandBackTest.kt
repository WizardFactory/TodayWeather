package net.wizardfactory.todayweather

import android.content.Context
import android.os.Looper
import androidx.datastore.core.DataStore
import androidx.test.core.app.ApplicationProvider
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
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
import net.wizardfactory.todayweather.analytics.AnalyticsSdk
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
        val executor = Executors.newSingleThreadExecutor()
        try {
            writer.watchConsent(context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)) { executor.execute(it) }
            writer.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
            assertFalse(suite.contains(CordovaHandBack.CONSENT))
            store.write(false)
            drain(executor)
            assertEquals("false", suite.getString(CordovaHandBack.CONSENT, null))
            assertEquals(2, marker()!!.generation)
            store.write(true)
            drain(executor)
            assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
            assertEquals(3, marker()!!.generation)
            assertEquals(listOf(null, "서울"), cities())
        } finally {
            executor.shutdownNow()
        }
    }

    /** The app's writer hands back each written choice through the real preference files. */
    @Test
    fun theAppsWriterHandsBackTheWrittenChoice() {
        val writer = HandBackWriter.of(context)
        val executor = Executors.newSingleThreadExecutor()
        try {
            writer.watchConsent(context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)) { executor.execute(it) }
            writer.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
            ConsentStore(context).write(true)
            drain(executor)
            assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
            ConsentStore(context).write(false)
            drain(executor)
            assertEquals("false", suite.getString(CordovaHandBack.CONSENT, null))
        } finally {
            executor.shutdownNow()
        }
    }

    /** #3238 AC3: TodayWeatherApp's consent listener must not run rewrite() inline on the main looper. */
    @Test
    fun theAppsConsentListenerRunsOffTheMainLooper() {
        val app = context as TodayWeatherApp
        app.handBack.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
        val lockHeld = CountDownLatch(1)
        val writeReturned = CountDownLatch(1)
        var mainCompletedWithoutBlocking = false
        val holder = thread(name = "handback-lock-holder") {
            synchronized(app.handBack) {
                lockHeld.countDown()
                mainCompletedWithoutBlocking = writeReturned.await(500, TimeUnit.MILLISECONDS)
            }
        }
        try {
            assertTrue(lockHeld.await(5, TimeUnit.SECONDS))
            assertTrue(ConsentStore(app).write(true))
            writeReturned.countDown()
        } finally {
            holder.join(5_000)
        }
        assertTrue("consent listener must not run rewrite() inline on the main looper", mainCompletedWithoutBlocking)
        val deadline = System.currentTimeMillis() + 5_000
        while (suite.getString(CordovaHandBack.CONSENT, null) != "true" && System.currentTimeMillis() < deadline) {
            Thread.sleep(20)
        }
        assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
    }

    /** #3238 CODEX-2: Analytics.setCollectionEnabled(true) must wait for suite hand-back commit so HandBackConsent preserves the grant on restart. */
    @Test
    fun setCollectionEnabledWaitsForHandBackCommitBeforeReturningSuccess() {
        val app = object : TodayWeatherApp() {
            init {
                attachBaseContext(context)
            }
            override fun analyticsSdk() = object : AnalyticsSdk {
                override fun setCollectionEnabled(enabled: Boolean) {}
                override fun setConsent(analytics: Boolean) {}
                override fun logEvent(name: String, params: Map<String, Any>) {}
            }
        }
        val store = ConsentStore(app)
        store.write(false)
        app.handBack.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
        assertEquals("false", suite.getString(CordovaHandBack.CONSENT, null))

        val lockHeld = CountDownLatch(1)
        val releaseLock = CountDownLatch(1)
        val saveReturned = CountDownLatch(1)
        var saveResult = false
        val holder = thread(name = "handback-block-codex2") {
            synchronized(app.handBack) {
                lockHeld.countDown()
                releaseLock.await(5, TimeUnit.SECONDS)
            }
        }
        val saver = thread(name = "analytics-save-codex2") {
            assertTrue(lockHeld.await(5, TimeUnit.SECONDS))
            saveResult = app.analytics.setCollectionEnabled(true)
            saveReturned.countDown()
        }
        try {
            assertTrue(lockHeld.await(5, TimeUnit.SECONDS))
            assertFalse(
                "setCollectionEnabled(true) must not return before suite hand-back commits",
                saveReturned.await(300, TimeUnit.MILLISECONDS),
            )
            releaseLock.countDown()
            assertTrue(saveReturned.await(5, TimeUnit.SECONDS))
            assertTrue(saveResult)
            assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
            // Simulating process death immediately after save returns: HandBackConsent must keep the grant.
            HandBackConsent.beforeStart(app)
            assertEquals("true", store.storedChoice())
        } finally {
            releaseLock.countDown()
            holder.join(5_000)
            saver.join(5_000)
        }
    }

    /** #3238 AC3: scheduled consent hand-back writes run off the main looper and preserve FIFO order. */
    @Test
    fun consentHandBackWritesRunOffMainAndPreserveOrder() {
        val mainThread = Looper.getMainLooper().thread
        val store = ConsentStore(context)
        val writer = HandBackWriter(suite) { store.storedChoice() }
        val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "test-handback-order") }
        val threads = Collections.synchronizedList(mutableListOf<Thread>())
        val recordedOrder = Collections.synchronizedList(mutableListOf<String?>())
        try {
            writer.write(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1))
            writer.watchConsent(context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)) { work ->
                executor.execute {
                    threads += Thread.currentThread()
                    work()
                    recordedOrder += suite.getString(CordovaHandBack.CONSENT, null)
                }
            }
            for (choice in listOf(false, true, false, true)) {
                store.write(choice)
                drain(executor)
            }
            assertEquals(4, threads.size)
            assertTrue("every hand-back commit must run off the main looper", threads.none { it === mainThread })
            assertEquals(listOf("false", "true", "false", "true"), recordedOrder)
            assertEquals("true", suite.getString(CordovaHandBack.CONSENT, null))
            assertEquals(5, marker()!!.generation)
        } finally {
            executor.shutdownNow()
        }
    }

    private fun drain(executor: java.util.concurrent.ExecutorService) {
        executor.submit {}.get(5, TimeUnit.SECONDS)
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
        assertEquals("nothing handed over yet: an earlier grant stands", "true", consent.startChoice())
        start(own, "true")
        assertEquals("its own hand-back", "true", consent.startChoice())
        start(claim, "true")
        assertEquals("a fallback build that kept the grant", "true", consent.startChoice())
        start(claim, "false")
        assertEquals("withdrawn in the fallback build", "false", consent.startChoice())
        grant()
        start(own, "false")
        assertEquals("withdrawn there while that build could not read the hand-back (so did not claim it)", "false", consent.startChoice())
        grant()
        start(claim, null)
        assertEquals("no choice there (a mirror that failed removes it): off", "false", consent.startChoice())
        consent.write(false)
        start(claim, "true")
        assertEquals("a grant there is not carried over", "false", consent.startChoice())
    }

    /**
     * Without a choice here the region default applies (analytics default-on, 2026-11-24) and no suite choice is adopted:
     * the suite is backed up while this app's choice is not, so a restore (with a native or a fallback build's marker)
     * must leave the region default (CODEX-3178-2).
     */
    @Test
    fun withoutAChoiceHereNoSuiteChoiceIsAdopted() {
        val consent = ConsentStore(context)
        val choices = context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE)
        fun start(marker: String?, choice: String?): String? {
            choices.edit().remove(ConsentStore.KEY).commit()
            val edit = suite.edit()
            if (marker != null) edit.putString(CordovaHandBack.MARKER, marker) else edit.remove(CordovaHandBack.MARKER)
            if (choice != null) edit.putString(CordovaHandBack.CONSENT, choice) else edit.remove(CordovaHandBack.CONSENT)
            edit.commit()
            HandBackConsent.beforeStart(context)
            return consent.storedChoice()
        }
        val claim = """{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"""
        val own = CordovaHandBack.marker(5, CordovaHandBack.NATIVE)
        assertNull("a fallback build's claim may be restored from a backup", start(claim, "false"))
        assertNull("a native marker may be restored from a backup", start(own, "false"))
        assertNull("a grant there is not carried over: the region default applies", start(claim, "true"))
        assertNull("no choice there", start(claim, null))
        assertNull("nothing handed over: no fallback choice to keep", start(null, "false"))
        assertNull("an unusable marker", start("{", "false"))
    }
}
