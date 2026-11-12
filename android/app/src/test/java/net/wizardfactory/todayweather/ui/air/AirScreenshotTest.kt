package net.wizardfactory.todayweather.ui.air

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
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import java.util.TimeZone
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
import net.wizardfactory.todayweather.core.domain.air.AirPage
import net.wizardfactory.todayweather.core.domain.air.AirScope
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.HeaderBar
import net.wizardfactory.todayweather.ui.shell.ShellColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The native S05 against the Cordova S05 (#2888 AC3): every block of the seven states tools/air-reference captured
 * (the overall index at the top and the end, as on manual pages 10 and 12; 초미세먼지 after its cell's tap, page 11; the
 * second station; ozone from a link; the dark theme; London; a place without air), rendered at 384 dp and density 2
 * with the same fixtures and taps, and compared within the tolerance recorded for each block in
 * air-reference/tolerances.json. The header block is compared with the shell's bar over it, as captured. Renders and
 * overlays go to build/air-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
class AirScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private var matrixLang = "ko-KR"
    private val prefix get() = if (matrixSize == null) "" else "$matrixLang/"
    private val references get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/air" }
        ?: "src/test/resources/air-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/air-compare").apply { mkdirs() }

    @Test fun overallIndex() = compare("kma-seoul")
    @Test fun pollutantTapped() = compare("kma-seoul-pm25")
    @Test fun secondStation() = compare("kma-seoul-station-1")
    @Test fun ozoneLink() = compare("kma-seoul-o3")
    @Test fun darkTheme() = compare("kma-seoul-dark")
    @Test fun london() = compare("vc-london")
    @Test fun placeWithoutAir() = compare("kma-jeju-no-air")

    private fun matrix(size: String, lang: String, state: String) {
        matrixSize = size
        matrixLang = lang
        compare(state)
    }

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanKmaSeoul() = matrix("384x832", "ko-KR", "kma-seoul")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanKmaSeoulDark() = matrix("384x832", "ko-KR", "kma-seoul-dark")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanKmaSeoulOld() = matrix("384x832", "ko-KR", "kma-seoul-old")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanKmaSeoulPhoto() = matrix("384x832", "ko-KR", "kma-seoul-photo")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanVcLondon() = matrix("384x832", "ko-KR", "vc-london")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanKmaJejuNoAir() = matrix("384x832", "ko-KR", "kma-jeju-no-air")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishKmaSeoul() = matrix("384x832", "en-US", "kma-seoul")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishKmaSeoulDark() = matrix("384x832", "en-US", "kma-seoul-dark")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishKmaSeoulOld() = matrix("384x832", "en-US", "kma-seoul-old")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishKmaSeoulPhoto() = matrix("384x832", "en-US", "kma-seoul-photo")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishVcLondon() = matrix("384x832", "en-US", "vc-london")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishKmaJejuNoAir() = matrix("384x832", "en-US", "kma-jeju-no-air")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanKmaSeoul() = matrix("360x780", "ko-KR", "kma-seoul")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanKmaSeoulDark() = matrix("360x780", "ko-KR", "kma-seoul-dark")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanKmaSeoulOld() = matrix("360x780", "ko-KR", "kma-seoul-old")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanKmaSeoulPhoto() = matrix("360x780", "ko-KR", "kma-seoul-photo")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanVcLondon() = matrix("360x780", "ko-KR", "vc-london")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanKmaJejuNoAir() = matrix("360x780", "ko-KR", "kma-jeju-no-air")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishKmaSeoul() = matrix("360x780", "en-US", "kma-seoul")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishKmaSeoulDark() = matrix("360x780", "en-US", "kma-seoul-dark")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishKmaSeoulOld() = matrix("360x780", "en-US", "kma-seoul-old")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishKmaSeoulPhoto() = matrix("360x780", "en-US", "kma-seoul-photo")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishVcLondon() = matrix("360x780", "en-US", "vc-london")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishKmaJejuNoAir() = matrix("360x780", "en-US", "kma-jeju-no-air")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanKmaSeoul() = matrix("412x892", "ko-KR", "kma-seoul")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanKmaSeoulDark() = matrix("412x892", "ko-KR", "kma-seoul-dark")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanKmaSeoulOld() = matrix("412x892", "ko-KR", "kma-seoul-old")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanKmaSeoulPhoto() = matrix("412x892", "ko-KR", "kma-seoul-photo")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanVcLondon() = matrix("412x892", "ko-KR", "vc-london")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanKmaJejuNoAir() = matrix("412x892", "ko-KR", "kma-jeju-no-air")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishKmaSeoul() = matrix("412x892", "en-US", "kma-seoul")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishKmaSeoulDark() = matrix("412x892", "en-US", "kma-seoul-dark")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishKmaSeoulOld() = matrix("412x892", "en-US", "kma-seoul-old")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishKmaSeoulPhoto() = matrix("412x892", "en-US", "kma-seoul-photo")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishVcLondon() = matrix("412x892", "en-US", "vc-london")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishKmaJejuNoAir() = matrix("412x892", "en-US", "kma-jeju-no-air")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanKmaSeoul() = matrix("320x694", "ko-KR", "kma-seoul")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanKmaSeoulDark() = matrix("320x694", "ko-KR", "kma-seoul-dark")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanKmaSeoulOld() = matrix("320x694", "ko-KR", "kma-seoul-old")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanKmaSeoulPhoto() = matrix("320x694", "ko-KR", "kma-seoul-photo")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanVcLondon() = matrix("320x694", "ko-KR", "vc-london")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanKmaJejuNoAir() = matrix("320x694", "ko-KR", "kma-jeju-no-air")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishKmaSeoul() = matrix("320x694", "en-US", "kma-seoul")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishKmaSeoulDark() = matrix("320x694", "en-US", "kma-seoul-dark")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishKmaSeoulOld() = matrix("320x694", "en-US", "kma-seoul-old")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishKmaSeoulPhoto() = matrix("320x694", "en-US", "kma-seoul-photo")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishVcLondon() = matrix("320x694", "en-US", "vc-london")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishKmaJejuNoAir() = matrix("320x694", "en-US", "kma-jeju-no-air")

    private fun compare(state: String) {
        val record = Json.parseToJsonElement(File(references, "$prefix$state/air.json").readText()).jsonObject
        val theme = when (state.substringAfterLast('-')) { "dark" -> Theme.DARK; "photo" -> Theme.PHOTO; "old" -> Theme.OLD; else -> Theme.LIGHT }
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            val dimensions = matrixSize?.split('x')?.map(String::toDouble) ?: listOf(384.0, 832.0)
            val metrics = ChartMetrics(dimensions[0], dimensions[1])
            val scope = scope(state, metrics)
            val page = AirPage(scope, texts)
            Box(Modifier.size(metrics.bodyWidth.toFloat().dp, 2600.dp)) {
                AirScreen(AirContent(page, metrics, scope.airChart, scope.standard, texts["LOC_HOUR"]), theme,
                    onPrevious = {}, onNext = {}, onCode = {}, onStation = {}, onWeather = {}, onAction = {})
                val colors = ShellColors.of(theme, Tab.AIR)
                HeaderBar(colors, page.title, onMenu = {}) {
                    BarButton(Glyphs.NOTIFICATIONS_NONE, colors, {}, padding = 4.dp)
                    BarButton(Glyphs.SHARE, colors, {}, Modifier.padding(end = 4.dp), padding = 4.dp)
                }
            }
        }
        rule.waitForIdle()
        if (matrixSize != null && rule.onAllNodesWithTag(AirTags.STATIONS).fetchSemanticsNodes().isNotEmpty()) {
            val stationBlock = record["blocks"]!!.jsonArray.last().jsonObject
            val headings = stationBlock["elements"]!!.jsonArray.map { it.jsonObject }.filter { it["tag"]!!.jsonPrimitive.content == "p" }
            for ((index, heading) in headings.withIndex()) {
                val rect = heading["rect"]!!.jsonObject
                val bounds = rule.onNodeWithTag(AirTags.station(index)).fetchSemanticsNode().boundsInRoot
                // Captured paragraph fills the cell's content width, inside its 1 dp border.
                assertEquals("station $index left at $matrixSize", rect["x"]!!.jsonPrimitive.double - 1, bounds.left / 2.0, 0.75)
                assertEquals("station $index width at $matrixSize", rect["w"]!!.jsonPrimitive.double + 2, bounds.width / 2.0, 0.75)
            }
        }
        val failures = mutableListOf<String>()
        for (block in record["blocks"]!!.jsonArray.map { it.jsonObject }) {
            val i = block["index"]!!.jsonPrimitive.content.toInt()
            val native = rule.onNodeWithTag(AirTags.block(i)).captureToImage().asAndroidBitmap().toPixels()
            val cordova = ImageIO.read(File(references, "$prefix$state/air-$i.png")).toPixels()
            val name = "$prefix$state-$i"
            val outputName = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
            // A block that ends under the tab bar is captured without its last pixels (`hidden`).
            val shown = if (block["hidden"] != null) native.crop(0, 0, native.width, minOf(native.height, cordova.height)) else native
            val diff = ImageDiff.of(shown, cordova)
            ImageIO.write(shown.toBufferedImage(), "png", File(out, "$outputName-native.png"))
            ImageIO.write(ImageDiff.overlay(shown, cordova).toBufferedImage(), "png", File(out, "$outputName-diff.png"))
            println("air-compare ${matrixSize ?: "historical"}/$name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
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

    /** The visit capture.mjs showed: its places as the data layer records them (cityRecord), then its link code or tap. */
    private fun scope(state: String, metrics: ChartMetrics): AirScope {
        val scope = AirScope(metrics, "airkorea", TimeZone.getTimeZone("Asia/Seoul"))
        val seoul = city("kma-seoul", Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98)))
        when (state) {
            "vc-london" -> scope.open(city("vc-london", Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))), null, 2, false)
            "kma-jeju-no-air" -> scope.open(city("kma-jeju", Place(false, false, "연동", "대한민국 제주특별자치도 제주시 연동", "KR", Location(33.5, 126.53)),
                withoutAir = true), null, 3, false)
            "kma-seoul-o3" -> scope.open(seoul, "o3", 1, false)
            else -> scope.open(seoul, null, 1, false)
        }
        if (state == "kma-seoul-pm25") scope.setCode("pm25")
        if (state == "kma-seoul-station-1") scope.setStation(1)
        return scope
    }

    private fun city(fixture: String, saved: Place, withoutAir: Boolean = false): JsonObject {
        var converted = WeatherConverter.convert(Json.parseToJsonElement(File(inputs, "$fixture.json").readText()))!!
        if (withoutAir) {
            converted = JsonObject(converted - "airInfoList" + ("currentWeather" to JsonObject(converted["currentWeather"]!!.jsonObject - "arpltn")))
        }
        return cityRecord(saved, WeatherEntry(WeatherRepository.merge(null, converted), 0))
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
}
