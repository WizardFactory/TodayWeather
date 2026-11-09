package net.wizardfactory.todayweather.ui.chart

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The expander glyphs the Cordova app takes from the Material Icons font (`expand_less`, `expand_more`), as
 * 24 dp vectors with the same Material Design path data (Apache License 2.0, google/material-design-icons).
 */
internal object ChartIcons {
    val expandLess: ImageVector = icon("expandLess", "M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z")
    val expandMore: ImageVector = icon("expandMore", "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z")

    private fun icon(name: String, path: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        .addPath(PathParser().parsePathString(path).toNodes(), fill = SolidColor(Color.Black))
        .build()
}
