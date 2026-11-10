package net.wizardfactory.todayweather

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.TimeZone
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.core.storage.AlarmSettings
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaHandBack
import net.wizardfactory.todayweather.core.storage.CordovaMigration
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList
import net.wizardfactory.todayweather.core.storage.PushRecords
import net.wizardfactory.todayweather.core.storage.PushRegistration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The rollback hand-back on a device (AN-17, #2896 AC2), run by `android/tools/upgrade/run-handback-test.sh` between the
 * Cordova builds it installs. `handBack` names the step: `edit` changes places, alarms, units, the theme and the consent
 * after the update from the seeded Cordova 1.1.1 build; `adopt` starts after a fallback Cordova build claimed the state
 * and changed it; `withdrawn` after the fallback build withdrew the consent. `claim` is the generation of the fallback
 * build's claim. Skipped without `handBack`, so ordinary device test runs do not depend on it.
 */
@RunWith(AndroidJUnit4::class)
class HandBackDeviceTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val app get() = context.applicationContext as TestTodayWeatherApp
    private val step: String? = TestRunner.args.getString("handBack")
    private val claim: Int? = TestRunner.args.getString("claim")?.toInt()
    private val suite = context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)
    private val zone: TimeZone = TimeZone.getDefault()

    /** Step 2: the edits of the native app reach the suite, in the texts the Cordova app reads. */
    @Test
    fun editsInTheNativeApp() {
        if (step != "edit") return
        val migrated = runBlocking { app.migration.await() }
        assertEquals(listOf(null, "명동", "London"), migrated.places.map { it.name })
        assertNull(migrated.migration!!.handBackGeneration)
        // The state of the first load is handed back before any change (no consent: the migration carries none).
        val first = awaitHandBack(null)
        val now = System.currentTimeMillis()
        val ctx = PushRegistration.Context("device", "ko", "2.0.0", migrated.units, now, zone)
        runBlocking {
            app.appState.dataStore.updateData { s ->
                // S02: London deleted with its alarm (AN-11); 부산 added and selected.
                val removed = PlaceList.remove(s, 2).let { it.copy(push = PushRegistration.onCityRemoved(it.push, 2, ctx).state) }
                val busan = Place(false, false, "부산", "대한민국 부산광역시", "KR", Location(35.18, 129.08), source = "KMA")
                val added = PlaceList.add(removed, busan)!!.let { it.copy(placeIndex = it.places.size - 1) }
                // S09: 명동's first alarm at 08:10 (AN-14).
                val alarms = AlarmSettings.load(added.push.records, 1, added.places, now, zone).pick(0, MOVED_ALARM, added.places, now, zone)
                val push = PushRegistration.onPlaceSaved(added.push, added.places, alarms.toSave(now, zone)!!, 1, null).state
                // Settings: Celsius and the light theme.
                added.copy(push = push, units = added.units.with("temperatureUnit", "C"), settings = added.settings.copy(theme = "light"))
            }
        }
        assertTrue(app.analytics.setCollectionEnabled(false))
        val handed = awaitHandBack("false")
        assertTrue(handed.generation > first.generation)
        assertEquals(listOf(null, "명동", "부산"), names())
        assertEquals("2", suite.getString("cityIndex", null))
        assertEquals("C", json("units").jsonObject["temperatureUnit"]!!.jsonPrimitive.content)
        assertEquals("light", json("settingsInfo").jsonObject["theme"]!!.jsonPrimitive.content)
        val records = json("pushData2").jsonObject["pushList"]!!.jsonArray.map { it.jsonObject }
        assertEquals("London's alarm is gone; 부산 has none", listOf(1), records.mapNotNull(PushRecords::cityIndex).distinct())
        val moved = records.single { PushRecords.category(it) == "alarm" && PushRecords.id(it) == 2 }
        assertEquals(MOVED_ALARM, PushRecords.localSeconds(moved["time"], zone))
        assertEquals("token-a", json("pushData2").jsonObject["fcmToken"]!!.jsonPrimitive.content)
        assertFalse(suite.contains("pushData"))
    }

    /** Step 5: the native start adopts the fallback build's state, hands it back, and a grant here is handed back too. */
    @Test
    fun adoptsWhatTheFallbackBuildChanged() {
        if (step != "adopt") return
        val state = runBlocking { app.migration.await() }
        assertEquals(claim, state.migration!!.handBackGeneration)
        // The fallback build's edits (verify-handback.mjs edit): 부산 deleted, 대전 added and selected with an alarm, °F, dark.
        assertEquals(listOf(null, "명동", "대전"), state.places.map { it.name })
        assertEquals(2, state.placeIndex)
        assertEquals("F", state.units.temperatureUnit)
        assertEquals("dark", state.settings.theme)
        assertEquals(listOf(9 * 3600), state.push.records.filter { PushRecords.cityIndex(it) == 2 }.map { PushRecords.localSeconds(it["time"], zone) })
        val moved = state.push.records.single { PushRecords.cityIndex(it) == 1 && PushRecords.id(it) == 2 }
        assertEquals("the native edit came back through the fallback build", MOVED_ALARM, PushRecords.localSeconds(moved["time"], zone))
        assertEquals("token-a", state.push.fcmToken)
        // The grant made in the fallback build is not carried over: the withdrawal made here stands.
        assertEquals("false", ConsentStore(context).storedChoice())
        assertFalse(app.analytics.choice.value)
        assertEquals(claim!! + 1, awaitHandBack("false").generation)
        assertTrue(app.analytics.setCollectionEnabled(true))
        assertEquals(claim + 2, awaitHandBack("true").generation)
    }

    /** Step 7: the fallback build withdrew the consent after a grant here: collection stays off at this start. */
    @Test
    fun aWithdrawalInTheFallbackBuildHolds() {
        if (step != "withdrawn") return
        val state = runBlocking { app.migration.await() }
        assertEquals(claim, state.migration!!.handBackGeneration)
        assertEquals(listOf(null, "명동", "대전"), state.places.map { it.name })
        assertEquals("false", ConsentStore(context).storedChoice())
        assertFalse(app.analytics.choice.value)
        assertEquals(claim!! + 1, awaitHandBack("false").generation)
    }

    /**
     * Waits until the suite holds the saved state's texts with [consent] under a complete native marker (the holder hands
     * back its first load and every save), and returns that marker.
     */
    private fun awaitHandBack(consent: String?): CordovaHandBack.Marker {
        val deadline = System.currentTimeMillis() + 15_000
        var last: String? = null
        while (System.currentTimeMillis() < deadline) {
            val saved: AppState = runBlocking { app.appState.dataStore.data.first() }
            val texts = CordovaHandBack.texts(saved, consent)
            val marker = CordovaHandBack.parse(suite.getString(CordovaHandBack.MARKER, null))
            val mismatched = texts.filter { (key, text) -> suite.getString(key, null) != text || suite.contains("_${key}_type") }.keys
            if (marker != null && marker.writer == CordovaHandBack.NATIVE && marker.complete && marker.keys == CordovaHandBack.KEYS &&
                mismatched.isEmpty()) return marker
            last = "marker $marker, different keys $mismatched"
            Thread.sleep(200)
        }
        throw AssertionError("no hand-back of the saved state: $last")
    }

    private fun json(key: String) = Json.parseToJsonElement(assertNotNullText(key))
    private fun assertNotNullText(key: String) = suite.getString(key, null).also { assertNotNull(key, it) }!!
    private fun names() = json("cities").jsonArray.map { (it as JsonObject)["name"]?.jsonPrimitive?.content }

    private companion object {
        const val MOVED_ALARM = 8 * 3600 + 10 * 60
    }
}
