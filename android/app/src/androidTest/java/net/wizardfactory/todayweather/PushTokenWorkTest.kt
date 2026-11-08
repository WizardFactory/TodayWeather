package net.wizardfactory.todayweather

import android.os.Process
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.core.storage.PushRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A token FCM delivers is registered by WorkManager work that completes after the process ended (#2883 review F3).
 * `run-upgrade-test.sh` runs the two tests in separate instrumentations after [CordovaUpgradeTest], without opening
 * the app; `previous` is the token the app stored. In [tokenWorkIsInterruptedWithItsRequestInFlight] the token
 * arrives and its `PUT` stays in flight (`transport` `hold`) until the end of the instrumentation kills the process.
 * [tokenWorkCompletesAfterTheProcessEnded] runs in a new process: WorkManager runs the stored work again, after its
 * backoff for the interrupted run, and the work replaces the token. Skipped without `previous`.
 */
@RunWith(AndroidJUnit4::class)
class PushTokenWorkTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app = instrumentation.targetContext.applicationContext as TestTodayWeatherApp
    private val previous: String? = InstrumentationRegistry.getArguments().getString("previous")

    @Test
    fun tokenWorkIsInterruptedWithItsRequestInFlight() {
        val previous = previous ?: return
        PushTokenWorker.enqueue(app, NEW_TOKEN).result.get()
        assertEquals(WorkInfo.State.RUNNING, awaitState(WorkInfo.State.RUNNING))
        val end = System.currentTimeMillis() + 30_000
        while (app.sent.isEmpty() && System.currentTimeMillis() < end) Thread.sleep(100)
        assertReplacement(app.sent.single(), previous)
        Thread.sleep(1000)
        assertEquals("the request is still in flight", WorkInfo.State.RUNNING, awaitState(WorkInfo.State.RUNNING))
        assertNull("not opened", app.opened)
        assertEquals("stored after the request returns", previous, runBlocking { AppStateStore.get(app).data.first() }.push.fcmToken)
        File(app.filesDir, PID_FILE).writeText(Process.myPid().toString())
    }

    @Test
    fun tokenWorkCompletesAfterTheProcessEnded() {
        val previous = previous ?: return
        val waitingPid = File(app.filesDir, PID_FILE).readText().toInt()
        assertNotEquals(waitingPid, Process.myPid())
        assertFalse("the process of the waiting work ended", File("/proc/$waitingPid").exists())
        assertEquals(WorkInfo.State.SUCCEEDED, awaitState(WorkInfo.State.SUCCEEDED))
        assertNull("not opened: no start registration", app.opened)
        assertReplacement(app.sent.single(), previous)
        assertEquals(NEW_TOKEN, runBlocking { AppStateStore.get(app).data.first() }.push.fcmToken)
    }

    private fun assertReplacement(put: PushRequest, previous: String) {
        assertEquals("PUT", put.method)
        assertEquals("/v000903/push", put.path)
        assertEquals(NEW_TOKEN, put.body.jsonObject["newToken"]!!.jsonPrimitive.content)
        assertEquals(previous, put.body.jsonObject["oldToken"]!!.jsonPrimitive.content)
    }

    /** The state of the single token work once it is [target], or the last one seen within 90 seconds. */
    private fun awaitState(target: WorkInfo.State): WorkInfo.State? {
        var state: WorkInfo.State? = null
        val end = System.currentTimeMillis() + 90_000
        while (System.currentTimeMillis() < end) {
            val infos = WorkManager.getInstance(app).getWorkInfosForUniqueWork(PushTokenWorker.WORK).get()
            assertEquals("one token work", 1, infos.size)
            state = infos.single().state
            if (state == target) break
            Thread.sleep(200)
        }
        return state
    }

    private companion object {
        const val NEW_TOKEN = "token-c"
        const val PID_FILE = "push-token-work-test.pid"
    }
}
