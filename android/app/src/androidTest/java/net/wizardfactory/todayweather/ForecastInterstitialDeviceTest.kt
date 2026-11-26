package net.wizardfactory.todayweather

import androidx.activity.ComponentActivity
import androidx.compose.runtime.saveable.SaverScope
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.FullScreenContentCallback
import net.wizardfactory.todayweather.ads.ForecastAdRequest
import net.wizardfactory.todayweather.ads.ForecastInterstitial
import net.wizardfactory.todayweather.ads.ReadyForecastAd
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.ui.shell.ShellNavigation
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Offline SDK-boundary fixture. The foreground activity, saved navigation and durable daily reservations are real. */
@RunWith(AndroidJUnit4::class)
class ForecastInterstitialDeviceTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun firstVisitsFailureDismissalAndRestoredCap() {
        rule.waitUntil(10_000) { rule.activity.hasWindowFocus() }
        rule.runOnUiThread {
            val activity = rule.activity
            val store = "test_forecast_interstitial_" + System.nanoTime()
            var pendingLoad: ((ReadyForecastAd) -> Unit)? = null
            var presentation: FullScreenContentCallback? = null
            val request = ForecastAdRequest { loaded, _ -> pendingLoad = loaded }
            val creative = ReadyForecastAd { presentation = it }
            var roll = 0.0
            fun controller() = ForecastInterstitial(activity, "offline-fixture", { _, _ -> true }, request, { roll }, store)
            var ads = controller()
            val nav = ShellNavigation(Tab.HOURLY)
            fun tap(tab: Tab) {
                if (!nav.deferForecast(tab, ads::handleTap)) nav.selected = tab
                ads.recordVisible(nav.selected)
            }
            try {
                ads.recordVisible(Tab.HOURLY)
                ads.setEnabled(true)
                // Late result after revocation cannot be used on a visit.
                ads.setEnabled(false)
                pendingLoad!!(creative)
                tap(Tab.DAILY)
                assertNull(presentation)
                tap(Tab.HOURLY)
                assertNull(presentation)
                ads.destroy()
                ads = controller()
                ads.setEnabled(true)
                pendingLoad!!(creative)
                roll = 0.5
                tap(Tab.DAILY)
                assertNull(presentation)
                assertEquals(Tab.DAILY, nav.selected)

                roll = 0.0
                tap(Tab.HOURLY)
                assertEquals(Tab.DAILY, nav.selected)
                val failed = checkNotNull(presentation)
                failed.onAdFailedToShowFullScreenContent(AdError(1, "fixture", "test"))
                assertEquals(Tab.HOURLY, nav.selected)

                ads.destroy()
                ads = controller()
                ads.setEnabled(true)
                pendingLoad!!(creative)
                tap(Tab.DAILY)
                val shown = checkNotNull(presentation)
                assertNotSame(failed, shown)
                shown.onAdShowedFullScreenContent()
                tap(Tab.DAILY)
                assertSame(shown, presentation)
                assertEquals(Tab.HOURLY, nav.selected)
                val saved = with(ShellNavigation.Saver) { SaverScope { true }.save(nav) }!!
                assertEquals(Tab.DAILY, ShellNavigation.Saver.restore(saved)!!.selected)
                shown.onAdDismissedFullScreenContent()
                assertEquals(Tab.DAILY, nav.selected)
                ads.destroy()

                pendingLoad = null
                ads = controller()
                ads.setEnabled(true)
                assertNull("cap persists across controller recreation", pendingLoad)
                tap(Tab.HOURLY)
                assertSame(shown, presentation)
                assertEquals(Tab.HOURLY, nav.selected)
            } finally {
                ads.destroy()
                activity.deleteSharedPreferences(store)
            }
        }
    }

    /** #3213: the default 30% and a changed `tw_interstitial_chance` decide the draw of the real controller. */
    @Test fun configuredChanceDecidesTheRepeatVisit() {
        rule.waitUntil(10_000) { rule.activity.hasWindowFocus() }
        rule.runOnUiThread {
            val activity = rule.activity
            val store = "test_forecast_interstitial_chance_" + System.nanoTime()
            var pendingLoad: ((ReadyForecastAd) -> Unit)? = null
            var presentation: FullScreenContentCallback? = null
            val request = ForecastAdRequest { loaded, _ -> pendingLoad = loaded }
            val creative = ReadyForecastAd { presentation = it }
            var roll = 0.30
            var chance = RemoteBannerConfig.DEFAULT_INTERSTITIAL_CHANCE
            val ads = ForecastInterstitial(activity, "offline-fixture", { _, _ -> true }, request, { roll }, store) { chance }
            val nav = ShellNavigation(Tab.HOURLY)
            fun tap(tab: Tab) {
                if (!nav.deferForecast(tab, ads::handleTap)) nav.selected = tab
                ads.recordVisible(nav.selected)
            }
            try {
                ads.recordVisible(Tab.HOURLY)
                ads.setEnabled(true)
                pendingLoad!!(creative)
                tap(Tab.DAILY)
                tap(Tab.HOURLY)
                assertNull("a draw at 30% does not show at the default", presentation)
                chance = 0
                roll = 0.0
                tap(Tab.DAILY)
                assertNull("0 never shows", presentation)
                chance = RemoteBannerConfig.DEFAULT_INTERSTITIAL_CHANCE
                roll = 0.2999
                tap(Tab.HOURLY)
                val shown = checkNotNull(presentation)
                shown.onAdShowedFullScreenContent()
                assertEquals(Tab.DAILY, nav.selected)
                shown.onAdDismissedFullScreenContent()
                assertEquals(Tab.HOURLY, nav.selected)
            } finally {
                ads.destroy()
                activity.deleteSharedPreferences(store)
            }
        }
    }
}
