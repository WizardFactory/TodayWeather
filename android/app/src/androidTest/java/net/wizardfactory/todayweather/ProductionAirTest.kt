package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
import org.junit.runner.RunWith

/**
 * S05 against the production server (#2888 AC2), run by tools/emulator/run-production-weather.sh with `weather`
 * `production` on an emulator: Seoul saved, the Air tab shows its measuring stations once its weather has loaded, and
 * tapping the second station shows that station: its name in the info card, its value on the gauge and its cell
 * selected. The screen is captured to the app's files (ac2/). Weather requests are read-only GETs; push requests are
 * recorded by the test app, not sent.
 */
@RunWith(AndroidJUnit4::class)
class ProductionAirTest {
    val rule = createAndroidComposeRule<MainActivity>()

    // Korean units (the airkorea standard), whatever the device's region; the place is saved before the app opens.
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule {
        it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, units = UnitSettings.defaults("KR"))
    }).around(rule)

    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))

    @Test
    fun seoulShowsItsStationsAndAnotherStationShowsItsValues() {
        assumeTrue("needs -e weather production", TestRunner.args.getString("weather") == "production")
        rule.waitUntil(30_000) { app.appState.current() != null }
        rule.waitForIdle()
        // The first tap selects the Air tab; the next, past the 700 ms guard, loads Seoul at once (`reloadEvent` "tab").
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        Thread.sleep(800)
        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        val key = WeatherRepository.key(seoul)
        rule.waitUntil(40_000) { app.weather.weather.value.containsKey(key) }
        rule.waitForIdle()
        val stations = (app.weather.weather.value.getValue(key).weather["airInfoList"] as? JsonArray).orEmpty().map { it as JsonObject }
        fun last(i: Int) = stations[i]["last"] as JsonObject
        fun text(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.content
        capture("air-seoul")
        // The server sends AirKorea's nearest stations; without them (its Google fallback) there is one record and no name.
        assertTrue("Seoul has more than one station: ${stations.size} from ${stations.map { text(it, "source") }}", stations.size > 1)

        // The station card's block number depends on the cards before it (production may send no daily forecast).
        rule.onNodeWithTag(AirTags.STATIONS).performScrollTo()
        rule.waitForIdle()
        rule.onNodeWithTag(AirTags.station(0)).assertIsSelected()
        stations.indices.forEach { i ->
            rule.onNode(hasText(text(last(i), "stationName")!!) and hasAnyAncestor(hasTestTag(AirTags.station(i))), useUnmergedTree = true).assertExists()
        }
        capture("air-seoul-stations")
        rule.onNodeWithTag(AirTags.station(1)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AirTags.station(1)).assertIsSelected()
        // The info card names the second station, and the gauge shows its overall index (`-` without one).
        rule.onNode(hasText(text(last(1), "stationName")!!, substring = true) and hasAnyAncestor(hasTestTag(AirTags.INFO)),
            useUnmergedTree = true).assertExists()
        rule.onNode(hasText(text(last(1), "aqiValue") ?: "-") and hasAnyAncestor(hasTestTag(AirTags.LABEL)), useUnmergedTree = true).assertExists()
        capture("air-seoul-station-2")
        rule.onNodeWithTag(AirTags.STATIONS).performScrollTo()
        capture("air-seoul-station-2-stations")
    }

    private fun capture(name: String) {
        rule.waitForIdle()
        Thread.sleep(500)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.getExternalFilesDir(null), "ac2").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
