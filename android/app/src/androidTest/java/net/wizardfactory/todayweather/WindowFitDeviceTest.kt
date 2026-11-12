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
import org.junit.rules.RuleChain
import org.junit.Test
import org.junit.runner.RunWith

/** Proves actual multi-window (not display resizing) and checks the shell after rotation and restoration. */
@RunWith(AndroidJUnit4::class)
class WindowFitDeviceTest {
    val rule = createAndroidComposeRule<MainActivity>()

    // Past the start page without a place: the weather pages ask how to start (O02), and the tests go on from Locations.
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule { net.wizardfactory.todayweather.core.storage.AppState().afterStart() }).around(rule)

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val automation = instrumentation.uiAutomation

    @Test
    fun theShellFitsInActualMultiWindow() {
        val dir = File(instrumentation.targetContext.filesDir, "window-fit").apply { deleteRecursively(); mkdirs() }
        val taskId = rule.activity.taskId
        val changes = mutableListOf<Pair<String, () -> Unit>>(
            "full" to { automation.setRotation(UiAutomation.ROTATION_FREEZE_0) },
            "split" to {
                shell("am start -W -a android.settings.SETTINGS")
                shell("dumpsys activity service SystemUIService WMShell splitscreen moveToSideStage $taskId 1")
            },
            "split-rotated" to { automation.setRotation(UiAutomation.ROTATION_FREEZE_90) },
            "full-restored" to { shell("dumpsys activity service SystemUIService WMShell splitscreen exitSplitScreen $taskId") },
        )
        val states = shell("cmd device_state print-states")
        fun state(name: String) = Regex("identifier=(\\d+), name='$name'").find(states)?.groupValues?.get(1)
        val closed = state("CLOSED")
        val opened = state("OPENED")
        if (TestRunner.args.getString("fold") == "true") {
            org.junit.Assert.assertNotNull("foldable must expose CLOSED", closed)
            org.junit.Assert.assertNotNull("foldable must expose OPENED", opened)
        }
        if (closed != null && opened != null) {
            changes += "folded" to {
                automation.setRotation(UiAutomation.ROTATION_FREEZE_0)
                shell("cmd device_state state $closed")
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
            rule.closeStartChoice()
            val walk = if (TestRunner.args.getString("screens") == "true") ScreenFitWalk(rule).also { it.seed() } else null
            for ((name, change) in changes) {
                change()
                awaitShell()
                val config = rule.activity.resources.configuration
                assertEquals("requested font scale", TestRunner.args.getString("expectedFont", "1.0").toFloat(), config.fontScale, 0.01f)
                val activity = rule.activity
                val current = activity.windowManager.currentWindowMetrics.bounds
                val maximum = activity.windowManager.maximumWindowMetrics.bounds
                val multi = activity.isInMultiWindowMode
                sizes.appendLine("$name: ${config.screenWidthDp}x${config.screenHeightDp} dp font=${config.fontScale} multi=$multi current=$current maximum=$maximum")
                if (name.startsWith("split")) {
                    org.junit.Assert.assertTrue("$name must really be multi-window", multi)
                    org.junit.Assert.assertTrue("$name must be smaller than display", current.width() < maximum.width() || current.height() < maximum.height())
                } else org.junit.Assert.assertFalse("$name must be full screen", multi)
                automation.takeScreenshot()?.let { bitmap ->
                    File(dir, "$name-display.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
                if (walk != null) problems += walk.walk { page ->
                    automation.takeScreenshot()?.let { bitmap ->
                        File(dir, "$name-$page-display.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    }
                }.map { "$name: $it" }
                problems += ShellFit.check(rule) { state, image ->
                    val insets = androidx.core.view.ViewCompat.getRootWindowInsets(rule.activity.window.decorView)
                    sizes.appendLine("$name/$state insets=" + insets?.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()))
                    automation.takeScreenshot()?.let { bitmap ->
                        File(dir, "$name-$state-display.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    }
                    File(dir, "$name-$state.png").outputStream().use { image.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
                }.map { "$name: $it" }
            }
        } finally {
            automation.takeScreenshot()?.let { bitmap ->
                File(dir, "end-display.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            shell("wm size reset")
            if (closed != null) shell("cmd device_state state reset")
            shell("dumpsys activity service SystemUIService WMShell splitscreen exitSplitScreen $taskId")
            shell("am force-stop com.android.settings")
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
