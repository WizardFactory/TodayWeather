package net.wizardfactory.todayweather

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.core.storage.CordovaMigration
import net.wizardfactory.todayweather.core.storage.CordovaMigrator
import net.wizardfactory.todayweather.core.storage.DeviceIdentity
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Upgrade from the Cordova 1.1.1 build (gate G1 of #2877, state part). Run by
 * `android/tools/upgrade/run-upgrade-test.sh` after it seeded the Cordova app with
 * `seed-cordova.mjs` and installed this build over it; `seeded` is the seed result (base64 JSON).
 * Skipped unless that argument is present, so ordinary device test runs do not depend on it.
 */
@RunWith(AndroidJUnit4::class)
class CordovaUpgradeTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val seeded: JsonObject? = InstrumentationRegistry.getArguments().getString("seeded")
        ?.let { Json.parseToJsonElement(String(Base64.decode(it, Base64.DEFAULT))).jsonObject }

    private fun storage(key: String) = Json.parseToJsonElement(seeded!!["storage"]!!.jsonObject[key]!!.jsonPrimitive.content)

    @Test
    fun firstStartMigratesTheCordovaState() {
        val s = seeded ?: return
        val state = runBlocking { (context.applicationContext as TodayWeatherApp).migration.await() }
        val cities = storage("cities").jsonArray.map { it.jsonObject }
        assertEquals(cities.size, state.places.size)
        cities.forEachIndexed { i, c ->
            assertEquals(c["name"]?.jsonPrimitive?.content, state.places[i].name)
            assertEquals((c["address"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content, state.places[i].address)
            val loc = c["location"] as? JsonObject
            assertEquals(loc?.let { Location(it["lat"]!!.jsonPrimitive.content.toDouble(), it["long"]!!.jsonPrimitive.content.toDouble()) }, state.places[i].location)
        }
        assertEquals(storage("cityIndex").jsonPrimitive.content.toInt(), state.placeIndex)
        // The seed sets three units; Cordova filled the rest with the emulator region's defaults.
        val units = storage("units").jsonObject
        assertEquals(UnitSettings.of(UnitSettings.KEYS.associateWith { units[it]!!.jsonPrimitive.content }), state.units)
        assertEquals("F", state.units.temperatureUnit)
        assertEquals(Settings("1", "30", "dark"), state.settings)
        assertEquals(storage("pushData2").jsonObject["pushList"]!!.jsonArray.map { it.jsonObject }, state.push.records)
        assertTrue(state.expandShortChart)
        assertEquals(s["deviceId"]!!.jsonPrimitive.content, DeviceIdentity.deviceId(context))
        assertTrue("read from localStorage", "cities=localStorage" in state.migration!!.source)
        assertPushReRegistered(state, s["deviceId"]!!.jsonPrimitive.content)
        assertSourcesKept()
    }

    @Test
    fun afterRestartNothingChangesAndAnalyticsStaysOff() {
        seeded ?: return
        val file = File(context.filesDir, "app_state.json")
        val before = file.readBytes()
        val first = runBlocking { (context.applicationContext as TodayWeatherApp).migration.await() }
        val again = runBlocking { CordovaMigrator(context, AppStateStore.get(context)).migrateIfNeeded() }
        assertEquals(first, again)
        assertTrue("app_state.json unchanged", before.contentEquals(file.readBytes()))
        assertTrue("a process start without an app open registers nothing", (context.applicationContext as TestTodayWeatherApp).sent.isEmpty())
        // The SDK's persisted collection flag (set by the Cordova opt-in) is now off.
        val measurement = context.getSharedPreferences("com.google.android.gms.measurement.prefs", Context.MODE_PRIVATE)
        assertFalse(measurement.getBoolean("measurement_enabled_from_api", true))
        assertSourcesKept()
    }

    /**
     * Gate G1, push part: when the app opens, the migrated alarms and alerts are registered once more with the
     * same Device-Id, for an unchanged token (seeded `token-a`) and a changed one (`token-b`), through the
     * recording transport of [TestTodayWeatherApp] (nothing is sent).
     */
    private fun assertPushReRegistered(state: net.wizardfactory.todayweather.core.storage.AppState, deviceId: String) {
        val app = context.applicationContext as TestTodayWeatherApp
        assertNull("the process start alone registers nothing", app.opened)
        assertTrue(app.sent.isEmpty())
        InstrumentationRegistry.getInstrumentation()
            .startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val outcome = runBlocking { app.opened!!.await() }!!
        val token = TestRunner.args.getString("token")!!
        val seededToken = storage("pushData2").jsonObject["fcmToken"]!!.jsonPrimitive.content
        val expectedMethods = if (token == seededToken) listOf("POST") else listOf("PUT", "POST")
        assertEquals(expectedMethods, outcome.requests.map { it.method })
        assertEquals(outcome.requests, app.sent.toList())
        if (token != seededToken) {
            assertEquals("/v000903/push", outcome.requests[0].path)
            assertEquals(token, outcome.requests[0].body.jsonObject["newToken"]!!.jsonPrimitive.content)
            assertEquals(seededToken, outcome.requests[0].body.jsonObject["oldToken"]!!.jsonPrimitive.content)
        }
        val post = outcome.requests.last()
        assertEquals("/v000903/push-list", post.path)
        outcome.requests.forEach { assertEquals(deviceId, it.headers["Device-Id"]) }
        val keys = post.records().map { r -> r.jsonObject.let { listOf(it["cityIndex"], it["id"], it["category"]).toString() } }
        assertEquals(state.push.records.size, keys.size)
        assertEquals("each record once", keys.size, keys.toSet().size)
        post.records().forEach {
            assertEquals(token, it.jsonObject["fcmToken"]!!.jsonPrimitive.content)
            assertEquals(deviceId, it.jsonObject["uuid"]!!.jsonPrimitive.content)
        }
        val stored = runBlocking { AppStateStore.get(context).data.first() }
        assertEquals(token, stored.push.fcmToken)
    }

    private fun assertSourcesKept() {
        val suite = context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)
        assertNotNull(suite.getString("cities", null))
        val data = File(context.applicationInfo.dataDir)
        assertTrue(File(data, "app_webview/Default/Local Storage/leveldb").isDirectory ||
            File(data, "app_webview/Local Storage/https_localhost_0.localstorage").isFile)
    }
}
