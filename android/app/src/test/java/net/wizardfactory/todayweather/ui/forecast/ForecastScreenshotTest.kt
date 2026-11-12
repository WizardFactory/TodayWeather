package net.wizardfactory.todayweather.ui.forecast

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
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
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.forecast.ForecastScope
import net.wizardfactory.todayweather.core.domain.forecast.ForecastType
import net.wizardfactory.todayweather.core.domain.forecast.PageUnits
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.HeaderBar
import net.wizardfactory.todayweather.ui.shell.ShellColors
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The native weather pages against the Cordova pages (#2887 AC3): every block of S03 and S04 for Seoul alone and
 * London added after it, rendered at 384 dp and density 2 with the same fixtures, and compared with the captures in
 * forecast-reference/<place> (tools/forecast-reference/capture.sh) within the tolerance recorded for each block in
 * forecast-reference/tolerances.json. The header block is compared with the shell's bar over it, as captured.
 * Renders and overlays go to build/forecast-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
class ForecastScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private var matrixLang = "ko-KR"
    private val prefix get() = if (matrixSize == null) "" else "$matrixLang/"
    private val references get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/forecast" }
        ?: "src/test/resources/forecast-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/forecast-compare").apply { mkdirs() }

    @Test fun seoulHourly() = compare("kma-seoul", ForecastType.SHORT)
    @Test fun seoulDaily() = compare("kma-seoul", ForecastType.MID)
    @Test fun londonHourly() = compare("vc-london", ForecastType.SHORT)
    @Test fun londonDaily() = compare("vc-london", ForecastType.MID)

    private fun matrix(size: String, lang: String, place: String, type: ForecastType) {
        matrixSize = size
        matrixLang = lang
        compare(place, type)
    }

    @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    @Test fun nominal384KoreanSeoulShort() = matrix("384x832", "ko-KR", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    @Test fun nominal384KoreanSeoulMid() = matrix("384x832", "ko-KR", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    @Test fun nominal384KoreanLondonShort() = matrix("384x832", "ko-KR", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    @Test fun nominal384KoreanLondonMid() = matrix("384x832", "ko-KR", "vc-london", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun nominal384EnglishSeoulShort() = matrix("384x832", "en-US", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun nominal384EnglishSeoulMid() = matrix("384x832", "en-US", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun nominal384EnglishLondonShort() = matrix("384x832", "en-US", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun nominal384EnglishLondonMid() = matrix("384x832", "en-US", "vc-london", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    @Test fun nominal360KoreanSeoulShort() = matrix("360x780", "ko-KR", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    @Test fun nominal360KoreanSeoulMid() = matrix("360x780", "ko-KR", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    @Test fun nominal360KoreanLondonShort() = matrix("360x780", "ko-KR", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    @Test fun nominal360KoreanLondonMid() = matrix("360x780", "ko-KR", "vc-london", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    @Test fun nominal360EnglishSeoulShort() = matrix("360x780", "en-US", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    @Test fun nominal360EnglishSeoulMid() = matrix("360x780", "en-US", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    @Test fun nominal360EnglishLondonShort() = matrix("360x780", "en-US", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    @Test fun nominal360EnglishLondonMid() = matrix("360x780", "en-US", "vc-london", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    @Test fun nominal412KoreanSeoulShort() = matrix("412x892", "ko-KR", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    @Test fun nominal412KoreanSeoulMid() = matrix("412x892", "ko-KR", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    @Test fun nominal412KoreanLondonShort() = matrix("412x892", "ko-KR", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    @Test fun nominal412KoreanLondonMid() = matrix("412x892", "ko-KR", "vc-london", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    @Test fun nominal412EnglishSeoulShort() = matrix("412x892", "en-US", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    @Test fun nominal412EnglishSeoulMid() = matrix("412x892", "en-US", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    @Test fun nominal412EnglishLondonShort() = matrix("412x892", "en-US", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    @Test fun nominal412EnglishLondonMid() = matrix("412x892", "en-US", "vc-london", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    @Test fun nominal320KoreanSeoulShort() = matrix("320x694", "ko-KR", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    @Test fun nominal320KoreanSeoulMid() = matrix("320x694", "ko-KR", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    @Test fun nominal320KoreanLondonShort() = matrix("320x694", "ko-KR", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    @Test fun nominal320KoreanLondonMid() = matrix("320x694", "ko-KR", "vc-london", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    @Test fun nominal320EnglishSeoulShort() = matrix("320x694", "en-US", "kma-seoul", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    @Test fun nominal320EnglishSeoulMid() = matrix("320x694", "en-US", "kma-seoul", ForecastType.MID)

    @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    @Test fun nominal320EnglishLondonShort() = matrix("320x694", "en-US", "vc-london", ForecastType.SHORT)

    @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    @Test fun nominal320EnglishLondonMid() = matrix("320x694", "en-US", "vc-london", ForecastType.MID)

    private fun compare(place: String, type: ForecastType) {
        val page = if (type == ForecastType.SHORT) "hourly" else "daily"
        val record = Json.parseToJsonElement(File(references, "$prefix$place/$page.json").readText()).jsonObject
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            val dimensions = matrixSize?.split('x')?.map(String::toDouble) ?: listOf(384.0, 832.0)
            val metrics = ChartMetrics(dimensions[0], dimensions[1])
            val scope = ForecastScope(type, metrics, fahrenheit = false, photoTheme = false,
                YesterdayText(texts["LOC_SAME_AS_YESTERDAY"], texts["LOC_THAN_YESTERDAY"]), expandShortChart = false)
            scope.open(city(place), if (place == "kma-seoul") 1 else 2, hasPush = false)
            val model = ForecastPage(scope, PageUnits("C", "m/s", "hPa", "km", "mm", "airkorea"), texts)
            val chartPlace = scope.chartPlace!!
            val content = WeatherPageContent(type, model, metrics,
                if (type == ForecastType.SHORT) HourlyChart.build(chartPlace, metrics, texts, "mm", "m/s") else null,
                if (type == ForecastType.MID) DailyChart.build(chartPlace, metrics, texts, "mm") else null)
            Box(Modifier.size(metrics.bodyWidth.toFloat().dp, 2600.dp)) {
                WeatherPage(content, Theme.LIGHT, photo = null, photoGradient = false, expanded = false, onToggleExpanded = {},
                    onPrevious = {}, onNext = {}, onAction = {})
                val colors = ShellColors.of(Theme.LIGHT, if (type == ForecastType.SHORT) Tab.HOURLY else Tab.DAILY)
                HeaderBar(colors, model.title, onMenu = {}) {
                    BarButton(Glyphs.NOTIFICATIONS_NONE, colors, {}, padding = 4.dp)
                    BarButton(Glyphs.SHARE, colors, {}, Modifier.padding(end = 4.dp), padding = 4.dp)
                }
            }
        }
        rule.waitForIdle()
        val failures = mutableListOf<String>()
        for (block in record["blocks"]!!.jsonArray.map { it.jsonObject }) {
            val i = block["index"]!!.jsonPrimitive.content.toInt()
            val native = rule.onNodeWithTag(ForecastTags.block(i)).captureToImage().asAndroidBitmap().toPixels()
            val size = block["clip"]!!.jsonObject["size"]!!.jsonObject
            val cordova = ImageIO.read(File(references, "$prefix$place/$page-$i.png")).toPixels()
            val name = "$prefix$place-$page-$i"
            val outputName = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
            // A block that ends under the tab bar is captured without its last pixels (`hidden`).
            val shown = if (block["hidden"] != null) native.crop(0, 0, native.width, cordova.height) else native
            val diff = ImageDiff.of(shown, cordova)
            ImageIO.write(shown.toBufferedImage(), "png", File(out, "$outputName-native.png"))
            ImageIO.write(ImageDiff.overlay(shown, cordova).toBufferedImage(), "png", File(out, "$outputName-diff.png"))
            println("forecast-compare ${matrixSize ?: "historical"}/$name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} " +
                "(${size["width"]}x${size["height"]}) $diff")
            val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
            if (limit == null) {
                failures += "$name: no recorded tolerance, $diff"
                continue
            }
            val margin = tolerances["margin"]!!.jsonObject
            if (shown.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
                diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
                failures += "$name: $diff (native ${native.width}x${native.height}, cordova ${cordova.width}x${cordova.height}), recorded $limit"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    /** The captures' places (forecast-reference/capture.mjs) as the data layer records them (cityRecord). */
    private fun city(place: String): JsonObject {
        val converted = WeatherConverter.convert(Json.parseToJsonElement(File(inputs, "$place.json").readText()))!!
        val saved = if (place == "kma-seoul") Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        else Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))
        return cityRecord(saved, WeatherEntry(WeatherRepository.merge(null, converted), 0))
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
}
