package net.wizardfactory.todayweather.ui.chart

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.core.domain.shell.Theme

/**
 * Chart text sizes of the Cordova app (client/scss/ionic.app.scss `.chart-scroll`, `.chart-label`), as the WebView
 * computes them.
 */
internal object ChartStyle {
    val chartText: TextUnit = 15.sp
    val subText: TextUnit = 13.sp
    val unitText: TextUnit = 10.sp
    val dayTitle: TextUnit = 15.sp
    val title: TextUnit = 17.sp
    val smallTitle: TextUnit = 15.sp
    val legend: TextUnit = 13.sp

    /** Fill and font size of an SVG text class; null for classes the charts do not draw. */
    fun svgText(cls: String, colors: ChartColors): Pair<Color, TextUnit>? = when (cls) {
        "chart-text" -> colors.text to chartText
        "chart-sub-text" -> colors.text to subText
        "text-today-current" -> colors.valueTextCurrent to chartText
        "text-today", "text-yesterday", "text-yesterday-current" -> colors.valueText to chartText
        else -> null
    }
}

/**
 * Chart colors of a theme and page (client/scss/ionic.app.scss: `.chart-scroll`, `.chart-label`, `.chart-separator`
 * and `.chart-expander` L465-L614; dark L673-L780; old Hourly L782-L885 and Daily L887-L990). [label] is the page's
 * text color, which the HTML header rows take; [currentRect] null is transparent.
 */
data class ChartColors(
    val label: Color,
    val text: Color,
    val bar: Color,
    val guide: Color,
    val guideVivid: Color,
    val currentRect: Color?,
    val lineToday: Color,
    val lineYesterday: Color,
    val circleToday: Color,
    val circleYesterday: Color,
    val circleTodayCurrent: Color,
    val circleTodayCurrentStroke: Color,
    val valueText: Color,
    val valueTextCurrent: Color,
    val legendBox: Color,
    val legendToday: Color,
    val legendYesterday: Color,
    val separator: Color,
    val expander: Color,
    val background: Color,
    val weatherImages: String = Theme.LIGHT.weather,
    val iconImages: String = Theme.LIGHT.icons,
) {
    companion object {
        val LIGHT = ChartColors(
            label = Color(0xFF000000), text = Color(0xFF444444), bar = Color(0xFF387EF5),
            guide = Color(0xFFD9E5F2), guideVivid = Color(0xFFC0D6F0), currentRect = null,
            lineToday = Color(0xFF387EF5), lineYesterday = Color(0xFF9E9E9E),
            circleToday = Color(0xFF387EF5), circleYesterday = Color(0xFF9E9E9E),
            circleTodayCurrent = Color(0xFFFF5252), circleTodayCurrentStroke = Color(0xFFFF5252),
            valueText = Color(0xFFFFFFFF), valueTextCurrent = Color(0xFFFFFFFF),
            legendBox = Color(0x1A000000), legendToday = Color(0xFF387EF5), legendYesterday = Color(0xFF9E9E9E),
            separator = Color(0xFFD9E5F2), expander = Color(0xFF444444), background = Color(0xFFFFFFFF),
        )

        private val DARK = LIGHT.copy(
            iconImages = Theme.DARK.icons,
            label = Color(0xFFDDDDDD), text = Color(0xFFDDDDDD), bar = Color(0xFFDDDDDD),
            guide = Color(0xFFDDDDDD), guideVivid = Color(0xFFDDDDDD),
            lineToday = Color(0xFFFFFFFF), circleToday = Color(0xFFFFFFFF), circleTodayCurrentStroke = Color(0xFFFFFFFF),
            valueText = Color(0xFF0C60EE), valueTextCurrent = Color(0xFFFEFEFE),
            legendBox = Color(0x66000000), legendToday = Color(0xFFFFFFFF),
            separator = Color(0xFFDDDDDD), expander = Color(0xFFDDDDDD), background = Color(0xFF1C1C1D),
        )

        private val OLD = LIGHT.copy(
            weatherImages = Theme.OLD.weather, iconImages = Theme.OLD.icons,
            label = Color.White, text = Color.White, bar = Color.White, guide = Color.White, guideVivid = Color.White,
            lineToday = Color.White, lineYesterday = Color(0xFFD0D0D0), circleToday = Color.White, circleYesterday = Color(0xFFD0D0D0),
            circleTodayCurrentStroke = Color.White, valueTextCurrent = Color(0xFFFEFEFE),
            legendBox = Color(0x66000000), legendToday = Color.White, legendYesterday = Color(0xFFD0D0D0),
            separator = Color.White, expander = Color.White,
        )

        /** The colors of [theme] on Hourly or, when [daily], Daily (the photo theme's cards are light). */
        fun of(theme: Theme, daily: Boolean): ChartColors = when (theme) {
            Theme.LIGHT, Theme.PHOTO -> LIGHT
            Theme.DARK -> DARK
            Theme.OLD -> if (daily) {
                OLD.copy(currentRect = Color(0xFF00ACC1), valueText = Color(0xFF0288D1), background = Color(0xFF00BCD4))
            } else {
                OLD.copy(currentRect = Color(0xFF039BE5), valueText = Color(0xFF0C60EE), background = Color(0xFF03A9F4))
            }
        }
    }
}
