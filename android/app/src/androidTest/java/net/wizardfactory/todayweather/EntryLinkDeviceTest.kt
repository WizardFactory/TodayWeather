package net.wizardfactory.todayweather

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import kotlinx.coroutines.runBlocking
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * `todayweather://N` on a device (#2895 AC1), run by tools/backup/run-backup-test.sh with `link`:
 * - `seed`: three places, the first selected;
 * - `cold`: after the script opened `todayweather://2` with `am start` (resolved through the manifest's filter) in a
 *   stopped app, place 2 is selected and saved;
 * - `warm`: with the app open, `todayweather://1` reaches the same activity (`singleTop`) and selects place 1;
 * - `recents`: `todayweather://2` as Recents opens a finished task again (`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`, the
 *   task's first link delivered again) is handled and leaves place 1 selected; the same link without the flag then
 *   selects place 2.
 */
@RunWith(AndroidJUnit4::class)
class EntryLinkDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app get() = instrumentation.targetContext.applicationContext as TestTodayWeatherApp
    private val step = TestRunner.args.getString("link")
    private val places = listOf(Place.currentPositionPlaceholder(), Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98)),
        Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13)))

    @Test
    fun seed() {
        assumeTrue("needs -e link seed", step == "seed")
        runBlocking {
            app.migration.await()
            app.appState.dataStore.updateData { it.copy(places = places, placeIndex = 0).afterStart() }
        }
    }

    @Test
    fun coldStartSelectedThePlace() {
        assumeTrue("needs -e link cold", step == "cold")
        val state = runBlocking { app.migration.await().let { app.appState.dataStore.updateData { s -> s } } }
        assertEquals(places.map { it.name }, state.places.map { it.name })
        assertEquals(2, state.placeIndex)
    }

    @Test
    fun warmStartSelectsThePlace() {
        assumeTrue("needs -e link warm", step == "warm")
        runBlocking { app.migration.await() }
        instrumentation.targetContext.startActivity(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val first = waitFor { resumed() }
        instrumentation.targetContext.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://1")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitFor { app.appState.current()?.placeIndex?.takeIf { it == 1 } }
        assertTrue("the link reached the open activity", resumed() === first)
        assertEquals(1, runBlocking { app.appState.dataStore.updateData { it } }.placeIndex)
        instrumentation.runOnMainSync { first.finish() }
    }

    @Test
    fun aRelaunchFromRecentsKeepsThePlace() {
        assumeTrue("needs -e link recents", step == "recents")
        runBlocking { app.migration.await() }
        assertEquals(1, runBlocking { app.appState.dataStore.updateData { it } }.placeIndex)
        val link = Uri.parse("todayweather://2")
        val context = instrumentation.targetContext
        context.startActivity(Intent(Intent.ACTION_VIEW, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY))
        val first = waitFor { resumed() }
        waitFor { app.handled.firstOrNull { it.first.data == link && it.first.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0 } }
        Thread.sleep(2_000)
        assertEquals("the link delivered again selects nothing", 1, app.appState.current()?.placeIndex)
        context.startActivity(Intent(Intent.ACTION_VIEW, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitFor { app.appState.current()?.placeIndex?.takeIf { it == 2 } }
        assertEquals(2, runBlocking { app.appState.dataStore.updateData { it } }.placeIndex)
        instrumentation.runOnMainSync { first.finish() }
    }

    private fun resumed(): Activity? {
        var found: Activity? = null
        instrumentation.runOnMainSync { found = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).firstOrNull() }
        return found
    }

    private fun <T> waitFor(timeoutMs: Long = 20_000, value: () -> T?): T {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            value()?.let { return it }
            Thread.sleep(200)
        }
        error("timed out")
    }
}
