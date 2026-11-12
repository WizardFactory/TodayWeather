package net.wizardfactory.todayweather.ui.shell

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.*
import net.wizardfactory.todayweather.core.domain.forecast.PollenRow
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.PollenDialog
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.SourceDialog
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** O03 weather, both O08 sources, X2 pollen and O15: actual Cordova popup cuts. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class DialogScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val project = File(System.getProperty("tw.projectDir")!!)

    @Test fun korean384() = compare("384x832", "ko-KR")
    @Test @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi") fun english384() = compare("384x832", "en-US")
    @Test @Config(qualifiers = "ko-rKR-w360dp-h780dp-xhdpi") fun korean360() = compare("360x780", "ko-KR")
    @Test @Config(qualifiers = "en-rUS-w360dp-h780dp-xhdpi") fun english360() = compare("360x780", "en-US")
    @Test @Config(qualifiers = "ko-rKR-w412dp-h892dp-xhdpi") fun korean412() = compare("412x892", "ko-KR")
    @Test @Config(qualifiers = "en-rUS-w412dp-h892dp-xhdpi") fun english412() = compare("412x892", "en-US")
    @Test @Config(qualifiers = "ko-rKR-w320dp-h694dp-xhdpi") fun korean320() = compare("320x694", "ko-KR")
    @Test @Config(qualifiers = "en-rUS-w320dp-h694dp-xhdpi") fun english320() = compare("320x694", "en-US")

    private fun compare(size: String, lang: String) {
        val references = File(project, "src/test/resources/parity-reference/$size/dialog")
        val view = read(File(references, "$lang/viewport.json"))["webView"]!!.jsonObject
        val tolerances = File(references, "tolerances.json").takeIf { it.exists() }?.let(::read)
        val output = File(project, "build/dialog-compare/$size/$lang").apply { mkdirs() }
        val selected = mutableIntStateOf(0)
        val texts = forecastTexts(rule.activity)
        val pollen = listOf("OAK", "PINE", "WEEDS").map {
            PollenRow("LOC_POLLEN_$it", "높음", "LOC_POLLEN_${it}_INFO", "LOC_POLLEN_ADVICE_2")
        }
        val backdrop = BitmapFactory.decodeFile(File(references, "$lang/background.png").path).asImageBitmap()
        rule.setContent {
            Box(Modifier.size(view.num("width").toFloat().dp, view.num("height").toFloat().dp).background(Color.White)) {
                Image(backdrop, contentDescription = null, modifier = Modifier.fillMaxSize())
                    when (selected.intValue) {
                        0 -> RetryDialog({}, {})
                        1 -> SourceDialog("kaq", texts) {}
                        2 -> SourceDialog("airkorea", texts) {}
                        3 -> PollenDialog(pollen, texts) {}
                        4 -> ExitDialog({}, {})
                    }
            }
        }
        val failures = mutableListOf<String>()
        for ((index, name) in listOf("retry", "source-kaq", "source-airkorea", "pollen", "exit").withIndex()) {
            rule.runOnIdle { selected.intValue = index }
            rule.waitForIdle()
            rule.waitForIdle()
            val capture = read(File(references, "$lang/$name.json"))
            val expected = capture["popup"]!!.jsonObject["rect"]!!.jsonObject
            val body = capture["parts"]!!.jsonArray.map { it.jsonObject }.first { it["cls"]!!.jsonPrimitive.content == "popup-body" }
            val renderedText = rule.onAllNodes(hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true).fetchSemanticsNodes()
                .flatMap { it.config.getOrElse(SemanticsProperties.Text) { emptyList() } }.joinToString("") { it.text }
            fun compact(s: String) = s.replace(Regex("\\s+"), "")
            assertTrue("$name body is present in native semantics", compact(renderedText).contains(compact(body["text"]!!.jsonPrimitive.content)))
            val popup = rule.onNodeWithTag(PopupTags.POPUP)
            val bounds = popup.getUnclippedBoundsInRoot()
            for ((key, actual) in listOf("x" to bounds.left.value, "y" to bounds.top.value, "w" to (bounds.right - bounds.left).value, "h" to (bounds.bottom - bounds.top).value)) {
                if (kotlin.math.abs(expected.num(key) - actual) > 0.75) failures += "$name $key: $actual vs ${expected.num(key)}"
            }
            val native = popup.captureToImage().asAndroidBitmap().pixels()
            val cordova = ImageIO.read(File(references, "$lang/$name.png")).pixels()
            val diff = ImageDiff.of(native, cordova)
            ImageIO.write(native.buffered(), "png", File(output, "$name-native.png"))
            ImageIO.write(ImageDiff.overlay(native, cordova).buffered(), "png", File(output, "$name-diff.png"))
            println("dialog-compare $size/$lang/$name $diff")
            val limit = tolerances?.get("cases")?.jsonObject?.get("$lang/$name")?.jsonObject
            if (limit == null) failures += "$name: missing tolerance ($diff)"
            else if (native.width != cordova.width || kotlin.math.abs(diff.heightDifference) > limit.num("heightDifference") ||
                diff.strong > limit.num("strong") + 0.002 || diff.mean > limit.num("mean") + 0.4) failures += "$name: $diff exceeds $limit"
            if (name == "pollen") {
                val source = rule.onNodeWithText(texts["LOC_POLLEN_SOURCE"], useUnmergedTree = true).performScrollTo()
                val visible = source.getBoundsInRoot()
                val whole = source.getUnclippedBoundsInRoot()
                assertTrue("pollen source fully reachable", kotlin.math.abs(visible.top.value - whole.top.value) <= 0.5f &&
                    kotlin.math.abs(visible.bottom.value - whole.bottom.value) <= 0.5f)
            }
            if (name == "exit") rule.onAllNodesWithTag(PopupTags.BUTTON)[0].performClick()
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun read(file: File) = Json.parseToJsonElement(file.readText()).jsonObject
    private fun JsonObject.num(key: String) = getValue(key).jsonPrimitive.double
    private fun Bitmap.pixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.pixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.buffered() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
}
