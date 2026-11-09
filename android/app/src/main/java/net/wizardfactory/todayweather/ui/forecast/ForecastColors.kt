package net.wizardfactory.todayweather.ui.forecast

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.chart.ChartColors

/**
 * Colors of the weather pages S03 and S04 in a theme (client/scss/ionic.app.scss: `.forecast .main-content` L269-L671,
 * photo L663-L671, dark L673-L780, old Hourly L782-L885 and Daily L887-L990). In the old theme the detail and AQI
 * tables' glyphs and texts are white (`color: #fff !important`), over the grade colors: [forced].
 */
data class ForecastColors(
    val page: Color,
    val text: Color,
    val header: Color,
    val headerText: Color,
    val headerOutline: Color?,
    val headerBottom: Dp,
    val card: Color,
    val cardTitle: Color,
    val subText: Color,
    val link: Color,
    val attributionLink: Color,
    val divider: Color,
    val forced: Color?,
    val chart: ChartColors,
) {
    companion object {
        private val LIGHT = ForecastColors(
            page = Color(0xFFF5F5F5), text = Color.Black, header = Color.White, headerText = Color(0xFF444444), headerOutline = null,
            headerBottom = 5.dp, card = Color.White, cardTitle = Color(0xFF666666), subText = Color(0xFF666666), link = Color(0xFF015DC1),
            attributionLink = Color(0xFF387EF5), divider = Color(0xFF666666), forced = null, chart = ChartColors.LIGHT,
        )

        fun of(theme: Theme, daily: Boolean): ForecastColors = when (theme) {
            Theme.LIGHT -> LIGHT
            // The header's text is white with a gray outline over the photo; the cards stay light.
            Theme.PHOTO -> LIGHT.copy(headerText = Color.White, headerOutline = Color(0xFF8F8F8F), headerBottom = 22.dp)
            Theme.DARK -> LIGHT.copy(
                page = Color(0xFF171717), text = Color(0xFFDDDDDD), header = Color(0xFF1C1C1D), headerText = Color(0xFFDDDDDD),
                card = Color(0xFF1C1C1D), cardTitle = Color(0xFFDDDDDD), subText = Color(0xFFDDDDDD), link = Color(0xFFDDDDDD),
                divider = Color(0xFFDDDDDD), chart = ChartColors.of(theme, daily),
            )
            Theme.OLD -> {
                val base = if (daily) Color(0xFF00BCD4) else Color(0xFF03A9F4)
                LIGHT.copy(
                    page = base, text = Color.White, header = base, headerText = Color.White, card = base, cardTitle = Color.White,
                    subText = Color.White, link = Color.White, divider = Color.White, forced = Color.White, chart = ChartColors.of(theme, daily),
                )
            }
        }
    }
}
