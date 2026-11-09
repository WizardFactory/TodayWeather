package net.wizardfactory.todayweather.core.domain.settings

import net.wizardfactory.todayweather.core.domain.forecast.ForecastFormat

/**
 * A choice of an S08 list: its [label] (a catalog key, or a text the translate filter shows as it is, such as "mph")
 * and the stored [value].
 */
data class Choice(val label: String, val value: String)

/** An S08 list (`radioList`): the setting it changes, the key of its title and its choices. */
data class SettingList(val name: String, val title: String, val choices: List<Choice>) {
    /** A unit (S07 opens it) rather than one of the menu's settings. */
    val unit: Boolean get() = name in SettingLists.UNITS
}

/**
 * The lists and labels of the settings pages, as the Cordova app has them (controller.units.js `Units`, `UnitsCtrl`;
 * controller.settingctrl.js `settingRadio` and the menu's values), for the todayWeather package. Labels are catalog
 * keys or texts that the translate filter shows as they are.
 */
object SettingLists {
    /** The units in the order of S07 (`Units.getAllUnits`). */
    val UNITS = listOf("temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit")

    /** The menu's lists (`settingRadio`). */
    val SETTINGS = listOf("startupPage", "refreshInterval", "theme")

    /** The catalog keys of the settings pages, the menu's values, the feedback mail and About, for the app to load. */
    val KEYS: List<String> by lazy {
        (UNITS.map(::unitName) + UNITS.flatMap { name -> unitChoices(name).map { it.label } } +
            SETTINGS.flatMap { name -> list(name).let { l -> listOf(l.title) + l.choices.map { it.label } } } +
            listOf(startupPageLabel("4"), "LOC_UNITS", "LOC_SEND_FEEDBACK") + About.KEYS).filter { it.startsWith("LOC_") }.distinct()
    }

    /** `getUnitNameStr`: a unit's row on S07 and the title of its list; "" for no unit. */
    fun unitName(name: String): String = when (name) {
        "temperatureUnit" -> "LOC_TEMPERATURE_UNIT"
        "windSpeedUnit" -> "LOC_WIND_SPEED_UNIT"
        "pressureUnit" -> "LOC_PRESSURE_UNIT"
        "distanceUnit" -> "LOC_DISTANCE_UNIT"
        "precipitationUnit" -> "LOC_PRECIPITATION"
        "airUnit" -> "LOC_AIR_QUALITY_INDEX_UNIT"
        else -> ""
    }

    /** `getUnitValueStr`: what S07 shows for a unit's [value]; null (nothing shown) for an air standard without a name. */
    fun unitValue(name: String, value: String): String? = if (name == "airUnit") ForecastFormat.airUnitKey(value) else when (value) {
        "kt" -> "knotes"
        "bft" -> "beaufort"
        "mb" -> "mbar"
        "mi" -> "miles"
        "in" -> "inches"
        else -> value
    }

    /** `Units.getSelectList`: the choices of a unit's list, in the Cordova order. */
    fun unitChoices(name: String): List<Choice> = when (name) {
        "temperatureUnit" -> listOf(Choice("C", "C"), Choice("F", "F"))
        "windSpeedUnit" -> listOf(Choice("mph", "mph"), Choice("km/h", "km/h"), Choice("m/s", "m/s"), Choice("beaufort", "bft"), Choice("knotes", "kt"))
        "pressureUnit" -> listOf(Choice("mmHg", "mmHg"), Choice("inHg", "inHg"), Choice("mbar", "mb"), Choice("hPa", "hPa"))
        "distanceUnit" -> listOf(Choice("km", "km"), Choice("miles", "mi"))
        "precipitationUnit" -> listOf(Choice("mm", "mm"), Choice("inch", "in"))
        "airUnit" -> listOf("airnow", "aqicn", "airkorea", "airkorea_who").map { Choice(ForecastFormat.airUnitKey(it)!!, it) }
        else -> emptyList()
    }

    /** The list S08 shows for [name]: a unit (from S07) or one of the menu's settings. */
    fun list(name: String): SettingList = when (name) {
        "startupPage" -> SettingList(name, "LOC_STARTUP_PAGE", listOf("0", "1", "2", "3").map { Choice(startupPageLabel(it), it) })
        "refreshInterval" -> SettingList(name, "LOC_REFRESH_INTERVAL", listOf("0", "30", "60", "180", "360", "720").map { Choice(refreshIntervalLabel(it), it) })
        "theme" -> SettingList(name, "LOC_THEME_SETTING", listOf("photo", "light", "dark", "old").map { Choice(themeLabel(it), it) })
        else -> SettingList(name, unitName(name), unitChoices(name))
    }

    /** `getStartupPageValueStr`: the menu's value of 시작 페이지; "N/A" for a value without a page. */
    fun startupPageLabel(value: String?): String = when (value) {
        "0" -> "LOC_HOURLY_FORECAST"
        "1" -> "LOC_DAILY_FORECAST"
        "2" -> "LOC_SAVED_LOCATIONS"
        "3" -> "LOC_AIR_INFORMATION"
        "4" -> "LOC_WEATHER"
        else -> "N/A"
    }

    /** `getRefreshIntervalValueStr`: the menu's value of 업데이트 주기. */
    fun refreshIntervalLabel(value: String?): String = when (value) {
        "0" -> "LOC_MANUAL"
        "30" -> "LOC_30_MINUTES"
        "60" -> "LOC_1_HOUR"
        "180" -> "LOC_3_HOURS"
        "360" -> "LOC_6_HOURS"
        "720" -> "LOC_12_HOURS"
        else -> "N/A"
    }

    /** `getThemeValueStr`: the menu's value of 테마 설정. */
    fun themeLabel(value: String?): String = when (value) {
        "photo" -> "LOC_WEATHER_PHOTO_THEME"
        "light" -> "LOC_LIGHT_THEME"
        "dark" -> "LOC_DARK_THEME"
        "old" -> "LOC_OLD_THEME"
        else -> "N/A"
    }
}
