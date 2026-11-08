package net.wizardfactory.todayweather.ui.chart

import android.content.Context
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts

/** The `LOC_*` strings the charts show, from the imported Cordova catalogs (client_strings.xml). */
fun chartTexts(context: Context): ChartTexts = ChartTexts(KEYS.mapNotNull { key ->
    val id = context.resources.getIdentifier(key, "string", context.packageName)
    if (id == 0) null else key to context.getString(id)
}.toMap())

private val KEYS = listOf(
    "LOC_HOUR", "LOC_THIS_DAY_TEMP", "LOC_PREVIOUS_DAY_TEMP",
    "LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
    "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY",
    "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT",
)
