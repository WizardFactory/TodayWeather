package net.wizardfactory.todayweather

import android.graphics.BitmapFactory
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
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
import net.wizardfactory.todayweather.ui.chart.DailyChartView
import net.wizardfactory.todayweather.ui.chart.HourlyChartView
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.chart.chartTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Device smoke for the charts (#2884): the Compose charts rendered on the emulator with its own fonts against
 * the Cordova captures of the same emulator. Run by android/tools/chart-reference/device-smoke.sh, which sets
 * the display to `chartSize` at density 2; skipped without that argument. Looser than the JVM comparison
 * (ChartScreenshotTest), whose tolerances are recorded per comparison: strong at most [MAX_STRONG].
 */
@RunWith(AndroidJUnit4::class)
class ChartDeviceTest {
    @get:Rule val rule = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val size: String? = InstrumentationRegistry.getArguments().getString("chartSize")

    @Test fun hourly() = compare("hourly")
    @Test fun daily() = compare("daily")

    private fun compare(chart: String) {
        val size = size ?: return
        val context = instrumentation.targetContext
        assertEquals(2f, context.resources.displayMetrics.density)
        val assets = instrumentation.context.assets
        fun json(path: String) = Json.parseToJsonElement(assets.open(path).bufferedReader().readText()).jsonObject
        val (w, h) = size.split("x").map { it.toDouble() }
        val captured = json("chart-reference/$size/kma-seoul.json")[chart]!!.jsonObject
        val place = WeatherConverter.convert(input(::json))!!
        val metrics = ChartMetrics(w, h)
        val texts = chartTexts(context)
        val scroll = ScrollState(0)
        rule.setContent {
            Box(Modifier.size(captured["wrapper"]!!.jsonObject["w"]!!.jsonPrimitive.double.dp, 600.dp)) {
                Box(Modifier.testTag("chart")) {
                    if (chart == "hourly") {
                        HourlyChartView(HourlyChart.build(place, metrics, texts, "mm", "m/s"), expanded = true, onToggleExpanded = {}, scrollState = scroll)
                    } else {
                        DailyChartView(DailyChart.build(place, metrics, texts, "mm"), scrollState = scroll)
                    }
                }
            }
        }
        val results = mutableListOf<String>()
        for (capture in captured["captures"]!!.jsonArray.map { it.jsonObject }) {
            val position = capture["position"]!!.jsonPrimitive.content
            val target = (capture["scrollLeft"]!!.jsonPrimitive.double * 2).roundToInt()
            rule.runOnIdle { scroll.dispatchRawDelta((target - scroll.value).toFloat()) }
            rule.waitForIdle()
            val bitmap = rule.onNodeWithTag("chart").captureToImage().asAndroidBitmap()
            val native = Pixels(bitmap.width, bitmap.height, IntArray(bitmap.width * bitmap.height).also {
                bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            })
            val reference = assets.open("chart-reference/$size/kma-seoul/$chart-$position.png").use { BitmapFactory.decodeStream(it) }
            val offset = capture["offset"]!!.jsonObject
            val wrapper = capture["size"]!!.jsonObject
            val cordova = Pixels(reference.width, reference.height, IntArray(reference.width * reference.height).also {
                reference.getPixels(it, 0, reference.width, 0, 0, reference.width, reference.height)
            }).crop(offset.int("x"), offset.int("y"), wrapper.int("width"), wrapper.int("height"))
            val diff = ImageDiff.of(native, cordova)
            println("chart-device $size-$chart-$position native=${native.width}x${native.height} $diff")
            results += "$position: $diff"
            assertEquals("$position width", cordova.width, native.width)
            assertTrue("$position: $diff", diff.strong <= MAX_STRONG && diff.heightDifference <= 2)
        }
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("chart-device-$chart", results.joinToString("; ")) })
    }

    private fun input(json: (String) -> JsonObject): JsonElement {
        val case = json("corpus/conversion/kma-seoul.json")
        return case["input"] ?: Json.parseToJsonElement(instrumentation.context.assets.open("corpus/" + (case["inputFile"] as JsonPrimitive).content)
            .bufferedReader().readText())
    }

    private fun JsonObject.int(key: String) = this[key]!!.jsonPrimitive.content.toInt()

    private companion object {
        const val MAX_STRONG = 0.02
    }
}
