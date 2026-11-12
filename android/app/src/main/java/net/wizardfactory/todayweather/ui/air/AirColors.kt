package net.wizardfactory.todayweather.ui.air

import androidx.compose.ui.graphics.Color
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.forecast.ForecastColors

/**
 * Colors of S05 in a theme (client/scss/ionic.app.scss: `.air` L269-L661, `.dark-theme.air` L673-L780). Only the dark
 * theme has its own; the photo and old themes have no S05 rules, so their page is the light one. [page] holds the
 * page, card, header and link colors S05 shares with the weather pages; the others are the box title's border and
 * text, the detail and station cells' border and selected background, and the hourly chart's axis, labels, bar
 * without a grade and the other hours' opacity (`.chart-blurry-bar`).
 */
internal data class AirColors(
    val page: ForecastColors,
    val titleBorder: Color,
    val titleText: Color,
    val cellBorder: Color,
    val selected: Color,
    val axis: Color,
    val axisText: Color,
    val bar: Color,
    val blurry: Float,
) {
    companion object {
        private val LIGHT = AirColors(
            page = ForecastColors.of(Theme.LIGHT, daily = false), titleBorder = Color.Black, titleText = Color.Black,
            cellBorder = Color(0xFFCCCCCC), selected = Color(0xFFF4F4F4), axis = Color(0xFF666666), axisText = Color(0xFF444444),
            bar = Color(0xFF387EF5), blurry = 0.6f,
        )

        private val DARK = AirColors(
            page = ForecastColors.of(Theme.DARK, daily = false), titleBorder = Color.White, titleText = Color.White,
            cellBorder = Color(0xFF8F8F8F), selected = Color(0xFF3B3B3B), axis = Color(0xFFDDDDDD), axisText = Color(0xFFDDDDDD),
            bar = Color(0xFFDDDDDD), blurry = 0.8f,
        )

        fun of(theme: Theme): AirColors = if (theme == Theme.DARK) DARK else LIGHT
    }
}
