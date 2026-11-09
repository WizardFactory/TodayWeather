package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import net.wizardfactory.todayweather.core.domain.shell.Tab
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
 * the Analytics debug log around each run:
 * - `ads` `online`: the consent flow starts the Ads SDK and a banner of Google's test unit loads and shows under the
 *   tab bar, above the navigation bar; usage analytics stays off (the script finds no logged event);
 * - `ads` `optin`, offline: 선택적 이용 통계, 동의, then two tabs, so the log shows events and the check above cannot pass
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
    fun aTestBannerLoadsAndShowsWhileAnalyticsStaysOff() {
        assumeTrue("needs -e ads online", TestRunner.args.getString("ads") == "online")
        rule.closeStartChoice()
        assertEquals("debug builds request Google's test unit", "ca-app-pub-3940256099942544/9214589741", BuildConfig.BANNER_AD_UNIT)
        rule.waitUntil(120_000) { rule.onAllNodes(hasTestTag(ShellTags.BANNER)).fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        Thread.sleep(2_000)
        val banner = rule.onNodeWithTag(ShellTags.BANNER).getBoundsInRoot()
        val tab = rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).getBoundsInRoot()
        val root = rule.onRoot().getBoundsInRoot()
        val density = rule.activity.resources.displayMetrics.density
        val navigation = ViewCompat.getRootWindowInsets(rule.activity.window.decorView)!!.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density
        assertEquals("the banner sits under the tab bar", tab.bottom.value, banner.top.value, 0.5f)
        assertEquals("and above the navigation bar", root.bottom.value - navigation, banner.bottom.value, 0.5f)
        assertTrue("an anchored adaptive banner is at least 50 dp tall", banner.bottom.value - banner.top.value >= 50f)
        assertFalse(app.analytics.choice.value)
        capture("banner")
        // The menu ends at the banner's top edge, as it ended at the WebView's.
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        assertEquals(banner.top.value, rule.onNodeWithTag(ShellTags.MENU).getBoundsInRoot().bottom.value, 0.5f)
        capture("menu")
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
        rule.onNode(hasText(rule.activity.getString(R.string.LOC_ANALYTICS_ALLOW)) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true)
            .performClick()
        rule.waitForIdle()
        assertTrue(app.analytics.choice.value)
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

    private fun capture(name: String) {
        rule.waitForIdle()
        Thread.sleep(500)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.getExternalFilesDir(null), "ads").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
