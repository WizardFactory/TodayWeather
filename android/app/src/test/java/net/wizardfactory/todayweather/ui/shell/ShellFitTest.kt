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
 * a split-screen half and a small window, and three of them at font scale 1.3, in Korean (region KR, with the
 * Korea-only rows) and English. Images of
 * each state go to build/shell-fit/. The app's own activity is checked on the tablet and foldable emulators while it
 * rotates, resizes and folds (ShellFitDeviceTest, tools/large-screen/run-shell-fit.sh).
 */
abstract class ShellFitTest(lang: String, region: String) : ShellFitCase(lang, region) {
    @Test @Config(qualifiers = "+w1280dp-h800dp-land") fun tabletLandscape() = fits("tablet-landscape")
    @Test @Config(qualifiers = "+w800dp-h1280dp-port") fun tabletPortrait() = fits("tablet-portrait")
    @Test @Config(qualifiers = "+w841dp-h701dp-land") fun foldableOpen() = fits("fold-open")
    @Test @Config(qualifiers = "+w701dp-h841dp-port") fun foldableOpenRotated() = fits("fold-open-rotated")
    @Test @Config(qualifiers = "+w411dp-h797dp-port") fun foldableClosed() = fits("fold-closed")
    @Test @Config(qualifiers = "+w797dp-h411dp-land") fun foldableClosedRotated() = fits("fold-closed-rotated")
    @Test @Config(qualifiers = "+w640dp-h800dp-port") fun splitScreenHalf() = fits("split-half")
    @Test @Config(qualifiers = "+w320dp-h480dp-port") fun smallWindow() = fits("small-window")

    // Text follows the system font scale (AN-06); the shell keeps fitting at 1.3.
    // AN-18 AC4: window-size coverage; real multi-window is checked separately on device.
    @Test @Config(qualifiers = "+w800dp-h1280dp-port", fontScale = 1.3f) fun tabletPortraitLargeText() = fits("tabletPortraitLargeText")
    @Test @Config(qualifiers = "+w841dp-h701dp-land", fontScale = 1.3f) fun foldableOpenLargeText() = fits("foldableOpenLargeText")
    @Test @Config(qualifiers = "+w701dp-h841dp-port", fontScale = 1.3f) fun foldableOpenRotatedLargeText() = fits("foldableOpenRotatedLargeText")
    @Test @Config(qualifiers = "+w411dp-h797dp-port", fontScale = 1.3f) fun foldableClosedLargeText() = fits("foldableClosedLargeText")
    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f) fun foldableClosedRotatedLargeText() = fits("foldableClosedRotatedLargeText")
    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f) fun phoneLandscapeLargeText() = fits("phoneLandscapeLargeText")
    @Test @Config(qualifiers = "+w640dp-h800dp-port", fontScale = 1.3f) fun splitHalfLargeText() = fits("splitHalfLargeText")
    @Test @Config(qualifiers = "+w421dp-h701dp-port", fontScale = 1.3f) fun foldableSplitLargeText() = fits("foldableSplitLargeText")

    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f) fun phoneLargeText() = fits("phone-text-1.3")
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun smallWindowLargeText() = fits("small-window-text-1.3")
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f) fun tabletLargeText() = fits("tablet-landscape-text-1.3")
}

/** The other four catalogs in the narrowest windows, where their longer texts come closest to being cut (#2912 F2). */
abstract class ShellFitNarrowTest(lang: String, region: String) : ShellFitCase(lang, region) {
    @Test @Config(qualifiers = "+w320dp-h480dp-port") fun smallWindow() = fits("small-window")
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun smallWindowLargeText() = fits("small-window-text-1.3")
    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f) fun phoneLargeText() = fits("phone-text-1.3")
}

abstract class ShellFitCase(private val lang: String, private val region: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val out = File(System.getProperty("tw.projectDir")!!, "build/shell-fit").apply { mkdirs() }

    protected fun fits(name: String) {
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

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ja-rJP-xhdpi")
class ShellFitJaTest : ShellFitNarrowTest("ja-JP", "JP")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "de-rDE-xhdpi")
class ShellFitDeTest : ShellFitNarrowTest("de-DE", "DE")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "zh-rCN-xhdpi")
class ShellFitZhCnTest : ShellFitNarrowTest("zh-CN", "CN")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "zh-rTW-xhdpi")
class ShellFitZhTwTest : ShellFitNarrowTest("zh-TW", "TW")
