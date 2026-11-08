package net.wizardfactory.todayweather.ui.shell

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The native shell against the Cordova shell (#2886 AC2): tab bar, header bar and side menu in each theme on the
 * Hourly tab of a saved place, rendered at density 2 and compared with the screen captures in
 * shell-reference/<lang> (tools/shell-reference/capture.sh) within the tolerance recorded for each comparison in
 * shell-reference/tolerances.json. Renders and overlays go to build/shell-compare/.
 */
abstract class ShellScreenshotTest(private val lang: String, private val region: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val references = File(project, "src/test/resources/shell-reference")
    private val tolerances = Json.parseToJsonElement(File(references, "tolerances.json").readText()).jsonObject
    private val out = File(project, "build/shell-compare").apply { mkdirs() }

    @Test fun light() = compare(Theme.LIGHT)
    @Test fun dark() = compare(Theme.DARK)
    @Test fun photo() = compare(Theme.PHOTO)
    @Test fun old() = compare(Theme.OLD)

    private fun compare(theme: Theme) {
        val record = Json.parseToJsonElement(File(references, "$lang/${theme.key}.json").readText()).jsonObject
        val colors = ShellColors.of(theme, Tab.HOURLY)
        val parts = listOf("tabs", "header", "menu")
        var part by mutableStateOf(parts.first())
        rule.setContent {
            Box(Modifier.testTag("part")) {
                when (part) {
                    "tabs" -> Box(Modifier.width(384.dp)) { TabBar(Tab.HOURLY, colors) {} }
                    // The photo theme's clear header over the page's white header block (no photo offline).
                    "header" -> Box(Modifier.width(384.dp).background(Color.White)) {
                        HeaderBar(colors, "회현동", onMenu = {}) {
                            // tab-forecast.html: the bell (no alarms) and share buttons, 4 dp padding, 4 dp after the share.
                            BarButton(Glyphs.NOTIFICATIONS_NONE, colors, {}, padding = 4.dp)
                            BarButton(Glyphs.SHARE, colors, {}, Modifier.padding(end = 4.dp), padding = 4.dp)
                        }
                    }
                    else -> Box(Modifier.size(384.dp, record["menu"]!!.jsonObject["rect"]!!.jsonObject["h"]!!.jsonPrimitive.double.dp)) {
                        SideMenu(state(theme)) {}
                    }
                }
            }
        }
        val failures = mutableListOf<String>()
        for (p in parts) {
            rule.runOnIdle { part = p }
            rule.waitForIdle()
            val native = rule.onNodeWithTag("part").captureToImage().asAndroidBitmap().toPixels()
            val captured = record[if (p == "tabs") "tabs" else p]!!.jsonObject["clip"]!!.jsonObject
            val cordova = ImageIO.read(File(references, "$lang/${theme.key}-$p.png")).toPixels()
                .crop(captured.int("offset", "x"), captured.int("offset", "y"), captured.int("size", "width"), captured.int("size", "height"))
            val diff = ImageDiff.of(native, cordova)
            val name = "$lang-${theme.key}-$p"
            ImageIO.write(native.toBufferedImage(), "png", File(out, "$name-native.png"))
            ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$name-diff.png"))
            println("shell-compare $name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
            val limit = tolerances["cases"]!!.jsonObject[name]?.jsonObject
            if (limit == null) {
                failures += "$name: no recorded tolerance, $diff"
                continue
            }
            val margin = tolerances["margin"]!!.jsonObject
            if (native.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
                diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
                failures += "$name: $diff (native ${native.width}x${native.height}, cordova ${cordova.width}x${cordova.height}), recorded $limit"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    /** As captured: Cordova 1.1.1, default settings, analytics not chosen. */
    @Composable
    private fun state(theme: Theme) = ShellState(theme, region, Tab.HOURLY, "1.1.1", mapOf(
        MenuRow.STARTUP_PAGE to stringResource(R.string.LOC_HOURLY_FORECAST),
        MenuRow.REFRESH_INTERVAL to stringResource(R.string.LOC_MANUAL),
        MenuRow.THEME to stringResource(when (theme) {
            Theme.LIGHT -> R.string.LOC_LIGHT_THEME
            Theme.DARK -> R.string.LOC_DARK_THEME
            Theme.PHOTO -> R.string.LOC_WEATHER_PHOTO_THEME
            Theme.OLD -> R.string.LOC_OLD_THEME
        }),
        MenuRow.ANALYTICS to stringResource(R.string.LOC_ANALYTICS_DISABLED),
    ))

    private fun JsonObject.int(a: String, b: String) = this[a]!!.jsonObject[b]!!.jsonPrimitive.content.toInt()
    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
class ShellScreenshotKoTest : ShellScreenshotTest("ko-KR", "KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
class ShellScreenshotEnTest : ShellScreenshotTest("en-US", "US")
