package net.wizardfactory.todayweather.ui.chart

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asImageBitmap
import net.wizardfactory.todayweather.core.domain.chart.Svg
import net.wizardfactory.todayweather.core.domain.chart.SvgGroup
import net.wizardfactory.todayweather.core.domain.chart.SvgImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ForecastChartImagesTest {
    @Test fun resolvesPathsAndRetainsMissingImagesUntilEvicted() {
        val icon = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).asImageBitmap()
        val loads = mutableListOf<String>()
        val images = ForecastChartImages(maxBytes = 3072) { path ->
            loads += path
            icon.takeUnless { path.endsWith("/Rain.png") }
        }
        val clear = "img/weather_default/Sunny.png"
        val missing = "img/weather_default/Rain.png"
        val light = ChartColors.LIGHT
        val old = light.copy(weatherImages = "img/weather_old")
        val both = scene(clear, missing, clear)
        repeat(2) {
            val prepared = images.prepare(light, both)
            assertEquals(setOf(clear), prepared.keys)
            assertSame(icon, prepared[clear])
        }
        assertEquals(listOf(clear, missing), loads)
        assertSame(icon, images.prepare(old, scene(clear))[clear])
        assertSame(icon, images.prepare(light, scene(clear))[clear])
        assertEquals(listOf(clear, missing, "img/weather_old/Sunny.png"), loads)

        images.prepare(old, scene(missing))
        images.prepare(light, scene(missing))
        assertEquals(listOf("img/weather_old/Rain.png", missing), loads.takeLast(2))
    }

    private fun scene(vararg paths: String) = Svg(10.0, 10.0, listOf(SvgGroup("icons", paths.map {
        SvgImage(null, it, 0.0, 0.0, 10.0, 10.0)
    })))
}
