package net.wizardfactory.todayweather

import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Bitmap
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.runBlocking
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.data.PageLoad
import net.wizardfactory.todayweather.core.domain.Nationwide
import net.wizardfactory.todayweather.ui.nation.NationPageState
import net.wizardfactory.todayweather.ui.nation.NationRoutes
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.*
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.alarms.AlarmsTags
import net.wizardfactory.todayweather.ui.chart.EXPANDER_TAG
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.nation.NationTags
import net.wizardfactory.todayweather.ui.places.PlacesTags
import net.wizardfactory.todayweather.ui.settings.SettingsTags
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import net.wizardfactory.todayweather.ui.start.StartTags
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain

/** Actual native UI and live read-only data for AN-18's manual. One method per cleared install.
 * The test application records product push requests locally; no token is supplied and analytics stays off.
 * No fake weather, predictions or bitmap is injected. Never select a share recipient or enable analytics.
 */
internal class ManualWalk(val rule: AndroidComposeTestRule<*, MainActivity>) {
    val app get() = rule.activity.application as TestTodayWeatherApp
    val automation get() = InstrumentationRegistry.getInstrumentation().uiAutomation
    fun capture(name: String, system: Boolean = false) {
        if (!system) rule.waitForIdle()
        Thread.sleep(600)
        assertFalse("manual never opts into analytics", app.analytics.choice.value)
        val shot = checkNotNull(automation.takeScreenshot()) { "No screenshot: $name" }
        val dir = File(rule.activity.getExternalFilesDir(null), "manual").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { check(shot.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        File(dir, "$name.json").writeText(JSONObject().put("name", name).put("capturedAt", java.time.Instant.now().toString())
            .put("width", shot.width).put("height", shot.height).put("analytics", false)
            .put("pushTransport", "intercepted").put("recordedPushRequests", app.sent.size)
            .put("language", rule.activity.resources.configuration.locales.toLanguageTags()).toString(2))
        shot.recycle()
    }
    fun tap(tag: String) { rule.onNodeWithTag(tag).performClick(); rule.waitForIdle() }
    fun back() { rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }; rule.waitForIdle() }
    fun menu(row: MenuRow) {
        tap(ShellTags.MENU_BUTTON)
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitForIdle()
    }
    fun weather() {
        val place = app.appState.current()!!.let { it.places[it.placeIndex] }
        rule.waitUntil(90_000) { app.weather.weather.value.containsKey(WeatherRepository.key(place)) }
        rule.waitForIdle()
        assertTrue("weather has a current observation", app.weather.weather.value.getValue(WeatherRepository.key(place)).weather.containsKey("currentWeather"))
    }
    fun tab(tab: Tab) { tap(ShellTags.tab(tab)); Thread.sleep(800) }
    fun permission(id: String, name: String? = null) {
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) {
            val button = automation.windows.mapNotNull { it.root }.flatMap {
                it.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/$id")
            }.firstOrNull()
            if (button != null) {
                if (name != null) capture(name, system = true)
                check(button.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                Thread.sleep(700)
                return
            }
            Thread.sleep(250)
        }
        error("Permission button absent: $id")
    }
}

class ManualFirstLaunchTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @Test fun firstLaunch() {
        assumeTrue(TestRunner.args.getString("manual") == "true" && TestRunner.args.getString("weather") == "production")
        val walk = ManualWalk(rule)
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty() }
        walk.capture("01-access-notice")
        walk.tap(PopupTags.BUTTON)
        walk.capture("02-start")
        rule.onNodeWithTag(StartTags.LOCATION).performScrollTo().performClick()
        walk.permission("permission_allow_foreground_only_button", "03-location-permission")
        rule.waitUntil(90_000) { walk.app.appState.current()?.startShows == false }
        walk.weather()
        val place = walk.app.appState.current()!!.places[0]
        assertTrue(place.currentPosition && !place.disable)
        assertTrue(kotlin.math.abs(place.location!!.lat - 37.5665) < .01)
        walk.capture("04-current-location")
    }
}

class ManualCaptureTest {
    val rule = createAndroidComposeRule<MainActivity>()
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule {
        it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, units = UnitSettings.defaults("KR"))
    }).around(rule)
    private val walk get() = ManualWalk(rule)
    private val app get() = walk.app
    @Before fun ready() {
        assumeTrue(TestRunner.args.getString("manual") == "true" && TestRunner.args.getString("weather") == "production")
        rule.waitUntil(30_000) { app.appState.current() != null }
        walk.tab(Tab.DAILY); walk.tab(Tab.HOURLY); walk.tap(ShellTags.tab(Tab.HOURLY)); walk.weather()
    }
    @Test fun weatherAndAir() {
        walk.capture("05-hourly")
        rule.onNodeWithTag(EXPANDER_TAG).performScrollTo().performClick()
        walk.capture("06-hourly-expanded")
        chartEnds("07-hourly-past", "08-hourly-future")
        walk.tab(Tab.DAILY); walk.capture("09-daily")
        chartEnds("10-daily-past", "11-daily-future")
        walk.tab(Tab.AIR); walk.capture("12-air")
        rule.onNodeWithTag(AirTags.code("pm25")).performScrollTo().performClick()
        rule.onNodeWithTag(AirTags.code("pm25")).assertIsSelected()
        walk.capture("13-air-pm25")
        rule.onNodeWithTag(AirTags.STATIONS).performScrollTo()
        walk.capture("14-stations")
        walk.tap(AirTags.station(1))
        rule.onNodeWithTag(AirTags.station(1)).assertIsSelected()
        walk.capture("15-station-selected")
    }
    private fun chartEnds(first: String, last: String) {
        rule.onNodeWithTag(ForecastTags.block(1)).performScrollTo()
        val matcher = SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange) and hasAnyAncestor(hasTestTag(ForecastTags.block(1)))
        val node = rule.onNode(matcher, useUnmergedTree = true)
        fun move(end: Boolean) {
            repeat(16) {
                val range = node.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange]
                if (if (end) range.value() >= range.maxValue() - 1 else range.value() <= 1) return
                node.performTouchInput { if (end) swipeLeft() else swipeRight() }
                rule.waitForIdle()
            }
            error("Chart did not reach endpoint")
        }
        move(false); walk.capture(first); move(true); walk.capture(last)
    }
    @Test fun places() {
        walk.tab(Tab.LOCATIONS); walk.capture("16-places")
        rule.onNodeWithTag(PlacesTags.INPUT).performClick().performTextInput("부산")
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PlacesTags.town(0))).fetchSemanticsNodes().isNotEmpty() }
        Espresso.closeSoftKeyboard(); walk.capture("17-place-search")
        walk.tap(PlacesTags.town(0))
        rule.waitUntil(30_000) { app.appState.current()!!.places.size == 3 }
        walk.weather(); walk.capture("18-busan")
        walk.tap(ForecastTags.PREVIOUS)
        rule.waitUntil(10_000) { app.appState.current()!!.placeIndex == 1 }
        walk.capture("19-switch-seoul")
        walk.tab(Tab.LOCATIONS)
        rule.onNodeWithTag(PlacesTags.INPUT).performClick().performTextReplacement("London")
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PlacesTags.prediction(0))).fetchSemanticsNodes().isNotEmpty() }
        Espresso.closeSoftKeyboard(); rule.waitForIdle(); Thread.sleep(800); walk.tap(PlacesTags.prediction(0))
        rule.waitUntil(30_000) { app.appState.current()!!.places.size == 4 }
        walk.weather(); walk.capture("20-london")
        walk.tab(Tab.LOCATIONS); walk.tap(PlacesTags.MODE); walk.capture("21-delete-place")
        walk.tap(PlacesTags.delete(3))
        rule.waitUntil(10_000) { app.appState.current()!!.places.size == 3 }
        walk.capture("22-place-deleted")
    }
    @Test fun alarms() {
        walk.tap(WeatherTabTags.BELL)
        walk.permission("permission_allow_button", "23a-notification-permission")
        walk.capture("23-alarms")
        rule.onNodeWithTag(AlarmsTags.row(0)).performScrollTo().performClick()
        walk.capture("24-time-picker")
        walk.tap(AlarmsTags.PICKER_CLOSE)
        val saved = app.appState.current()!!.push
        rule.onNodeWithTag(AlarmsTags.day(0)).performScrollTo().performClick()
        rule.onNodeWithTag(AlarmsTags.CANCEL).performScrollTo().performClick()
        rule.waitUntil(10_000) { rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty() }
        walk.capture("25-alarm-confirmation")
        // Close without saving. Capturing this manual must never claim delivery of a real alarm.
        rule.onAllNodes(hasTestTag(PopupTags.BUTTON))[0].performClick()
        assertEquals(saved, app.appState.current()!!.push)
        assertFalse(app.analytics.choice.value)
    }
    @Test fun settings() {
        walk.tap(ShellTags.MENU_BUTTON); walk.capture("26-menu"); walk.back()
        walk.menu(MenuRow.UNITS); walk.capture("27-units")
        walk.tap(SettingsTags.row(0)); walk.capture("28-temperature")
        walk.tap(SettingsTags.row(1))
        rule.waitUntil(10_000) { app.appState.current()!!.units.value("temperatureUnit") == "F" }
        walk.capture("29-fahrenheit")
        walk.back(); walk.back()
        walk.menu(MenuRow.STARTUP_PAGE); walk.capture("30-startup-page"); walk.back()
        walk.menu(MenuRow.REFRESH_INTERVAL); walk.capture("31-refresh"); walk.back()
        walk.menu(MenuRow.THEME); walk.tap(SettingsTags.row(2))
        rule.waitUntil(10_000) { app.appState.current()!!.settings.theme == "dark" }
        walk.capture("32-dark-theme")
        walk.back(); walk.capture("33-dark-weather")
        walk.menu(MenuRow.THEME); walk.tap(SettingsTags.row(0)); walk.back()
        // Refresh applies the feed's photo to the selected place.
        Thread.sleep(800); walk.tap(ShellTags.tab(Tab.HOURLY))
        rule.waitUntil(60_000) { rule.onAllNodes(hasTestTag(ForecastTags.PHOTO)).fetchSemanticsNodes().isNotEmpty() }
        walk.capture("34-photo-theme")
    }
    @Test fun nation() {
        fun open(row: MenuRow, name: String) {
            walk.menu(row)
            rule.waitUntil(60_000) { rule.onAllNodes(hasTestTag(NationTags.LOADING)).fetchSemanticsNodes().isEmpty() }
            rule.onNodeWithTag(NationTags.PAGE).assertExists()
            var loads: net.wizardfactory.todayweather.ui.nation.NationLoads? = null
            rule.runOnUiThread { loads = ViewModelProvider(rule.activity)[OpenedModel::class.java].nation }
            val route = when (row) {
                MenuRow.NATIONAL_WEATHER -> NationRoutes.NATION
                MenuRow.NATIONAL_AIR -> NationRoutes.NATION_AIR
                else -> NationRoutes.WARNINGS
            }
            rule.waitUntil(60_000) { loads!!.pages.value[route].let { it is NationPageState.Nation || it is NationPageState.Warnings } }
            if (row == MenuRow.SPECIAL_WEATHER) {
                // A blank warning page alone cannot distinguish no bulletins from a failed request.
                val reply = runBlocking { NationSource(BuildConfig.SERVER_URL).special(listOf("ko-KR")) }
                assertTrue("warnings endpoint answered", reply is PageLoad.Loaded)
            } else {
                assertNotNull("nationwide response loaded", (loads!!.pages.value[route] as NationPageState.Nation).response)
                val cities = if (row == MenuRow.NATIONAL_WEATHER) Nationwide.WEATHER_CITIES else Nationwide.AIR_CITIES
                val populated = cities.count { city -> rule.onAllNodes(
                    hasAnyAncestor(hasTestTag(NationTags.label(city.name))) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Text),
                    useUnmergedTree = true).fetchSemanticsNodes().size >= 2 }
                assertTrue("populated map labels: $populated", populated >= 12)
            }
            walk.capture(name)
        }
        open(MenuRow.SPECIAL_WEATHER, "35-warnings"); walk.tap(NationTags.BACK)
        open(MenuRow.NATIONAL_WEATHER, "36-national-weather")
        walk.tap(NationTags.mode(2)); walk.capture("37-national-wind")
        walk.tap(NationTags.BACK)
        open(MenuRow.NATIONAL_AIR, "38-national-air")
    }
    @Test fun privacyAndShare() {
        walk.menu(MenuRow.ABOUT); walk.capture("39-about"); walk.back(); walk.back()
        walk.menu(MenuRow.ANALYTICS); walk.capture("40-analytics"); walk.back(); walk.back()
        walk.menu(MenuRow.AD_PRIVACY)
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty() }
        walk.capture("41-ad-privacy"); walk.back(); walk.back()
        walk.tap(WeatherTabTags.SHARE)
        Thread.sleep(2000)
        val front = walk.automation.rootInActiveWindow?.packageName?.toString()
        assertTrue("Android chooser in front: $front", front == "android" || front == "com.android.intentresolver")
        walk.capture("42-share-chooser", system = true)
        walk.automation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        Thread.sleep(1000); walk.back(); walk.capture("43-exit")
    }
}
