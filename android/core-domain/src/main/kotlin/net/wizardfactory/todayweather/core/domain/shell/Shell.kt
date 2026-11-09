package net.wizardfactory.todayweather.core.domain.shell

/** Themes of the Cordova app (`settingsInfo.theme`) with their image folders (client/www/data/theme.js). */
enum class Theme(val key: String, val icons: String, val weather: String) {
    PHOTO("photo", "img/icons_default", "img/weather_default"),
    LIGHT("light", "img/icons_default", "img/weather_default"),
    DARK("dark", "img/icons_dark", "img/weather_default"),
    OLD("old", "img/icons_old", "img/weather_old");

    companion object {
        /** Unknown values: light, the Cordova default (service.storage.js). */
        fun of(key: String?): Theme = entries.firstOrNull { it.key == key } ?: LIGHT
    }
}

/** The bottom tabs in Cordova order (client/www/templates/tabs-android.html). */
enum class Tab(val state: String) { LOCATIONS("search"), HOURLY("forecast"), DAILY("dailyforecast"), AIR("air") }

/** `settingsInfo.startupPage` to the first tab (app.js L369-L390): "0" hourly, "1" daily, "2" locations, "3" air. */
object StartupPage {
    fun tab(value: String?): Tab = when (value) {
        "1" -> Tab.DAILY
        "2" -> Tab.LOCATIONS
        "3" -> Tab.AIR
        else -> Tab.HOURLY
    }
}
