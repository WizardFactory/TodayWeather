package net.wizardfactory.todayweather

import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.alarms.AlarmsTags
import net.wizardfactory.todayweather.ui.start.StartTags
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import org.junit.Assert.assertEquals
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.nation.NationTags
import net.wizardfactory.todayweather.ui.forecast.RETRY_DIALOG
import net.wizardfactory.todayweather.ui.settings.SettingsTags
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellFit
import net.wizardfactory.todayweather.ui.shell.ShellTags

/** Offline real-activity traversal; populated content has separate JVM fit and parity oracles. */
internal class ScreenFitWalk(private val rule: AndroidComposeTestRule<*, MainActivity>) {
    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val place = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))

    fun seed() = runBlocking {
        val body = InstrumentationRegistry.getInstrumentation().context.assets.open("corpus/inputs/kma-seoul.json").bufferedReader().use { it.readText() }
        val cache = WeatherRepository("https://fixture.invalid", File(app.filesDir, "weather"), HttpGet { _, _ -> body })
        cache.load(place, UnitSettings.defaults("KR"), listOf("ko-KR"), true)
        app.weather.cached(place)
        app.appState.dataStore.updateData { it.copy(places = listOf(place), placeIndex = 0, units = UnitSettings.defaults("KR")) }
    }

    fun walk(capture: (String) -> Unit): List<String> {
        val failures = mutableListOf<String>()
        fun check(name: String) {
            rule.waitForIdle()
            failures += ShellFit.texts(rule, name, ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot), hasAnyAncestor(hasTestTag(AirTags.BANDS)))
            capture(name)
        }
        fun settleWeather() {
            rule.waitUntil(30_000) { app.weather.loading.value.isEmpty() }
            rule.waitForIdle()
            if (rule.onAllNodes(hasTestTag(RETRY_DIALOG)).fetchSemanticsNodes().isNotEmpty()) {
                rule.onNode(hasText(rule.activity.getString(R.string.LOC_CLOSE)) and hasAnyAncestor(hasTestTag(RETRY_DIALOG))).performClick()
                rule.waitForIdle()
            }
        }
        for (tab in listOf(Tab.HOURLY, Tab.DAILY, Tab.AIR, Tab.LOCATIONS)) {
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            settleWeather()
            check("tab-${tab.state}")
            if (tab != Tab.LOCATIONS) for (index in 0..8) {
                val tag = if (tab == Tab.AIR) AirTags.block(index) else ForecastTags.block(index)
                if (rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()) {
                    rule.onNodeWithTag(tag).performScrollTo()
                    check("tab-${tab.state}-block-$index")
                }
            }
        }
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        settleWeather()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        check("alarms")
        rule.onNodeWithTag(AlarmsTags.SAVE).performScrollTo()
        check("alarms-bottom")
        rule.onNodeWithTag(AlarmsTags.row(0)).performScrollTo().performClick()
        check("alarm-picker")
        rule.onNodeWithTag(AlarmsTags.PICKER_CLOSE).performClick()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        // Settings screens use the production navigation and actual saved state.
        for (row in listOf(MenuRow.UNITS, MenuRow.STARTUP_PAGE, MenuRow.REFRESH_INTERVAL, MenuRow.THEME)) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
            check("settings-$row")
            rule.onNodeWithTag(SettingsTags.BACK).performClick()
        }
        for (row in listOf(MenuRow.NATIONAL_WEATHER, MenuRow.NATIONAL_AIR, MenuRow.SPECIAL_WEATHER)) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
            rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(NationTags.LOADING)).fetchSemanticsNodes().isEmpty() }
            check("offline-$row")
            rule.onNodeWithTag(NationTags.BACK).performClick()
        }
        // Exercise the real start screen and its access notice in the same window. Restore the
        // seed without adding a place or requesting device location.
        assertEquals("the selected place survives the window change", listOf(place), app.appState.state.value!!.places)
        runBlocking { app.appState.dataStore.updateData { it.copy(cordovaExtras = it.cordovaExtras - "startVersion") } }
        rule.waitUntil(10_000) { rule.onAllNodes(hasTestTag(StartTags.LOCATION)).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        // The activity's retained StartPage shows O01 once per app open, not each test gate toggle.
        val okay = hasText(rule.activity.getString(R.string.LOC_OK))
        if (rule.onAllNodes(okay).fetchSemanticsNodes().isNotEmpty()) {
            failures += ShellFit.texts(rule, "access-notice", null)
            capture("access-notice")
            rule.onNode(okay).performClick()
        }
        check("start")
        runBlocking { app.appState.dataStore.updateData { it.afterStart() } }
        rule.waitUntil(10_000) { rule.onAllNodes(hasTestTag(ShellTags.MENU_BUTTON)).fetchSemanticsNodes().isNotEmpty() }
        settleWeather()
        return failures
    }
}
