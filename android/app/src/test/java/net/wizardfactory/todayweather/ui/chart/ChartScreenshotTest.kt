package net.wizardfactory.todayweather.ui.chart

import android.graphics.Bitmap
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Compose charts against the Cordova captures (gate G2, #2884): for each captured screen size, the hourly
 * chart (detail rows shown) and the daily chart at the opening position and both scroll ends, rendered at
 * density 2 like the captures and compared with [ImageDiff] within the tolerance recorded for that comparison in
 * chart-reference/tolerances.json. Renders, overlays and measured values go to build/chart-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
class ChartScreenshotTest {
    @get:Rule val rule = createComposeRule()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private var matrixLang = "ko-KR"
    private val scenes get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/chart" }
        ?: "../core-domain/src/test/resources/chart-reference")
    private val corpus = File(project, "../core-domain/src/test/resources/corpus")
    private val references get() = scenes
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/chart-compare").apply { mkdirs() }

    @Test fun hourly384() = compare("384x832", "hourly")
    @Test fun hourly360() = compare("360x780", "hourly")
    @Test fun hourly412() = compare("412x892", "hourly")
    @Test fun daily384() = compare("384x832", "daily")
    @Test fun daily360() = compare("360x780", "daily")
    @Test fun daily412() = compare("412x892", "daily")

    private fun matrix(size: String, lang: String, chart: String) {
        matrixSize = size
        matrixLang = lang
        compare(size, chart)
    }

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal384KoreanHourly() = matrix("384x832", "ko-KR", "hourly")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal384KoreanDaily() = matrix("384x832", "ko-KR", "daily")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal384EnglishHourly() = matrix("384x832", "en-US", "hourly")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal384EnglishDaily() = matrix("384x832", "en-US", "daily")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal360KoreanHourly() = matrix("360x780", "ko-KR", "hourly")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal360KoreanDaily() = matrix("360x780", "ko-KR", "daily")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal360EnglishHourly() = matrix("360x780", "en-US", "hourly")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal360EnglishDaily() = matrix("360x780", "en-US", "daily")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal412KoreanHourly() = matrix("412x892", "ko-KR", "hourly")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal412KoreanDaily() = matrix("412x892", "ko-KR", "daily")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal412EnglishHourly() = matrix("412x892", "en-US", "hourly")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal412EnglishDaily() = matrix("412x892", "en-US", "daily")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal320KoreanHourly() = matrix("320x694", "ko-KR", "hourly")

    @Test @Config(qualifiers = "ko-rKR-w420dp-h900dp-xhdpi")
    fun nominal320KoreanDaily() = matrix("320x694", "ko-KR", "daily")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal320EnglishHourly() = matrix("320x694", "en-US", "hourly")

    @Test @Config(qualifiers = "en-rUS-w420dp-h900dp-xhdpi")
    fun nominal320EnglishDaily() = matrix("320x694", "en-US", "daily")

    private fun compare(size: String, chart: String) {
        val fixture = "kma-seoul"
        val directory = if (matrixSize == null) size else matrixLang
        val (w, h) = size.split("x").map { it.toDouble() }
        val record = Json.parseToJsonElement(File(scenes, "$directory/$fixture.json").readText()).jsonObject
        val captured = record[chart]!!.jsonObject
        val place = WeatherConverter.convert(input(fixture))!!
        val metrics = ChartMetrics(w, h)
        val texts = chartTexts(ApplicationProvider.getApplicationContext())
        val wrapperWidth = captured["wrapper"]!!.jsonObject["w"]!!.jsonPrimitive.double
        val margin = tolerances["margin"]?.jsonObject
        val failures = mutableListOf<String>()
        val scroll = ScrollState(0)
        rule.setContent {
            Box(Modifier.size(wrapperWidth.dp, 600.dp)) {
                Box(Modifier.testTag("chart")) {
                    if (chart == "hourly") {
                        HourlyChartView(HourlyChart.build(place, metrics, texts, "mm", "m/s"), expanded = true, onToggleExpanded = {},
                            scrollState = scroll)
                    } else {
                        DailyChartView(DailyChart.build(place, metrics, texts, "mm"), scrollState = scroll)
                    }
                }
            }
        }
        for (capture in captured["captures"]!!.jsonArray.map { it.jsonObject }) {
            val position = capture["position"]!!.jsonPrimitive.content
            val target = (capture["scrollLeft"]!!.jsonPrimitive.double * 2).roundToInt()
            rule.runOnIdle { scroll.dispatchRawDelta((target - scroll.value).toFloat()) }
            rule.waitForIdle()
            check(scroll.value == target) { "scrolled to ${scroll.value}, want $target" }
            val native = rule.onNodeWithTag("chart").captureToImage().asAndroidBitmap().toPixels()
            // The wrapper inside the capture: the clip is on whole CSS pixels, the wrapper on device pixels.
            val offset = capture["offset"]!!.jsonObject
            val wrapper = capture["size"]!!.jsonObject
            val cordova = ImageIO.read(File(references, "$directory/$fixture/$chart-$position.png")).toPixels()
                .crop(offset.int("x"), offset.int("y"), wrapper.int("width"), wrapper.int("height"))
            val diff = ImageDiff.of(native, cordova)
            val name = if (matrixSize == null) "$size-$chart-$position" else "$matrixLang/$chart-$position"
            val outputName = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
            ImageIO.write(native.toBufferedImage(), "png", File(out, "$outputName-native.png"))
            ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$outputName-diff.png"))
            println("chart-compare ${matrixSize ?: "historical"}/$name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
            val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
            if (limit == null || margin == null) {
                failures += "$name: no recorded tolerance, $diff"
                continue
            }
            if (native.width != cordova.width ||
                diff.heightDifference > limit.int("heightDifference") + margin.int("heightDifference") ||
                diff.strong > limit.num("strong") + margin.num("strong") ||
                diff.mean > limit.num("mean") + margin.num("mean")) {
                failures += "$name: $diff (native ${native.width}x${native.height}, cordova ${cordova.width}x${cordova.height}), recorded $limit"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun input(name: String): JsonElement {
        val case = Json.parseToJsonElement(File(corpus, "conversion/$name.json").readText()).jsonObject
        return case["input"] ?: Json.parseToJsonElement(File(corpus, (case["inputFile"] as JsonPrimitive).content).readText())
    }

    private fun JsonObject.num(key: String) = this[key]!!.jsonPrimitive.double
    private fun JsonObject.int(key: String) = this[key]!!.jsonPrimitive.content.toInt()

    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })

    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))

    private fun Pixels.toBufferedImage() =
        BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
}
