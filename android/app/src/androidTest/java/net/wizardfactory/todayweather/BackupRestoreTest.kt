package net.wizardfactory.todayweather

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Backup and restore against the recorded policy (#2895 AC2; README "Backup and device transfer"), run by
 * tools/backup/run-backup-test.sh with `backup`:
 * - `seed`: places, the selected one, an FCM token, an analytics opt-in, a weather cache file and a Firebase file;
 * - `native`, after `bmgr backupnow`, a reinstall and `bmgr restore`: the state came back; the analytics choice, the
 *   weather cache and the Firebase file did not; the open app replaces the restored token with its own on the server;
 * - `cordova`, after a Cordova 1.1.1 backup restored into this build: the Cordova data migrates (`seeded`), and the
 *   Cordova files outside the policy stayed behind.
 */
@RunWith(AndroidJUnit4::class)
class BackupRestoreTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val app get() = context.applicationContext as TestTodayWeatherApp
    private val step = TestRunner.args.getString("backup")
    private val places = listOf(Place.currentPositionPlaceholder(), Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98)),
        Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13)))

    private val cache get() = File(context.filesDir, "weather/seed.json")
    private fun firebase() = context.getSharedPreferences("com.google.android.gms.appid", Context.MODE_PRIVATE)

    @Test
    fun seed() {
        assumeTrue("needs -e backup seed", step == "seed")
        runBlocking {
            app.migration.await()
            app.appState.dataStore.updateData { it.copy(places = places, placeIndex = 2, push = PushState(fcmToken = "token-a")) }
        }
        assertTrue(app.analytics.setCollectionEnabled(true))
        cache.parentFile!!.mkdirs()
        cache.writeText("{}")
        assertTrue(firebase().edit().putString("seed", "old device").commit())
    }

    @Test
    fun nativeBackupRestoresThePolicy() {
        assumeTrue("needs -e backup native", step == "native")
        // Read before the app opens: what the restore brought back.
        val state = runBlocking { app.migration.await().let { app.appState.dataStore.updateData { s -> s } } }
        assertEquals(places, state.places)
        assertEquals(2, state.placeIndex)
        assertEquals("token-a", state.push.fcmToken)
        assertNull("the analytics choice stays behind", context.getSharedPreferences(ConsentStore.CHOICE_FILE, Context.MODE_PRIVATE).getString(ConsentStore.KEY, null))
        assertFalse(app.analytics.choice.value)
        assertFalse("the weather cache stays behind", cache.exists())
        assertNull("Firebase's files stay behind", firebase().getString("seed", null))
        // The open app registers its own token: the server replaces the restored one (AN-04).
        app.sent.clear()
        val outcome = runBlocking { app.onOpened().await() }!!
        assertEquals(listOf("PUT"), outcome.requests.map { it.method })
        val body = outcome.requests.single().body as JsonObject
        assertEquals(JsonPrimitive("token-b"), body["newToken"])
        assertEquals(JsonPrimitive("token-a"), body["oldToken"])
    }

    @Test
    fun cordovaBackupRestoresAndMigrates() {
        assumeTrue("needs -e backup cordova", step == "cordova")
        val seeded = Json.parseToJsonElement(String(Base64.decode(TestRunner.args.getString("seeded")!!, Base64.DEFAULT))).jsonObject
        val cities = Json.parseToJsonElement(seeded["storage"]!!.jsonObject["cities"]!!.jsonPrimitive.content).jsonArray.map { it.jsonObject }
        val state = runBlocking { app.migration.await() }
        assertEquals(cities.map { it["name"]?.jsonPrimitive?.content }, state.places.map { it.name })
        assertTrue("read from the restored localStorage", "cities=localStorage" in state.migration!!.source)
        for (left in TestRunner.args.getString("absent")!!.split(',').filter { it.isNotEmpty() }) {
            assertFalse("$left stays behind", File(context.applicationInfo.dataDir, left).exists())
        }
    }
}
