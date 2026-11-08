package net.wizardfactory.todayweather.ui.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import net.wizardfactory.todayweather.R

/** Icon fonts of the Cordova app: Ionicons 2.0.1 and Material Icons (res/font, with provenance). */
object Glyphs {
    val ionicons = FontFamily(Font(R.font.ionicons))
    val materialIcons = FontFamily(Font(R.font.material_icons))

    // Ionicons code points (ionic.css `.ion-*:before { content }`).
    const val STAR_OUTLINE = ""
    const val STAR = ""
    const val TIME = ""
    const val REFRESH = ""
    const val CALENDAR = ""
    const val CLOUD_OUTLINE = ""
    const val NAVICON = ""
    const val ARROW_BACK = ""
    const val NOTIFICATIONS = ""
    const val NOTIFICATIONS_NONE = ""
    const val SHARE = ""
    const val CHEVRON_RIGHT = ""
}

/** A glyph of [family] centered in a [box] square, as Ionic sizes icon fonts (`font-size`, centered line box). */
@Composable
fun Glyph(glyph: String, size: TextUnit, color: Color, box: Dp, modifier: Modifier = Modifier, family: FontFamily = Glyphs.ionicons) {
    Box(modifier.size(box), contentAlignment = Alignment.Center) {
        Text(glyph, style = TextStyle(fontFamily = family, fontSize = size, color = color, platformStyle = PlatformTextStyle(includeFontPadding = false)))
    }
}
