package net.wizardfactory.todayweather.ui.shell

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.io.File
import net.wizardfactory.todayweather.core.domain.shell.Theme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The shell on large and resized windows (#2886 AC3, [ShellFit]): tablet and foldable sizes in both orientations,
 * a split-screen half and a small window, in Korean (region KR, with the Korea-only rows) and English. Images of
 * each state go to build/shell-fit/. The app's own activity is checked on the tablet and foldable emulators while it
 * rotates, resizes and folds (ShellFitDeviceTest, tools/large-screen/run-shell-fit.sh).
 */
abstract class ShellFitTest(private val lang: String, private val region: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val out = File(System.getProperty("tw.projectDir")!!, "build/shell-fit").apply { mkdirs() }

    @Test @Config(qualifiers = "+w1280dp-h800dp-land") fun tabletLandscape() = fits("tablet-landscape")
    @Test @Config(qualifiers = "+w800dp-h1280dp-port") fun tabletPortrait() = fits("tablet-portrait")
    @Test @Config(qualifiers = "+w841dp-h701dp-land") fun foldableOpen() = fits("fold-open")
    @Test @Config(qualifiers = "+w701dp-h841dp-port") fun foldableOpenRotated() = fits("fold-open-rotated")
    @Test @Config(qualifiers = "+w411dp-h797dp-port") fun foldableClosed() = fits("fold-closed")
    @Test @Config(qualifiers = "+w797dp-h411dp-land") fun foldableClosedRotated() = fits("fold-closed-rotated")
    @Test @Config(qualifiers = "+w640dp-h800dp-port") fun splitScreenHalf() = fits("split-half")
    @Test @Config(qualifiers = "+w320dp-h480dp-port") fun smallWindow() = fits("small-window")

    private fun fits(name: String) {
        ShellFit.show(rule, Theme.LIGHT, region)
        val problems = ShellFit.check(rule) { state, image ->
            File(out, "$lang-$name-$state.png").outputStream().use { image.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        assertEquals("$lang $name", emptyList<String>(), problems)
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class ShellFitKoTest : ShellFitTest("ko-KR", "KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class ShellFitEnTest : ShellFitTest("en-US", "US")
