package net.wizardfactory.todayweather.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until

/** The app under test (the target project's application ID). */
internal const val PACKAGE = "net.wizardfactory.todayweather"

/** The tabs in the order a reader moves through them, by their Shell tags (`shell-tab-<state>`, exposed as resource IDs). */
internal val TABS = listOf("dailyforecast", "air", "search", "forecast")

private fun tab(state: String) = By.res("shell-tab-$state")

/**
 * Starts the app on its forecast. A new install shows the access notice (O01) over the start page (S01): close it and add
 * the first city shortcut, so the tabs open with one saved place and production weather.
 */
internal fun MacrobenchmarkScope.startOnForecast() {
    pressHome()
    startActivityAndWait()
    if (!device.wait(Until.hasObject(tab("forecast")), 5_000)) {
        device.findObject(By.res("ionic-popup-button"))?.click()
        val chip = device.wait(Until.findObject(By.res("start-chip-0")), 15_000) ?: error("neither the tabs nor the start page appeared")
        chip.click()
        check(device.wait(Until.hasObject(tab("forecast")), 30_000)) { "the forecast did not open after adding a city" }
    }
    dismissOverlays()
    device.waitForIdle()
}

/** Visits every tab [rounds] times, waiting for each to settle; a full-screen ad over a tab is closed with Back. */
internal fun MacrobenchmarkScope.visitTabs(rounds: Int = 2) {
    repeat(rounds) {
        for (state in TABS) {
            device.findObject(tab(state))?.click() ?: run {
                dismissOverlays()
                device.findObject(tab(state))?.click() ?: error("tab $state not found")
            }
            device.waitForIdle()
            Thread.sleep(700)
            dismissOverlays()
        }
    }
}

/** Closes what covers the tabs: an ionic popup (first OK button) or an interstitial (Back). */
private fun MacrobenchmarkScope.dismissOverlays() {
    repeat(3) {
        if (device.hasObject(tab("forecast"))) return
        device.findObject(By.res("ionic-popup-button"))?.click() ?: device.pressBack()
        device.waitForIdle()
    }
}
