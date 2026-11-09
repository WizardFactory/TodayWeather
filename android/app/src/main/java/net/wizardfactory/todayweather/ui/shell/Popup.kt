package net.wizardfactory.todayweather.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.getTextLayoutResult
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.ui.text.CssMetrics
import net.wizardfactory.todayweather.ui.text.chromeLines
import net.wizardfactory.todayweather.ui.text.chromeRuns

object PopupTags {
    const val POPUP = "ionic-popup"
    const val BODY = "ionic-popup-body"
    const val BUTTON = "ionic-popup-button"
}

/** A button of an Ionic popup: `button-positive` (blue, white text) or `button-default` (light gray, dark text). */
class PopupButton(val text: String, val positive: Boolean = false, val onTap: () -> Unit)

/**
 * An Ionic alert (`$ionicPopup.alert`, the About popup O10 and the alerts of `showAlert`): an [IonicPopup] with the
 * [lines] (each on its own line as `<br>` puts them) and one `button-positive` [button]. The button and Android back
 * close it ([onClose]).
 */
@Composable
fun IonicAlert(title: String, lines: List<String>, button: String, onClose: () -> Unit, modifier: Modifier = Modifier) =
    IonicPopup(title, lines, listOf(PopupButton(button, positive = true, onTap = onClose)), onBack = onClose, modifier = modifier)

/**
 * An Ionic popup (`$ionicPopup.show`): over the page the backdrop darkens (40 % black), a 250 dp popup in its middle,
 * white at 90 %: the [title] (15 sp, medium, centered) over a 1 dp line, the [lines] (14 sp) and the [buttons] side by
 * side (`.popup-buttons`: flex, 5 dp apart, 45 dp, bold 15 sp, at 0.87 opacity as the app's buttons are). Text breaks
 * as Chrome breaks it. Android back runs [onBack]; taps elsewhere do nothing. It covers the area between the system
 * bars, as the WebView did.
 */
@Composable
fun IonicPopup(title: String, lines: List<String>, buttons: List<PopupButton>, onBack: () -> Unit, modifier: Modifier = Modifier) {
    BackHandler(onBack = onBack)
    Box(modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).background(Color(0x66000000)).pointerInput(Unit) {},
        contentAlignment = Alignment.Center) {
        Column(Modifier.width(250.dp).background(Color(0xE6FFFFFF)).testTag(PopupTags.POPUP)) {
            // .popup-head: the title on an 18 dp line with 15 dp above and below and 10 dp at the sides, a 1 dp line under it.
            FixedLine(18.dp, Modifier.fillMaxWidth().padding(horizontal = 10.dp).padding(top = 15.dp)) {
                LineText(title, line(15.sp, TextUnit.Unspecified, Color.Black, FontWeight.Medium).copy(textMotion = TextMotion.Animated))
            }
            Box(Modifier.fillMaxWidth().padding(top = 15.dp).height(1.dp).background(Color(0xFFEEEEEE)))
            // .popup-body: 10 dp around the text, on lines of `line-height: normal` as the WebView spaces them, broken
            // where Chrome breaks them in its 230 dp.
            val style = popupBodyStyle()
            val density = LocalDensity.current
            val measurer = rememberTextMeasurer()
            val text = remember(lines, density) { popupLines(measurer, lines, density).joinToString("\n") }
            val normal = remember(text, density) {
                CssMetrics.line(AnnotatedString(text), style, style, density).let { (it.ascent + it.descent) / density.density / density.fontScale }
            }
            Box(Modifier.fillMaxWidth().testTag(PopupTags.BODY)) {
                // Screen readers get the text without the line breaks; the layout stays the drawn one.
                var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
                Text(chromeRuns(text), Modifier.fillMaxWidth().padding(10.dp).clearAndSetSemantics {
                    this.text = AnnotatedString(lines.joinToString("\n"))
                    getTextLayoutResult { results -> layout?.let { results.add(it) } != null }
                }, style = line(14.sp, normal.sp, Color.Black).copy(textMotion = TextMotion.Animated), onTextLayout = { layout = it })
            }
            // .popup-buttons: 10 dp around the buttons, whose 20 dp lines sit in their middle (a `<button>` centers its content).
            Row(Modifier.fillMaxWidth().padding(10.dp)) {
                buttons.forEachIndexed { i, b ->
                    if (i > 0) Spacer(Modifier.width(5.dp))
                    Box(Modifier.weight(1f).height(45.dp).alpha(0.87f).clip(RoundedCornerShape(2.dp))
                        .background(if (b.positive) Color(0xFF387EF5) else Color(0xFFF8F8F8))
                        .border(1.dp, Color.Transparent, RoundedCornerShape(2.dp)).clickable(onClick = b.onTap).testTag(PopupTags.BUTTON),
                        contentAlignment = Alignment.Center) {
                        FixedLine(20.dp) { LineText(b.text, line(15.sp, TextUnit.Unspecified, if (b.positive) Color.White else Color(0xFF444444), FontWeight.Bold)) }
                    }
                }
            }
        }
    }
}

/** The popup body's text: 14 sp, black. */
internal fun popupBodyStyle() = line(14.sp, TextUnit.Unspecified, Color.Black).copy(textMotion = TextMotion.Animated)

/** The body's [lines] broken where Chrome breaks them in its 230 dp. */
internal fun popupLines(measurer: TextMeasurer, lines: List<String>, density: Density): List<String> {
    val width = with(density) { 230.dp.roundToPx() }
    return lines.flatMap { if (it.isEmpty()) listOf(it) else chromeLines(measurer, it, popupBodyStyle(), width) }
}
