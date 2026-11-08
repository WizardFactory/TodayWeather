package net.wizardfactory.todayweather

import android.content.Intent
import android.os.Looper
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Entry intents wait for the migration and are then handled in arrival order on the main thread (#2886 AC4). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EntryIntentsTest {
    @Test
    fun intentsWaitForTheMigrationAndKeepTheirOrder() {
        val scope = CoroutineScope(SupervisorJob())
        val migration = CompletableDeferred<Unit>()
        val handled = mutableListOf<String>()
        val entries = EntryIntents(scope, migration) { handled += "${it.action}@${Thread.currentThread() == Looper.getMainLooper().thread}" }
        entries.submit(Intent("launcher"))
        entries.submit(Intent("tap"))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(emptyList<String>(), handled)

        migration.complete(Unit)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("launcher@true", "tap@true"), handled)

        entries.submit(Intent("later"))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("after the migration an intent is handled at once", "later@true", handled.last())
        scope.cancel()
    }
}
