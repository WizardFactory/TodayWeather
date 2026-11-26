package net.wizardfactory.todayweather.ui.chart

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.core.domain.forecast.PageImage
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.forecast.ThemeImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Asset images that screens draw through [rememberChartImages] (ThemeImage on Hourly, Daily and Air, the Places rows, the
 * attribution, the national pages) come from the activity's shared cache, so a tab visit does not decode them again (#3224).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SharedChartImagesTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun themeImagesDecodeOncePerPathAcrossVisits() {
        val loaded = mutableListOf<String>()
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).asImageBitmap()
        val cache = ForecastChartImages { path -> loaded += path; bitmap.takeUnless { path.endsWith("/missing.png") } }
        val images = listOf(PageImage(true, "sun.png"), PageImage(false, "wind.png"), PageImage(false, "missing.png"))
        val visiting = mutableStateOf(true)
        rule.setContent {
            CompositionLocalProvider(LocalForecastChartImages provides cache) {
                if (visiting.value) images.forEach { ThemeImage(it, Theme.LIGHT, 24.dp) }
            }
        }
        val paths = listOf(Theme.LIGHT.weather + "/sun.png", Theme.LIGHT.icons + "/wind.png", Theme.LIGHT.icons + "/missing.png")
        rule.runOnIdle { assertEquals(paths, loaded) }
        repeat(3) {
            rule.runOnIdle { visiting.value = false }
            rule.waitForIdle()
            rule.runOnIdle { visiting.value = true }
            rule.waitForIdle()
        }
        rule.runOnIdle { assertEquals(paths, loaded) }
    }

    @Test fun chartImagesReadThroughTheSharedCache() {
        val loaded = mutableListOf<String>()
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).asImageBitmap()
        val cache = ForecastChartImages { path -> loaded += path; bitmap }
        val got = mutableListOf<Any?>()
        rule.setContent {
            CompositionLocalProvider(LocalForecastChartImages provides cache) {
                got += rememberChartImages()["img/kr.png"]
                got += rememberChartImages()["img/kr.png"]
            }
        }
        rule.runOnIdle {
            assertEquals(listOf("img/kr.png"), loaded)
            assertEquals(listOf<Any?>(bitmap, bitmap), got)
        }
    }

    @Test fun budgetFollowsTheMemoryClassWithinFourToSixteenMiB() {
        val mib = 1024 * 1024
        assertEquals(4 * mib, ForecastChartImages.budgetBytes(32))
        assertEquals(8 * mib, ForecastChartImages.budgetBytes(128))
        assertEquals(16 * mib, ForecastChartImages.budgetBytes(256))
        assertEquals(16 * mib, ForecastChartImages.budgetBytes(512))
    }
}
