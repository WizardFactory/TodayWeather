package net.wizardfactory.todayweather.ui.chart

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import net.wizardfactory.todayweather.core.domain.chart.Svg
import net.wizardfactory.todayweather.core.domain.chart.SvgImage
import net.wizardfactory.todayweather.core.domain.shell.Theme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The old theme uses white/grey clouds; other themes retain the blue artwork. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w480dp-h300dp-xhdpi")
class ChartArtworkTest {
    @get:Rule val rule = createComposeRule()

    @Test fun expandedHourlyDetailsUseTheIconArtworkOfTheirTheme() {
        val names = listOf("wind_direction", "humidity_50")
        rule.setContent {
            val images = rememberChartImages()
            val measurer = rememberTextMeasurer()
            Column {
                for (name in names) Row {
                    for (theme in Theme.entries) {
                        val colors = ChartColors.of(theme, daily = false)
                        val scene = Svg(120.0, 120.0, listOf(SvgImage(null, "img/icons_default/$name.png", 0.0, 0.0, 120.0, 120.0)))
                        Canvas(Modifier.size(120.dp).testTag("$theme-$name")) {
                            drawRect(colors.background)
                            drawSvg(scene, 0.0, images, measurer, colors)
                        }
                    }
                }
            }
        }
        rule.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        for (name in names) for (theme in Theme.entries) {
            val folder = when (theme) { Theme.OLD -> "icons_old"; Theme.DARK -> "icons_dark"; else -> "icons_default" }
            val expected = context.assets.open("img/$folder/$name.png").use { BitmapFactory.decodeStream(it) }
            val actual = rule.onNodeWithTag("$theme-$name").captureToImage().asAndroidBitmap()
            val samples = if (name == "wind_direction") listOf(80, 120) else listOf(140)
            for (y in samples) {
                val pixel = expected.getPixel(120, y)
                assertTrue("interior sample", pixel.ushr(24) in listOf(0, 255))
                val want = if (pixel.ushr(24) == 0) ChartColors.of(theme, false).background.toArgb() else pixel
                val got = actual.getPixel(120, y)
                // The observed decode/draw difference is at most two channel levels.
                val difference = listOf(0, 8, 16).maxOf { shift -> kotlin.math.abs((want shr shift and 255) - (got shr shift and 255)) }
                assertTrue("$theme $name y=$y difference=$difference", difference <= 3)
            }
        }
    }

    @Test fun bothChartsUseTheWeatherArtworkOfTheirTheme() {
        val scene = Svg(120.0, 120.0, listOf(SvgImage(null, "img/weather_default/cloud.png", 0.0, 0.0, 120.0, 120.0)))
        rule.setContent {
            val images = rememberChartImages()
            val measurer = rememberTextMeasurer()
            Column {
                for (daily in listOf(false, true)) Row {
                    for (theme in Theme.entries) {
                        val colors = ChartColors.of(theme, daily)
                        Canvas(Modifier.size(120.dp).testTag("$theme-$daily")) {
                            drawRect(colors.background)
                            drawSvg(scene, 0.0, images, measurer, colors)
                        }
                    }
                }
            }
        }
        rule.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        for (daily in listOf(false, true)) for (theme in Theme.entries) {
            val folder = if (theme == Theme.OLD) "weather_old" else "weather_default"
            val source = context.assets.open("img/$folder/cloud.png").use { BitmapFactory.decodeStream(it) }
            val expected = Bitmap.createScaledBitmap(source, 240, 240, true)
            val actual = rule.onNodeWithTag("$theme-$daily").captureToImage().asAndroidBitmap()
            // Interior pixels of the two clouds avoid rasterization and edge interpolation.
            val backCloud = if (theme == Theme.OLD) 90 to 65 else 150 to 60
            for ((x, y) in listOf(120 to 150, backCloud)) {
                assertEquals("opaque reference sample", 255, expected.getPixel(x, y).ushr(24))
                assertEquals("$theme daily=$daily cloud pixel $x,$y", expected.getPixel(x, y), actual.getPixel(x, y))
            }
        }
    }
}
