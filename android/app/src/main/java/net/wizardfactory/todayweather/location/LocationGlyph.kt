package net.wizardfactory.todayweather.location

import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.provider.Settings
import androidx.core.location.LocationManagerCompat

/**
 * The location glyph in the header of the current position's weather pages (tab-forecast.html; ForecastCtrl's
 * `isLocationEnabled()` and `switchToLocationSettings()`): [enabled] picks `location_on` or `location_off`. A [tap] with
 * location off opens the device's location settings and calls [reloadOnReturn], so the place loads again when the app
 * comes back; with location on it does nothing. S05 shows the glyph without the tap (A10, kept).
 */
class LocationGlyph(private val context: Context, private val reloadOnReturn: () -> Unit) {
    /** The device's location service. */
    fun enabled(): Boolean = LocationManagerCompat.isLocationEnabled(context.getSystemService(LocationManager::class.java))

    fun tap() {
        if (enabled()) return
        runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
        reloadOnReturn()
    }
}
