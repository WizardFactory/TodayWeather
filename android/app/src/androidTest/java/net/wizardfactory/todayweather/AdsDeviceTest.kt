package net.wizardfactory.todayweather

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.ui.forecast.RETRY_DIALOG
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.places.PlacesTags
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The debug build's ads and analytics on an emulator (#2894 AC2), run by tools/emulator/run-ads-check.sh, which reads
 * the Analytics debug log around each run. The script passes `analyticsRegion` `DE`, an opt-in region (analytics
 * default-on, 2026-11-24), so usage analytics starts off on any emulator:
 * - `ads` `online`: the consent flow starts the Ads SDK and a Google native test ad loads below the forecast, favorites and air pages in scrollable
 *   content; usage analytics stays off (the script finds no logged event);
 * - `ads` `optin`, offline: 이용 통계, 동의, then two tabs, so the log shows events and the check above cannot pass
 *   vacuously (nothing is uploaded; the app is removed before the network returns).
 * Each state is captured to the app's files (ads/).
 */
@RunWith(AndroidJUnit4::class)
class AdsDeviceTest {
    val rule = createAndroidComposeRule<MainActivity>()

    // Past the start page without a place: the weather pages ask how to start (O02), and the tests go on from Locations.
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule()).around(rule)

    private val app get() = rule.activity.application as TestTodayWeatherApp

    @Test
    fun aTestNativeCardLoadsOnAllFourPagesWhileAnalyticsStaysOff() {
        assumeTrue("needs -e ads online", TestRunner.args.getString("ads") == "online")
        assertEquals("debug builds request Google's native test unit", "ca-app-pub-3940256099942544/2247696110", BuildConfig.NATIVE_AD_UNIT)
        rule.closeStartChoice()
        ScreenFitWalk(rule).seed()
        for (tab in listOf(Tab.DAILY, Tab.HOURLY, Tab.AIR, Tab.LOCATIONS)) {
            select(tab)
            // A reader who already reached the placement sees no late insertion.
            // Allow the SDK's preloaded creative to be used on a fresh visit in that case.
            val deadline = SystemClock.elapsedRealtime() + 120_000
            while (!hasCard() && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(3_000)
                if (!hasCard()) {
                    // Enter a different tab before returning. Overlays belong to the same reading visit.
                    select(if (tab == Tab.LOCATIONS) Tab.AIR else Tab.LOCATIONS)
                    Thread.sleep(3_000) // Allow a spare to refill if the other page used the previous creative.
                    select(tab)
                }
            }
            rule.onNodeWithTag("admob-native-card").performScrollTo().assertIsDisplayed()
            val bounds = rule.onNodeWithTag("admob-native-card").getBoundsInRoot()
            val tabs = rule.onNodeWithTag(ShellTags.tab(tab)).getBoundsInRoot()
            assertTrue("visible ad is in the scrolling page above navigation", bounds.bottom <= tabs.top)
            rule.onNodeWithTag(ShellTags.BANNER).assertDoesNotExist()
            assertFalse(app.analytics.choice.value)
            capture("${tab.name.lowercase()}-native")
        }
    }

    @Test
    fun noFillShowsEachPageWithoutAdSpace() {
        assumeTrue("needs an offline emulator and -e ads nofill", TestRunner.args.getString("ads") == "nofill")
        rule.closeStartChoice()
        ScreenFitWalk(rule).seed()
        for (tab in listOf(Tab.DAILY, Tab.HOURLY, Tab.AIR, Tab.LOCATIONS)) {
            select(tab)
            val content = when (tab) {
                Tab.DAILY, Tab.HOURLY -> ForecastTags.block(2)
                Tab.AIR -> AirTags.INFO
                Tab.LOCATIONS -> PlacesTags.row(0)
            }
            rule.onNodeWithTag(content).performScrollTo().assertIsDisplayed()
            rule.onNodeWithTag("admob-native-card").assertDoesNotExist()
            rule.onNodeWithTag(ShellTags.BANNER).assertDoesNotExist()
            assertFalse(app.analytics.choice.value)
            capture("${tab.name.lowercase()}-no-fill")
        }
    }

    /**
     * #3211: with `-e adFormats banner` the anchored test banner shows under the tab bar on each tab and no native card
     * loads; with `-e adFormats off` (`tw_banner_enabled` false) neither format appears.
     */
    @Test
    fun theRemoteSwitchesSelectTheAnchoredBanner() {
        val formats = TestRunner.args.getString("adFormats")
        assumeTrue("needs -e ads online -e adFormats banner|off", TestRunner.args.getString("ads") == "online" && formats in setOf("banner", "off"))
        assertEquals("debug builds request Google's adaptive banner test unit", "ca-app-pub-3940256099942544/9214589741", BuildConfig.BANNER_AD_UNIT)
        rule.closeStartChoice()
        ScreenFitWalk(rule).seed()
        for (tab in listOf(Tab.HOURLY, Tab.DAILY, Tab.AIR, Tab.LOCATIONS)) {
            select(tab)
            if (formats == "banner") {
                rule.waitUntil(120_000) { rule.onAllNodes(hasTestTag(ShellTags.BANNER)).fetchSemanticsNodes().isNotEmpty() }
                val banner = rule.onNodeWithTag(ShellTags.BANNER).getBoundsInRoot()
                val tabs = rule.onNodeWithTag(ShellTags.tab(tab)).getBoundsInRoot()
                assertTrue("the banner sits under the tab bar", banner.top >= tabs.bottom)
            } else {
                Thread.sleep(10_000)
                rule.onNodeWithTag(ShellTags.BANNER).assertDoesNotExist()
            }
            val content = when (tab) {
                Tab.DAILY, Tab.HOURLY -> ForecastTags.block(2)
                Tab.AIR -> AirTags.INFO
                Tab.LOCATIONS -> PlacesTags.row(0)
            }
            rule.onNodeWithTag(content).performScrollTo()
            Thread.sleep(3_000)
            assertFalse("no native card while tw_native_enabled is false or ads are off", hasCard())
            capture("${tab.name.lowercase()}-$formats")
        }
    }

    private fun hasCard() = rule.onAllNodes(hasTestTag("admob-native-card")).fetchSemanticsNodes().isNotEmpty()

    private fun select(tab: Tab) {
        rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
        rule.waitUntil(30_000) { app.weather.loading.value.isEmpty() }
        rule.waitForIdle()
        if (rule.onAllNodes(hasTestTag(RETRY_DIALOG)).fetchSemanticsNodes().isNotEmpty()) {
            rule.onNode(hasText(rule.activity.getString(R.string.LOC_CLOSE)) and hasAnyAncestor(hasTestTag(RETRY_DIALOG))).performClick()
        }
    }

    @Test
    fun anOptInStartsCollection() {
        assumeTrue("needs -e ads optin", TestRunner.args.getString("ads") == "optin")
        rule.closeStartChoice()
        rule.waitUntil(30_000) { app.appState.current() != null }
        assertFalse(app.analytics.choice.value)
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(MenuRow.ANALYTICS)).performScrollTo().performClick()
        rule.waitForIdle()
        capture("analytics-popup")
        rule.onNode(hasText(rule.activity.getString(R.string.analytics_consent_allow)) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true)
            .performClick()
        rule.waitUntil(5_000) { app.analytics.collecting.value }
        rule.waitForIdle()
        assertTrue(app.analytics.choice.value)
        assertTrue(app.analytics.collecting.value)
        rule.activity.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        for (tab in listOf(Tab.DAILY, Tab.AIR, Tab.HOURLY)) {
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            rule.waitForIdle()
            Thread.sleep(1_000)
        }
        capture("opted-in")
        Thread.sleep(3_000)
    }

    @Test
    fun aWithdrawalShowsProgressWhileTheWriterIsBusy() {
        assumeTrue("needs -e ads withdrawal", TestRunner.args.getString("ads") == "withdrawal")
        rule.closeStartChoice()
        ScreenFitWalk(rule).seed()
        rule.waitUntil(30_000) { app.appState.current() != null }
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.runOnIdle {
            val window = rule.activity.window
            WindowCompat.getInsetsController(window, window.decorView).hide(WindowInsetsCompat.Type.ime())
        }
        val analyticsRow = rule.onNodeWithTag(ShellTags.row(MenuRow.ANALYTICS))
        analyticsRow.performScrollTo().performClick()
        fun popupButton(text: Int) = rule.onNode(
            hasText(rule.activity.getString(text)) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)),
            useUnmergedTree = true,
        )
        popupButton(R.string.analytics_consent_allow).performClick()
        rule.waitUntil(5_000) { app.analytics.collecting.value }

        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val blocker = app.appScope.launch(app.analyticsWriter) {
            entered.countDown()
            release.await(20, TimeUnit.SECONDS)
        }
        assertTrue("the background writer must be held", entered.await(5, TimeUnit.SECONDS))
        try {
            analyticsRow.performClick()
            popupButton(R.string.analytics_consent_deny).performClick()
            rule.waitForIdle()
            assertFalse(app.analytics.collecting.value)
            assertEquals("true", ConsentStore(app).storedChoice())
            rule.onNode(
                SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo) and
                    hasAnyAncestor(hasTestTag(PopupTags.POPUP)),
                useUnmergedTree = true,
            ).assertIsDisplayed()
            capture("analytics-withdrawal-pending")
        } finally {
            release.countDown()
            blocker.cancel()
        }
        rule.waitUntil(5_000) { !app.analyticsChoices.savingWithdrawal.value }
        rule.waitForIdle()
        assertEquals(null, app.analyticsChoices.saveFailure.value)
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertEquals("false", ConsentStore(app).storedChoice())
        assertFalse(app.analytics.collecting.value)
        capture("analytics-withdrawal-saved")
    }

    @Test
    fun aSavedWithdrawalRemainsOffInANewProcess() {
        assumeTrue("needs -e ads withdrawal-restart after the withdrawal test", TestRunner.args.getString("ads") == "withdrawal-restart")
        assertEquals("false", ConsentStore(app).storedChoice())
        assertFalse(app.analytics.choice.value)
        assertFalse(app.analytics.collecting.value)
    }

    private fun capture(name: String) {
        rule.waitForIdle()
        Thread.sleep(500)
        val shot = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()) { "No screenshot: $name" }
        val dir = File(rule.activity.getExternalFilesDir(null), "ads").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
