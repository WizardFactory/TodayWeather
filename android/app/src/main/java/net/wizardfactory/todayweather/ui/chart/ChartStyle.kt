package net.wizardfactory.todayweather.ui.chart

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Light-theme chart styles of the Cordova app (client/scss/ionic.app.scss `.chart-scroll`, `.chart-label`,
 * `.chart-separator`, `.chart-expander`), as the WebView computes them.
 */
internal object ChartStyle {
    val text = Color(0xFF444444)
    val label = Color(0xFF000000)
    val today = Color(0xFF387EF5)
    val yesterday = Color(0xFF9E9E9E)
    val current = Color(0xFFFF5252)
    val valueText = Color(0xFFFFFFFF)
    val guide = Color(0xFFD9E5F2)
    val guideVivid = Color(0xFFC0D6F0)
    val legendBox = Color(0x1A000000)
    val background = Color(0xFFFFFFFF)

    val chartText: TextUnit = 15.sp
    val subText: TextUnit = 13.sp
    val unitText: TextUnit = 10.sp
    val dayTitle: TextUnit = 15.sp
    val title: TextUnit = 17.sp
    val smallTitle: TextUnit = 15.sp
    val legend: TextUnit = 13.sp

    /** Fill, font size and anchor of an SVG text class; null for classes the charts do not draw. */
    fun svgText(cls: String): Pair<Color, TextUnit>? = when (cls) {
        "chart-text" -> text to chartText
        "chart-sub-text" -> text to subText
        "text-today", "text-today-current", "text-yesterday", "text-yesterday-current" -> valueText to chartText
        else -> null
    }
}
