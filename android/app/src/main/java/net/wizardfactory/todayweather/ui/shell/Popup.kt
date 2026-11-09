package net.wizardfactory.todayweather.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.ui.text.CssMetrics

object PopupTags {
    const val POPUP = "ionic-popup"
    const val BUTTON = "ionic-popup-button"
}

/**
 * An Ionic alert (`$ionicPopup.alert`, the About popup O10): over the page the backdrop darkens (40 % black), a 250 dp
 * popup in its middle, white at 90 %: the [title] (15 sp, medium, centered) over a 1 dp line, the [lines] (14 sp, each
 * on its own line as `<br>` puts them) and the [button] (`button-positive`, 45 dp, bold 15 sp). The button and Android
 * back close it ([onClose]); taps elsewhere do nothing. It covers the area between the system bars, as the WebView did.
 */
@Composable
fun IonicAlert(title: String, lines: List<String>, button: String, onClose: () -> Unit, modifier: Modifier = Modifier) {
    BackHandler(onBack = onClose)
    Box(modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).background(Color(0x66000000)).pointerInput(Unit) {},
        contentAlignment = Alignment.Center) {
        Column(Modifier.width(250.dp).background(Color(0xE6FFFFFF)).testTag(PopupTags.POPUP)) {
            // .popup-head: the title on an 18 dp line with 15 dp above and below and 10 dp at the sides, a 1 dp line under it.
            FixedLine(18.dp, Modifier.fillMaxWidth().padding(horizontal = 10.dp).padding(top = 15.dp)) {
                LineText(title, line(15.sp, TextUnit.Unspecified, Color.Black, FontWeight.Medium).copy(textMotion = TextMotion.Animated))
            }
            Box(Modifier.fillMaxWidth().padding(top = 15.dp).height(1.dp).background(Color(0xFFEEEEEE)))
            // .popup-body: 10 dp around the text, on lines of `line-height: normal` as the WebView spaces them.
            val text = lines.joinToString("\n")
            val style = line(14.sp, TextUnit.Unspecified, Color.Black).copy(textMotion = TextMotion.Animated)
            val density = LocalDensity.current
            val normal = remember(text, density) {
                CssMetrics.line(AnnotatedString(text), style, style, density).let { (it.ascent + it.descent) / density.density / density.fontScale }
            }
            Text(text, Modifier.fillMaxWidth().padding(10.dp), style = line(14.sp, normal.sp, Color.Black).copy(textMotion = TextMotion.Animated))
            // .popup-buttons: 10 dp around the button, whose 20 dp line sits in its middle (a `<button>` centers its content).
            Box(Modifier.fillMaxWidth().padding(10.dp)) {
                Box(Modifier.fillMaxWidth().height(45.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFF387EF5))
                    .border(1.dp, Color.Transparent, RoundedCornerShape(2.dp)).clickable(onClick = onClose).testTag(PopupTags.BUTTON),
                    contentAlignment = Alignment.Center) {
                    FixedLine(20.dp) { LineText(button, line(15.sp, TextUnit.Unspecified, Color.White, FontWeight.Bold)) }
                }
            }
        }
    }
}
