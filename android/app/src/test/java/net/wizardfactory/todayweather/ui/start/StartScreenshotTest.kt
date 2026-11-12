package net.wizardfactory.todayweather.ui.start

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
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
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.shell.popupLines
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S01 and its access notice O01 against the Cordova build (#2889, manual pages 1 and 2), captured by
 * tools/start-reference/capture.sh at 384×762 dp (the WebView of a 384×832 dp screen, so 17 city shortcuts) and
 * density 2 in start-reference/<lang>. Each comparison passes within the tolerance recorded in
 * start-reference/tolerances.json; the notice's lines break where Chrome broke them, and the page's boxes (the icon,
 * the card, each shortcut and 현재위치 날씨보기) lie where the capture has them. Renders and overlays go to
 * build/start-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class StartScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private val references get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/start" }
        ?: "src/test/resources/start-reference")
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/start-compare").apply { mkdirs() }

    @Test fun korean() = checked { states("ko-KR") }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun english() = checked { states("en-US") }

    @Test fun koreanNoticeLines() = lines("ko-KR")

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishNoticeLines() = lines("en-US")

    @Test fun koreanBoxes() = boxes("ko-KR")

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishBoxes() = boxes("en-US")

    // New nominal-display captures coexist with the historical 384x762 body.
    private fun matrix(size: String, lang: String) {
        matrixSize = size
        checked {
            states(lang)
            boxes(lang, alreadyShown = true)
        }
    }

    @Config(qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
    @Test fun nominal384Korean() = matrix("384x832", "ko-KR")

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun nominal384English() = matrix("384x832", "en-US")

    @Config(qualifiers = "ko-rKR-w360dp-h780dp-xhdpi")
    @Test fun nominal360Korean() = matrix("360x780", "ko-KR")

    @Config(qualifiers = "en-rUS-w360dp-h780dp-xhdpi")
    @Test fun nominal360English() = matrix("360x780", "en-US")

    @Config(qualifiers = "ko-rKR-w412dp-h892dp-xhdpi")
    @Test fun nominal412Korean() = matrix("412x892", "ko-KR")

    @Config(qualifiers = "en-rUS-w412dp-h892dp-xhdpi")
    @Test fun nominal412English() = matrix("412x892", "en-US")

    @Config(qualifiers = "ko-rKR-w320dp-h694dp-xhdpi")
    @Test fun nominal320Korean() = matrix("320x694", "ko-KR")

    @Config(qualifiers = "en-rUS-w320dp-h694dp-xhdpi")
    @Test fun nominal320English() = matrix("320x694", "en-US")

    /** O01's body breaks where Chrome broke it: each line of the capture's line boxes, without its trailing space. */
    private fun lines(lang: String) {
        val captured = capture(lang, "access")["lines"]!!.jsonArray.map { it.jsonObject["text"]!!.jsonPrimitive.content.trimEnd() }
        var native = emptyList<String>()
        rule.setContent {
            native = popupLines(rememberTextMeasurer(), listOf(stringResource(R.string.LOC_STORAGE_SPACE), stringResource(R.string.LOC_LOCATION_ACCESS),
                stringResource(R.string.LOC_CALL_INFORMATION)), LocalDensity.current)
        }
        rule.waitForIdle()
        assertEquals(captured, native)
    }

    /**
     * The page's boxes against start.json: the icon and the first card within 0.5 dp; the search glyph and the input
     * centered on the capture's middle of the row within 0.5 dp; each shortcut on the capture's row within 0.5 dp and
     * 현재위치 날씨보기 at the capture's top, their left edges within 1 dp and their widths within 1.5 dp. The labels'
     * widths come from Robolectric's fonts, not the emulator's: the Korean bold label of 현재위치 날씨보기 is 1.4 dp wider
     * here.
     */
    private fun boxes(lang: String, alreadyShown: Boolean = false) {
        val capture = capture(lang, "start")
        if (!alreadyShown) show(lang = lang)
        fun rect(o: JsonObject) = o["rect"]!!.jsonObject.let { r -> listOf("x", "y", "w", "h").map { r[it]!!.jsonPrimitive.double.toFloat() } }
        fun check(name: String, tag: String, want: List<Float>, position: Float = 0.5f, width: Float = 0.5f) {
            val r = rule.onNodeWithTag(tag).getUnclippedBoundsInRoot()
            val got = listOf(r.left.value, r.top.value, r.right.value - r.left.value, r.bottom.value - r.top.value)
            assertEquals("$lang $name left", want[0], got[0], position)
            assertEquals("$lang $name top", want[1], got[1], 0.5f)
            assertEquals("$lang $name width", want[2], got[2], width)
            assertEquals("$lang $name height", want[3], got[3], 0.5f)
        }
        check("icon", StartTags.ICON, rect(capture["icon"]!!.jsonObject))
        for ((name, tag) in listOf("glyph" to StartTags.GLYPH, "input" to StartTags.INPUT)) {
            val want = rect(capture[name]!!.jsonObject).let { it[1] + it[3] / 2 }
            val r = rule.onNodeWithTag(tag, useUnmergedTree = true).getUnclippedBoundsInRoot()
            assertEquals("$lang $name middle", want, (r.top.value + r.bottom.value) / 2, 0.5f)
        }
        val card = capture["lists"]!!.jsonArray[0].jsonObject
        check("card", StartTags.CARD, rect(card))
        capture["chips"]!!.jsonArray.forEachIndexed { i, chip ->
            check("shortcut $i ${chip.jsonObject["text"]!!.jsonPrimitive.content}", StartTags.chip(i), rect(chip.jsonObject), position = 1f, width = 1.5f)
        }
        check("location", StartTags.LOCATION, rect(capture["location"]!!.jsonObject), position = 1f, width = 1.5f)
    }

    private fun show(lang: String, notice: () -> Boolean = { false }) {
        val view = capture(lang, "start")["view"]!!.jsonObject
        val width = view.num("width").toFloat()
        val height = view.num("height").toFloat()
        rule.setContent {
            Box(Modifier.size(width.dp, height.dp).testTag(ROOT)) {
                StartContent(null, { TownSearch(emptyList()) }, onShortcut = {}, onPrediction = { _, _ -> }, onTown = {}, onLocation = {})
                if (notice()) AccessNotice {}
            }
        }
        rule.waitForIdle()
    }

    private fun states(lang: String) {
        var notice by mutableStateOf(true)
        show(lang) { notice }
        compare("$lang/access")
        notice = false
        rule.waitForIdle()
        compare("$lang/start")
    }

    private fun capture(lang: String, state: String) = Json.parseToJsonElement(File(references, "$lang/$state.json").readText()).jsonObject

    private val failures = mutableListOf<String>()

    /** The whole 384×762 dp root against the capture of [name]. */
    private fun compare(name: String) {
        val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels()
        val cordova = ImageIO.read(File(references, "$name.png")).toPixels()
        val diff = ImageDiff.of(native, cordova)
        val base = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
        ImageIO.write(native.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("start-compare ${matrixSize ?: "historical"}/$name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
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
        const val ROOT = "start-compare-root"
    }
}
