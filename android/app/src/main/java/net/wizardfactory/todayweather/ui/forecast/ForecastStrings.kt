package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage

/** The `LOC_*` strings the weather pages and their charts show, from the imported Cordova catalogs (client_strings.xml). */
fun forecastTexts(context: Context): ChartTexts = ChartTexts(ForecastPage.KEYS.mapNotNull { key ->
    val id = context.resources.getIdentifier(key, "string", context.packageName)
    if (id == 0) null else key to context.getString(id)
}.toMap())
