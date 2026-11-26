package net.wizardfactory.todayweather.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The app's baseline profile (#3224). `./gradlew :app:generateBaselineProfile` runs both journeys on the connected device
 * and writes the rules into the app's sources: [startup] also feeds the startup profile (DEX layout), [tabs] only the
 * baseline profile.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule val rule = BaselineProfileRule()

    /** Cold start onto the forecast. */
    @Test
    fun startup() = rule.collect(packageName = PACKAGE, includeInStartupProfile = true) {
        startOnForecast()
    }

    /** Visits to Daily, Air, Locations and Hourly. */
    @Test
    fun tabs() = rule.collect(packageName = PACKAGE, includeInStartupProfile = false) {
        startOnForecast()
        visitTabs(rounds = 2)
    }
}
