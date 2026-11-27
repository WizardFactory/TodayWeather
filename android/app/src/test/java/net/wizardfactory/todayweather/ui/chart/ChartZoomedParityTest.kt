package net.wizardfactory.todayweather.ui.chart

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import java.security.MessageDigest
import java.util.TimeZone
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.air.AirScope
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.ui.air.AirChartView
import net.wizardfactory.todayweather.ui.air.AirColors
import net.wizardfactory.todayweather.ui.forecast.Zoomed
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
 * Verifies Hourly (expanded), Daily and Air charts rendered inside [Zoomed] at font scale 1.3
 * match their pre-change references (#3232).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h1200dp-xhdpi")
class ChartZoomedParityTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val references = File(project, "src/test/resources/chart-zoomed-reference")

    private fun seoulConverted(): JsonObject =
        WeatherConverter.convert(Json.parseToJsonElement(File(inputs, "kma-seoul.json").readText()))!!

    @Test
    @Config(fontScale = 1.3f)
    fun hourlyExpandedInsideZoomedAtFontScale13MatchesPreChangeReference() {
        val place = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = chartTexts(rule.activity)
        val chart = HourlyChart.build(place, metrics, texts, "mm", "m/s")
        rule.setContent {
            Box(Modifier.size(384.dp, 900.dp).background(Color.White)) {
                Box(Modifier.fillMaxWidth().testTag("zoomed-hourly")) {
                    Zoomed {
                        HourlyChartView(
                            chart = chart,
                            expanded = true,
                            onToggleExpanded = {},
                            scrollState = rememberOpeningScroll(chart, chart.openingOffset),
                        )
                    }
                }
            }
        }
        rule.waitForIdle()
        assertMatchesReference("hourly-expanded-1.3", rule.onNodeWithTag("zoomed-hourly").captureToImage().asAndroidBitmap().toPixels())
    }

    @Test
    @Config(fontScale = 1.3f)
    fun dailyInsideZoomedAtFontScale13MatchesPreChangeReference() {
        val place = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = chartTexts(rule.activity)
        val chart = DailyChart.build(place, metrics, texts, "mm")
        rule.setContent {
            Box(Modifier.size(384.dp, 900.dp).background(Color.White)) {
                Box(Modifier.fillMaxWidth().testTag("zoomed-daily")) {
                    Zoomed {
                        DailyChartView(
                            chart = chart,
                            scrollState = rememberOpeningScroll(chart, chart.openingOffset),
                        )
                    }
                }
            }
        }
        rule.waitForIdle()
        assertMatchesReference("daily-1.3", rule.onNodeWithTag("zoomed-daily").captureToImage().asAndroidBitmap().toPixels())
    }

    @Test
    @Config(fontScale = 1.3f)
    fun airInsideZoomedAtFontScale13MatchesPreChangeReference() {
        val converted = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = forecastTexts(rule.activity)
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val city = cityRecord(seoul, WeatherEntry(WeatherRepository.merge(null, converted), 0))
        val scope = AirScope(metrics, "airkorea", TimeZone.getTimeZone("Asia/Seoul"))
        scope.open(city, null, 1, false)
        val series = scope.airChart!!
        rule.setContent {
            Box(Modifier.width(384.dp).background(Color.White)) {
                Box(Modifier.fillMaxWidth().testTag("zoomed-air")) {
                    Zoomed {
                        AirChartView(series, scope.standard, texts["LOC_HOUR"], AirColors.of(Theme.LIGHT))
                    }
                }
            }
        }
        rule.waitForIdle()
        assertMatchesReference("air-1.3", rule.onNodeWithTag("zoomed-air").captureToImage().asAndroidBitmap().toPixels())
    }

    @Test
    fun zoomedFontScale13ScalesHigherThanFontScale10() {
        val place = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = chartTexts(rule.activity)
        val chart = DailyChart.build(place, metrics, texts, "mm")
        rule.setContent {
            Box(Modifier.size(384.dp, 900.dp).background(Color.White)) {
                Box(Modifier.fillMaxWidth().testTag("zoomed-daily-1.0")) {
                    Zoomed { DailyChartView(chart = chart, scrollState = ScrollState(0)) }
                }
            }
        }
        rule.waitForIdle()
        val normalHeight = rule.onNodeWithTag("zoomed-daily-1.0").captureToImage().asAndroidBitmap().height
        val ref13 = ImageIO.read(File(references, "daily-1.3.png"))
        assertTrue("expected fontScale 1.3 height (${ref13.height}) > 1.0 height ($normalHeight)", ref13.height > normalHeight)
    }

    private fun assertMatchesReference(name: String, actual: Pixels) {
        val file = File(references, "$name.png")
        assertTrue("missing pre-change reference: ${file.path}", file.isFile)
        val expected = ImageIO.read(file).toPixels()
        assertEquals("$name width", expected.width, actual.width)
        assertEquals("$name height", expected.height, actual.height)
        val diff = ImageDiff.of(actual, expected)
        var exactMismatches = 0
        for (i in actual.argb.indices) if (actual.argb[i] != expected.argb[i]) exactMismatches++
        println("zoomed-parity $name ${actual.width}x${actual.height} exactMismatches=$exactMismatches sha256=${actual.sha256()} $diff")
        assertEquals("$name strong diff", 0.0, diff.strong, 0.0)
        assertTrue("$name mean diff too large: $diff (exactMismatches=$exactMismatches)", diff.mean <= 0.05)
    }

    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() =
        BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }
    private fun Pixels.sha256(): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = ByteArray(argb.size * 4)
        for (i in argb.indices) {
            val v = argb[i]
            bytes[i * 4] = (v ushr 24).toByte()
            bytes[i * 4 + 1] = (v ushr 16).toByte()
            bytes[i * 4 + 2] = (v ushr 8).toByte()
            bytes[i * 4 + 3] = v.toByte()
        }
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
