package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import net.wizardfactory.todayweather.core.domain.air.AirPage
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.nation.NationPages
import net.wizardfactory.todayweather.core.domain.settings.SettingLists

/**
 * The `LOC_*` strings from the imported Cordova catalogs (client_strings.xml) that these screens show:
 * - the weather pages and their charts, and S05;
 * - the settings pages, and the menu's values and popup;
 * - the nationwide and warning pages.
 */
fun forecastTexts(context: Context): ChartTexts = ChartTexts((ForecastPage.KEYS + AirPage.KEYS + SettingLists.KEYS + NationPages.KEYS).distinct().mapNotNull { key ->
    val id = context.resources.getIdentifier(key, "string", context.packageName)
    if (id == 0) null else key to context.getString(id)
}.toMap())
