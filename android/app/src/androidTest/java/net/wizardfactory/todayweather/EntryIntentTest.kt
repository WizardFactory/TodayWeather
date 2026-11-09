package net.wizardfactory.todayweather

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Entry intents wait for the Cordova data migration (#2886 AC4): the launcher intent and a notification tap that
 * arrive while the migration runs are handled after it has finished, in arrival order. `run-upgrade-test.sh` runs
 * it after the update with `migration` `hold`, which holds the migration of [TestTodayWeatherApp] until the test
 * releases it. Skipped without that argument. The activity is started as the launcher starts it; ActivityScenario
 * would wait for an idle main thread, which the splash screen kept during the migration does not leave.
 */
@RunWith(AndroidJUnit4::class)
class EntryIntentTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app = instrumentation.targetContext.applicationContext as TestTodayWeatherApp

    @Test
    fun entryIntentsArrivingDuringTheMigrationAreHandledAfterIt() {
        if (TestRunner.args.getString("migration") != "hold") return
        app.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(app, MainActivity::class.java.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(ENTRY, 1))
        await("the launcher intent opened the activity") { resumedEntry() == 1 }
        // A notification tap while the migration runs reaches the open activity (singleTop).
        app.startActivity(Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(ENTRY, 2))
        await("the tap reached the activity") { resumedEntry() == 2 }
        Thread.sleep(1000)
        assertFalse("the migration is held", app.migration.isCompleted)
        assertEquals("nothing handled during the migration", emptyList<Int>(), app.handled.map { it.first.getIntExtra(ENTRY, 0) })

        app.releaseMigration()
        await("both intents handled") { app.handled.size == 2 }
        assertEquals(listOf(1, 2), app.handled.map { it.first.getIntExtra(ENTRY, 0) })
        assertTrue("handled after the migration", app.handled.all { it.second })
        instrumentation.runOnMainSync { resumed()?.finish() }
    }

    private fun resumed() = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).firstOrNull { it is MainActivity }

    /** The entry number of the intent the resumed activity has, read on the main thread. */
    private fun resumedEntry(): Int {
        var entry = 0
        instrumentation.runOnMainSync { entry = resumed()?.intent?.getIntExtra(ENTRY, 0) ?: 0 }
        return entry
    }

    private fun await(what: String, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 10_000
        while (!condition()) {
            check(System.currentTimeMillis() < end) { "timed out: $what" }
            Thread.sleep(50)
        }
    }

    private companion object {
        const val ENTRY = "net.wizardfactory.todayweather.test.ENTRY"
    }
}
