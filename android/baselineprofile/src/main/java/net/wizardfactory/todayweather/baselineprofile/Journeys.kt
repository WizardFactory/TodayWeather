package net.wizardfactory.todayweather.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until

/** The app under test (the target project's application ID). */
internal const val PACKAGE = "net.wizardfactory.todayweather"

/** The tabs in the order a reader moves through them, by their Shell states (`shell-tab-<state>`, `shell-page-<state>`). */
internal val TABS = listOf("dailyforecast", "air", "search", "forecast")

private fun tab(state: String) = By.res("shell-tab-$state")

/** The page of the selected tab; Shell tags only the selected one. */
private fun page(state: String) = By.res("shell-page-$state")

private val POPUP_BUTTON = By.res("ionic-popup-button")

/** O03: the weather of the place could not be loaded. The journeys need real content, so it fails the run. */
private val WEATHER_RETRY = By.res("weather-retry-dialog")

/**
 * What shows once a tab has its content: the hourly chart (drawn only with forecast data), the air gauge (only with air
 * data), the saved places list. Daily uses the forecast Hourly already loaded.
 */
private val CONTENT = mapOf(
    "forecast" to By.res("chart-expander"),
    "dailyforecast" to By.res("forecast-page"),
    "air" to By.res("air-gauge"),
    "search" to By.res("places-list"),
)

/**
 * Starts the app on Hourly. A new install shows the access notice (O01) over the start page (S01): close it and add the
 * first city shortcut, so the tabs open with one saved place and production weather. A saved start tab other than Hourly
 * is left for Hourly, so the first tab visit is a switch.
 */
internal fun MacrobenchmarkScope.startOnForecast() {
    pressHome()
    startActivityAndWait()
    if (!device.wait(Until.hasObject(tab("forecast")), 5_000)) {
        device.findObject(POPUP_BUTTON)?.click()
        val chip = device.wait(Until.findObject(By.res("start-chip-0")), 15_000) ?: error("neither the tabs nor the start page appeared")
        chip.click()
        check(device.wait(Until.hasObject(tab("forecast")), 30_000)) { "the forecast did not open after adding a city" }
    }
    openTab("forecast")
}

/** Visits every tab [rounds] times; each visit must show that tab's page. */
internal fun MacrobenchmarkScope.visitTabs(rounds: Int = 2) {
    repeat(rounds) { TABS.forEach { openTab(it) } }
}

/** Taps a tab and waits until its page is the selected one and shows its content. */
private fun MacrobenchmarkScope.openTab(state: String) {
    closeOverlays()
    if (!device.hasObject(page(state))) {
        (device.findObject(tab(state)) ?: error("tab $state not found")).click()
        check(device.wait(Until.hasObject(page(state)), 10_000)) { "the $state page did not open" }
    }
    check(device.wait(Until.hasObject(CONTENT.getValue(state)), 30_000)) {
        if (device.hasObject(WEATHER_RETRY)) "the weather did not load" else "the $state page shows no content"
    }
    device.waitForIdle()
    Thread.sleep(700)
    closeOverlays()
}

/**
 * Closes what covers the tabs. An Ionic popup is drawn inside the activity, so the tabs stay in the hierarchy behind it:
 * its first button is tapped whenever one shows, except the weather retry dialog, which fails the run. Another activity
 * over the app (an interstitial) hides the tabs: Back.
 */
private fun MacrobenchmarkScope.closeOverlays() {
    check(!device.hasObject(WEATHER_RETRY)) { "the weather did not load" }
    repeat(5) {
        val button = device.findObject(POPUP_BUTTON)
        when {
            button != null -> button.click()
            !device.hasObject(tab("forecast")) -> device.pressBack()
            else -> return
        }
        device.waitForIdle()
    }
    error("an overlay did not close")
}
