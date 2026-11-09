package net.wizardfactory.todayweather

import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlin.math.abs
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.startShows
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import net.wizardfactory.todayweather.ui.start.StartTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A new install's start page against the production server (#2889 AC2), run by tools/emulator/run-production-start.sh
 * on an emulator with a geo fix, one test per new install (`start` `position` or `search`):
 * - 현재위치 날씨보기, allowed in the system's dialog, reaches S03 with the weather of the emulator's position;
 * - with location denied in the dialog (O04), a searched place reaches S03: a Places prediction with the build's key,
 *   else a bundled town.
 * Geocode and weather requests are read-only GETs; push requests are recorded by the test app. The screens are captured
 * to the app's files (start/).
 */
@RunWith(AndroidJUnit4::class)
class ProductionStartTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test
    fun thePositionOpensItsWeather() {
        assume("position")
        closeNotice()
        rule.onNodeWithTag(StartTags.LOCATION).performClick()
        dialogButton("permission_allow_foreground_only_button")
        // The fix, its geocode and its weather: S01 closes on Hourly with the current position.
        rule.waitUntil(90_000) { app.appState.current()?.startShows == false }
        val state = app.appState.current()!!
        val current = state.places[0]
        assertTrue(current.currentPosition)
        assertFalse(current.disable)
        assertEquals(0, state.placeIndex)
        val location = current.location!!
        assertTrue("near the emulator's fix: $location", abs(location.lat - FIX_LAT) < 0.01 && abs(location.long - FIX_LONG) < 0.01)
        assertTrue("named from the geocode: ${current.name}", !current.name.isNullOrBlank())
        shows(Tab.HOURLY, WeatherRepository.key(current))
        capture("position")
    }

    @Test
    fun aSearchedPlaceOpensItsWeatherWithLocationDenied() {
        assume("search")
        closeNotice()
        rule.onNodeWithTag(StartTags.LOCATION).performClick()
        dialogButton("permission_deny_button")
        // O04: access denied, Close and OK.
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        capture("denied")
        rule.onAllNodes(hasTestTag(PopupTags.BUTTON))[0].performClick()
        rule.waitForIdle()
        // Google's predictions with the build's key; the bundled towns without one.
        val places = BuildConfig.PLACES_API_KEY.isNotBlank()
        rule.onNodeWithTag(StartTags.INPUT).performClick().performTextInput(if (places) "Seoul" else "회현동")
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(StartTags.result(0))).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        capture(if (places) "predictions" else "towns")
        // A first tap with the keyboard up only closes it, as in the Cordova app; the next one chooses.
        rule.onNodeWithTag(StartTags.result(0)).performClick()
        rule.waitForIdle()
        Thread.sleep(800)
        if (rule.onAllNodes(hasTestTag(StartTags.result(0))).fetchSemanticsNodes().isNotEmpty()) rule.onNodeWithTag(StartTags.result(0)).performClick()
        rule.waitUntil(90_000) { app.appState.current()?.startShows == false }
        val state = app.appState.current()!!
        assertTrue("slot 0 stays off", state.places[0].disable)
        val added = state.places[state.placeIndex]
        assertEquals(1, state.placeIndex)
        assertTrue("a place with its location: $added", added.location != null && !added.name.isNullOrBlank())
        shows(Tab.HOURLY, WeatherRepository.key(added))
        capture("searched")
    }

    private fun assume(step: String) {
        assumeTrue("needs -e weather production", TestRunner.args.getString("weather") == "production")
        assumeTrue("needs -e start $step on a new install", TestRunner.args.getString("start") == step)
    }

    /** O01 over S01 on a new install: captured, then closed. */
    private fun closeNotice() {
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        assertTrue(app.appState.current()!!.startShows)
        capture("notice")
        rule.onNodeWithTag(PopupTags.BUTTON).performClick()
        rule.waitForIdle()
        capture("start")
    }

    /** The tabs on [tab] with the weather of [key]. */
    private fun shows(tab: Tab, key: String) {
        rule.waitUntil(60_000) { app.weather.weather.value.containsKey(key) }
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.page(tab)).assertExists()
    }

    /** Taps the button [id] of the system's permission dialog once it shows. */
    private fun dialogButton(id: String) {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        val deadline = SystemClock.uptimeMillis() + 20_000
        while (SystemClock.uptimeMillis() < deadline) {
            val button = automation.windows.mapNotNull { it.root }
                .flatMap { it.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/$id") }.firstOrNull()
            if (button != null) {
                button.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                Thread.sleep(500)
                return
            }
            Thread.sleep(300)
        }
        fail("the permission dialog did not show $id")
    }

    private fun capture(name: String) {
        val dir = File(rule.activity.getExternalFilesDir(null), "start").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { rule.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private companion object {
        /** The emulator's fix set by run-production-start.sh: Seoul City Hall. */
        const val FIX_LAT = 37.5665
        const val FIX_LONG = 126.978
    }
}
