package net.wizardfactory.todayweather

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.chart.EXPANDER_TAG
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain

/**
 * The Play Store screens (#3122) from the actual app and live read-only data, with Seoul saved: hourly weather with
 * yesterday's comparison, the expanded hourly details, daily forecasts and air quality ([store]), then the home-screen
 * widgets ([widgets]). Run by
 * `android/tools/store/capture.sh` with `manual` `true`, `weather` `production`, `ads` `off` and `region` (the units a
 * new install of that region gets); the app language is set by the script. Same safety as the manual walk: push
 * intercepted, no token, analytics off and asserted at each capture.
 */
class StoreCaptureTest {
    val rule = createAndroidComposeRule<MainActivity>()
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule {
        it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
            units = UnitSettings.defaults(TestRunner.args.getString("region") ?: "KR"))
    }).around(rule)
    private val walk get() = ManualWalk(rule)

    @Before fun ready() {
        assumeTrue(TestRunner.args.getString("manual") == "true" && TestRunner.args.getString("weather") == "production" && adsOff())
        rule.waitUntil(30_000) { walk.app.appState.current() != null }
        walk.tab(Tab.DAILY); walk.tab(Tab.HOURLY); walk.tap(ShellTags.tab(Tab.HOURLY)); walk.weather()
    }

    /**
     * The fifth Play image: the app's home-screen widgets on the launcher, following Seoul with the weather the app has
     * just loaded. Each widget is pinned through the launcher's own confirmation (`requestPinAppWidget`, then its add
     * button), so the screen shows real placed widgets; the capture script uninstalls the app afterwards, which removes
     * them.
     */
    @Test fun widgets() {
        val manager = android.appwidget.AppWidgetManager.getInstance(walk.app)
        assertTrue("the launcher can pin widgets", manager.isRequestPinAppWidgetSupported)
        for (receiver in listOf(net.wizardfactory.todayweather.widget.ForecastReceiver::class.java,
            net.wizardfactory.todayweather.widget.ClockReceiver::class.java,
            net.wizardfactory.todayweather.widget.CurrentReceiver::class.java,
            net.wizardfactory.todayweather.widget.AirReceiver::class.java)) {
            rule.runOnUiThread { manager.requestPinAppWidget(android.content.ComponentName(walk.app, receiver), null, null) }
            walk.launcherAdd()
        }
        for (receiver in listOf(net.wizardfactory.todayweather.widget.ForecastReceiver::class.java,
            net.wizardfactory.todayweather.widget.ClockReceiver::class.java,
            net.wizardfactory.todayweather.widget.CurrentReceiver::class.java,
            net.wizardfactory.todayweather.widget.AirReceiver::class.java)) {
            assertTrue("${receiver.simpleName} is placed",
                manager.getAppWidgetIds(android.content.ComponentName(walk.app, receiver)).size == 1)
        }
        // Home twice: the first returns to the page of the last placed widget, the second to the first page. The launcher
        // puts the two wide widgets on the next page and the current and air widgets on the one after it.
        repeat(2) {
            walk.automation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            Thread.sleep(2500)
        }
        val size = walk.app.resources.displayMetrics
        fun nextPage() {
            // Read to the end: the shell command runs until its output closes.
            android.os.ParcelFileDescriptor.AutoCloseInputStream(walk.automation.executeShellCommand(
                "input swipe ${size.widthPixels * 5 / 6} ${size.heightPixels / 2} ${size.widthPixels / 6} ${size.heightPixels / 2} 300")
            ).use { it.readBytes() }
            Thread.sleep(3000)
        }
        nextPage()
        walk.capture("store-05-widgets", system = true)
        nextPage()
        walk.capture("store-06-widgets", system = true)
    }

    @Test fun store() {
        Thread.sleep(1500)
        walk.capture("store-01-compare")
        rule.onNodeWithTag(EXPANDER_TAG).performScrollTo().performClick()
        rule.waitForIdle()
        walk.capture("store-02-hourly")
        walk.tab(Tab.DAILY)
        Thread.sleep(1000)
        walk.capture("store-03-daily")
        walk.tab(Tab.AIR)
        Thread.sleep(1500)
        walk.capture("store-04-air")
    }
}
