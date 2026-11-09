package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import net.wizardfactory.todayweather.core.domain.air.AirPage
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.settings.SettingLists

/**
 * The `LOC_*` strings the weather pages, their charts, S05, the settings pages and the menu's values and popup show,
 * from the imported Cordova catalogs (client_strings.xml).
 */
fun forecastTexts(context: Context): ChartTexts = ChartTexts((ForecastPage.KEYS + AirPage.KEYS + SettingLists.KEYS).distinct().mapNotNull { key ->
    val id = context.resources.getIdentifier(key, "string", context.packageName)
    if (id == 0) null else key to context.getString(id)
}.toMap())
