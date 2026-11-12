package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
import org.junit.runner.RunWith

/**
 * S03 and S04 against the production server (#2887 AC2), run by tools/emulator/run-production-weather.sh with
 * `weather` `production` on an emulator: Seoul and London saved, each shown on Hourly and Daily once its weather has
 * loaded, with the screen captured to the app's files (ac2/). Weather requests are read-only GETs; push requests are
 * recorded by the test app, not sent.
 */
@RunWith(AndroidJUnit4::class)
class ProductionWeatherTest {
    val rule = createAndroidComposeRule<MainActivity>()

    // Korean units, as on the ko-KR emulator, whatever the device's region (°F would round the temperatures); the places
    // are saved before the app opens.
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule {
        it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul, london), placeIndex = 1, units = UnitSettings.defaults("KR"))
    }).around(rule)

    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))
    private val london = Place(false, false, "런던", "영국 런던", "GB", Location(51.51, -0.13))

    @Test
    fun seoulAndLondonRenderFromProduction() {
        assumeTrue("needs -e weather production", TestRunner.args.getString("weather") == "production")
        rule.waitUntil(30_000) { app.appState.current() != null }
        rule.waitForIdle()
        // Daily, then Hourly again: a new visit of Hourly.
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitForIdle()
        Thread.sleep(800)
        // Tapping the selected Hourly tab, past the 700 ms guard, loads the selected place at once (`reloadEvent` "tab").
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        show(seoul, "seoul")
        rule.onNodeWithTag(ForecastTags.NEXT).performClick()
        show(london, "london")
        rule.onNodeWithText("Weather Data Provided by Visual Crossing", useUnmergedTree = true).performScrollTo()
        capture("london-hourly-end")
    }

    /** Waits for [place]'s weather, then checks and captures Hourly (top and details) and Daily. */
    private fun show(place: Place, name: String) {
        val key = WeatherRepository.key(place)
        rule.waitUntil(40_000) { app.weather.weather.value.containsKey(key) }
        rule.waitForIdle()
        val current = app.weather.weather.value.getValue(key).weather["currentWeather"] as JsonObject
        val t1h = (current["t1h"] as JsonPrimitive).content
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitForIdle()
        rule.onNode(hasText(place.name!!), useUnmergedTree = true).assertExists()
        rule.onNodeWithText(t1h, useUnmergedTree = true).assertExists()
        capture("$name-hourly")
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_DETAIL_WEATHER), useUnmergedTree = true).performScrollTo()
        capture("$name-hourly-details")
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(t1h, useUnmergedTree = true).assertExists()
        capture("$name-daily")
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_DETAIL_WEATHER), useUnmergedTree = true).performScrollTo()
        capture("$name-daily-details")
    }

    private fun capture(name: String) {
        rule.waitForIdle()
        Thread.sleep(500)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.getExternalFilesDir(null), "ac2").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
