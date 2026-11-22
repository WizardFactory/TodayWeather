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
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain

/**
 * The four Play Store screens (#3122) from the actual app and live read-only data, with Seoul saved: hourly weather with
 * yesterday's comparison, the expanded hourly details, daily forecasts and air quality. Run by
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
