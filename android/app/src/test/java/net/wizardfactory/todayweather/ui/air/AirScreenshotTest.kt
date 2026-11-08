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
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import java.time.ZoneId
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
    private val references = File(project, "src/test/resources/air-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/air-compare").apply { mkdirs() }

    @Test fun overallIndex() = compare("kma-seoul")
    @Test fun pollutantTapped() = compare("kma-seoul-pm25")
    @Test fun secondStation() = compare("kma-seoul-station-1")
    @Test fun ozoneLink() = compare("kma-seoul-o3")
    @Test fun darkTheme() = compare("kma-seoul-dark")
    @Test fun london() = compare("vc-london")
    @Test fun placeWithoutAir() = compare("kma-jeju-no-air")

    private fun compare(state: String) {
        val record = Json.parseToJsonElement(File(references, "$state/air.json").readText()).jsonObject
        val theme = if (state == "kma-seoul-dark") Theme.DARK else Theme.LIGHT
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            val metrics = ChartMetrics(384.0, 832.0)
            val scope = scope(state, metrics)
            val page = AirPage(scope, texts)
            Box(Modifier.size(384.dp, 2600.dp)) {
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
        val failures = mutableListOf<String>()
        for (block in record["blocks"]!!.jsonArray.map { it.jsonObject }) {
            val i = block["index"]!!.jsonPrimitive.content.toInt()
            val native = rule.onNodeWithTag(AirTags.block(i)).captureToImage().asAndroidBitmap().toPixels()
            val cordova = ImageIO.read(File(references, "$state/air-$i.png")).toPixels()
            val name = "$state-$i"
            // A block that ends under the tab bar is captured without its last pixels (`hidden`).
            val shown = if (block["hidden"] != null) native.crop(0, 0, native.width, minOf(native.height, cordova.height)) else native
            val diff = ImageDiff.of(shown, cordova)
            ImageIO.write(shown.toBufferedImage(), "png", File(out, "$name-native.png"))
            ImageIO.write(ImageDiff.overlay(shown, cordova).toBufferedImage(), "png", File(out, "$name-diff.png"))
            println("air-compare $name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
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
        val scope = AirScope(metrics, "airkorea", ZoneId.of("Asia/Seoul"))
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
