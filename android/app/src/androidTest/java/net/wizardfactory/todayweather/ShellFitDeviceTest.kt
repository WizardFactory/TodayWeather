package net.wizardfactory.todayweather

import android.app.UiAutomation
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import net.wizardfactory.todayweather.ui.shell.ShellFit
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The app's shell fits its window while the window changes (#2886 AC3, [ShellFit]). MainActivity stays open while
 * the display rotates, shrinks to the width of a split-screen half and, on a foldable, folds and unfolds; after
 * each change the shell is checked on the main screen, with the menu and with the exit question.
 * tools/large-screen/run-shell-fit.sh runs it on a tablet and a foldable emulator; images of each state and the
 * window sizes go to the app's files/shell-fit/.
 */
@RunWith(AndroidJUnit4::class)
class ShellFitDeviceTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val automation = instrumentation.uiAutomation

    @Test
    fun theShellFitsWhileTheWindowChanges() {
        val dir = File(instrumentation.targetContext.filesDir, "shell-fit").apply { deleteRecursively(); mkdirs() }
        val (width, height) = Regex("""Physical size: (\d+)x(\d+)""").find(shell("wm size"))!!.destructured.toList().map { it.toInt() }
        val states = shell("cmd device_state print-states")
        fun state(name: String) = Regex("""identifier=(\d+), name='$name'""").find(states)?.groupValues?.get(1)
        val closed = state("CLOSED")
        val opened = state("OPENED")
        val changes = mutableListOf<Pair<String, () -> Unit>>(
            "natural" to { automation.setRotation(UiAutomation.ROTATION_FREEZE_0) },
            "rotated" to { automation.setRotation(UiAutomation.ROTATION_FREEZE_90) },
            "split-half" to {
                automation.setRotation(UiAutomation.ROTATION_FREEZE_0)
                shell("wm size ${width / 2}x$height")
            },
        )
        if (closed != null && opened != null) {
            changes += "folded" to {
                shell("wm size reset")
                shell("cmd device_state state $closed")
                // Folding locks the screen over the app ("Swipe up to continue"); continue as the user does.
                Thread.sleep(1000)
                shell("wm dismiss-keyguard")
            }
            changes += "folded-rotated" to { automation.setRotation(UiAutomation.ROTATION_FREEZE_90) }
            changes += "unfolded" to {
                automation.setRotation(UiAutomation.ROTATION_FREEZE_0)
                shell("cmd device_state state $opened")
            }
        }
        val problems = mutableListOf<String>()
        val sizes = StringBuilder()
        try {
            for ((name, change) in changes) {
                change()
                awaitShell()
                val config = rule.activity.resources.configuration
                sizes.appendLine("$name: ${config.screenWidthDp}x${config.screenHeightDp} dp")
                problems += ShellFit.check(rule) { state, image ->
                    File(dir, "$name-$state.png").outputStream().use { image.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
                }.map { "$name: $it" }
            }
        } finally {
            shell("wm size reset")
            if (closed != null) shell("cmd device_state state reset")
            automation.setRotation(UiAutomation.ROTATION_UNFREEZE)
            File(dir, "sizes.txt").writeText(sizes.toString())
        }
        assertEquals(emptyList<String>(), problems)
    }

    /** Waits for the activity that the change recreated to show the shell. */
    private fun awaitShell() {
        Thread.sleep(2000)
        rule.waitUntil(10_000) { rule.onAllNodes(hasTestTag(ShellTags.MENU_BUTTON)).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
    }

    private fun shell(command: String): String =
        automation.executeShellCommand(command).use { pfd -> android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).reader().readText() }
}
