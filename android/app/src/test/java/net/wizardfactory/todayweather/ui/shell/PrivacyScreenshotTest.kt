package net.wizardfactory.todayweather.ui.shell

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The menu's privacy rows against the Cordova build (#2894, manual page 37), captured by
 * tools/privacy-reference/capture.sh at 384×762 dp (the WebView) and density 2 in privacy-reference/<lang>: the menu
 * scrolled to its end with 선택적 이용 통계 · 꺼짐 and · 동의함, and the usage analytics popup over it, in Korean and
 * English. Each comparison passes within the tolerance recorded in privacy-reference/tolerances.json. Renders and
 * overlays go to build/privacy-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
class PrivacyScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private val references get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/privacy" }
        ?: "src/test/resources/privacy-reference")
    private fun bodySize(lang: String): Pair<Float, Float> {
        if (matrixSize == null) return 384f to 762f
        val view = Json.parseToJsonElement(File(references, "$lang/viewport.json").readText()).jsonObject["webView"]!!.jsonObject
        return view.num("width").toFloat() to view.num("height").toFloat()
    }
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/privacy-compare").apply { mkdirs() }

    @Test fun korean() = checked { states("ko-KR", "KR") }

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun english() = checked { states("en-US", "US") }

    @Test fun koreanLines() = lines("ko-KR")

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun englishLines() = lines("en-US")

    private fun matrix(size: String, lang: String, region: String) = checked {
        matrixSize = size
        states(lang, region)
    }

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384Korean() = matrix("384x832", "ko-KR", "KR")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384English() = matrix("384x832", "en-US", "US")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360Korean() = matrix("360x780", "ko-KR", "KR")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360English() = matrix("360x780", "en-US", "US")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412Korean() = matrix("412x892", "ko-KR", "KR")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412English() = matrix("412x892", "en-US", "US")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320Korean() = matrix("320x694", "ko-KR", "KR")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320English() = matrix("320x694", "en-US", "US")

    /** The popup's body breaks where Chrome broke it: each line of the capture's line boxes, without its trailing space. */
    private fun lines(lang: String) {
        val captured = Json.parseToJsonElement(File(references, "$lang/analytics-popup.json").readText()).jsonObject["lines"]!!
            .jsonArray.map { it.jsonObject["text"]!!.jsonPrimitive.content.trimEnd() }
        var native = emptyList<String>()
        rule.setContent {
            native = popupLines(rememberTextMeasurer(), listOf(stringResource(R.string.LOC_ANALYTICS_DETAIL)), LocalDensity.current)
        }
        rule.waitForIdle()
        assertEquals(captured, native)
    }

    private fun states(lang: String, region: String) {
        var allowed by mutableStateOf(false)
        var popup by mutableStateOf(false)
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            Box(Modifier.size(bodySize(lang).first.dp, bodySize(lang).second.dp).testTag(ROOT)) {
                SideMenu(ShellState(Theme.LIGHT, region, Tab.HOURLY, "1.1.1", mapOf(MenuRow.STARTUP_PAGE to texts["LOC_HOURLY_FORECAST"],
                    MenuRow.REFRESH_INTERVAL to texts["LOC_MANUAL"], MenuRow.THEME to texts["LOC_LIGHT_THEME"],
                    MenuRow.ANALYTICS to stringResource(if (allowed) R.string.LOC_ANALYTICS_ALLOWED else R.string.LOC_ANALYTICS_DISABLED)))) {}
                if (popup) {
                    IonicPopup(stringResource(R.string.LOC_ANALYTICS_CHOICE), listOf(stringResource(R.string.LOC_ANALYTICS_DETAIL)),
                        listOf(PopupButton(stringResource(R.string.LOC_ANALYTICS_DENY)) {}, PopupButton(stringResource(R.string.LOC_ANALYTICS_ALLOW)) {}),
                        onBack = {})
                }
            }
        }
        rule.onNodeWithTag(ShellTags.row(MenuRow.ABOUT)).performScrollTo()
        rule.waitForIdle()
        compare("$lang/menu-off")
        popup = true
        rule.waitForIdle()
        compare("$lang/analytics-popup")
        popup = false
        allowed = true
        rule.waitForIdle()
        compare("$lang/menu-allowed")
    }

    private val failures = mutableListOf<String>()

    /** The whole 384×762 dp root against the capture of [name]. */
    private fun compare(name: String) {
        val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels()
        val cordova = ImageIO.read(File(references, "$name.png")).toPixels()
        val diff = ImageDiff.of(native, cordova)
        val base = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
        ImageIO.write(native.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("privacy-compare ${matrixSize ?: "historical"}/$name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
        val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
        val margin = tolerances["margin"]?.jsonObject
        if (limit == null || margin == null) {
            failures += "$name: no recorded tolerance, $diff"
        } else if (native.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
            diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
            failures += "$name: $diff, recorded $limit"
        }
    }

    /** Runs [comparisons], then fails with every comparison over its tolerance. */
    private fun checked(comparisons: () -> Unit) {
        comparisons()
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }

    private companion object {
        const val ROOT = "privacy-compare-root"
    }
}
