package net.wizardfactory.todayweather.widget

import androidx.compose.ui.graphics.Color
import net.wizardfactory.todayweather.R

enum class WidgetStyle(val label: Int, val background: Color, val ink: Color, val muted: Color, val surface: Color) {
    CLASSIC(R.string.widget_style_classic, Color(0xff191b1e), Color.White, Color(0xffc0c5c8), Color(0xff303337)),
    PAPER(R.string.widget_style_paper, Color(0xfffff9e9), Color(0xff302e2a), Color(0xff605a50), Color(0xfff4de90)),
    BLUE(R.string.widget_style_blue, Color(0xff304861), Color.White, Color(0xffd1dfeb), Color(0xff455c74)),
}
