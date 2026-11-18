package net.wizardfactory.todayweather.ui.forecast

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import net.wizardfactory.todayweather.core.domain.forecast.DayCell
import net.wizardfactory.todayweather.core.domain.forecast.DayRow
import net.wizardfactory.todayweather.core.domain.forecast.PageImage
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.chart.ForecastChartImages
import net.wizardfactory.todayweather.ui.chart.LocalForecastChartImages
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DailyDetailImagesTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun reusesPresentAndMissingDetailIconsAcrossDaysAndVisitsByThemePath() {
        val loaded = mutableListOf<String>()
        val bitmap = Bitmap.createBitmap(2, 1, Bitmap.Config.ARGB_8888).asImageBitmap()
        val cache = ForecastChartImages { path ->
            loaded += path
            bitmap.takeUnless { path.endsWith("/missing.png") }
        }
        val files = listOf("wind.png", "missing.png")
        val rows = files.map { DayRow(PageImage(false, it), emptyList(), it) }
        val days = listOf(DayCell("Today", rows), DayCell("Tomorrow", rows))
        val selected = mutableStateOf<Theme?>(Theme.LIGHT)
        rule.setContent {
            CompositionLocalProvider(LocalForecastChartImages provides cache) {
                selected.value?.let { theme -> DayCells(days, theme, ForecastColors.of(theme, daily = true)) }
            }
        }
        fun visit(theme: Theme?) {
            rule.runOnIdle { selected.value = theme }
            rule.waitForIdle()
        }
        val light = files.map { Theme.LIGHT.icons + "/" + it }
        val dark = files.map { Theme.DARK.icons + "/" + it }
        rule.runOnIdle { assertEquals(light, loaded) }
        visit(null)
        visit(Theme.LIGHT)
        assertEquals(light, loaded)
        visit(Theme.DARK)
        visit(Theme.LIGHT)
        assertEquals(light + dark, loaded)
    }
}
