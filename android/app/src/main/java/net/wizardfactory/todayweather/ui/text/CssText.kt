package net.wizardfactory.todayweather.ui.text

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.isSpecified
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The font metrics the WebView lays out `line-height: normal` lines with: Roboto (the first font) and Noto Sans CJK
 * (the fallback for Korean, Chinese and Japanese), their ascent and descent each rounded to device pixels. Measured
 * on the Cordova screens at density 2: 17 px Korean rows are 24.5 dp (39 + 10 px), 15 px ones 22 dp and Latin ones
 * 20 dp and 17.5 dp; Compose's own boxes are up to 1 px taller.
 */
internal object CssMetrics {
    private const val ROBOTO_ASCENT = 1900.0 / 2048
    private const val ROBOTO_DESCENT = 500.0 / 2048
    private const val CJK_ASCENT = 1.16
    private const val CJK_DESCENT = 0.288

    /** A line's ascent and descent in device pixels. */
    data class Line(val ascent: Int, val descent: Int)

    fun robotoDescent(sizePx: Float): Int = (sizePx * ROBOTO_DESCENT).roundToInt()

    /** The height in dp of a line of [text] in [style] (strut: its own font). */
    fun heightDp(text: String, style: TextStyle, density: Density): Double =
        line(AnnotatedString(text), style, style, density).let { (it.ascent + it.descent) / density.density.toDouble() }

    /**
     * The line of [text] in [style], its spans' sizes and fonts included, with the block's [strut]. With [borrow] a
     * descent that rounds down takes a pixel from the font's ascent, as Chrome's `FontMetrics::AscentDescentWithHacks`
     * does with subpixel positioning: measured on S05's gauge, whose 15 px Latin lines have their baseline 13.5 dp under
     * the top (27 + 8 px). The weather pages' rows keep the plain rounding they were measured with.
     */
    fun line(text: AnnotatedString, style: TextStyle, strut: TextStyle, density: Density, borrow: Boolean = false): Line {
        var ascent = 0
        var descent = 0
        fun font(sizePx: Float, ascentRatio: Double, descentRatio: Double) {
            val exact = sizePx * descentRatio
            var a = (sizePx * ascentRatio).roundToInt()
            var d = exact.roundToInt()
            if (borrow && d < exact && a >= 1) {
                a--
                d++
            }
            ascent = max(ascent, a)
            descent = max(descent, d)
        }
        fun add(sizePx: Float, cjk: Boolean) {
            font(sizePx, ROBOTO_ASCENT, ROBOTO_DESCENT)
            if (cjk) font(sizePx, CJK_ASCENT, CJK_DESCENT)
        }
        with(density) {
            add(strut.fontSize.toPx(), false)
            // Each span's own size; icon fonts sit on the line without making it taller.
            val bounds = (listOf(0, text.length) + text.spanStyles.flatMap { listOf(it.start, it.end) }).distinct().sorted()
            for ((start, end) in bounds.zipWithNext()) {
                if (start >= end) continue
                val spans = text.spanStyles.filter { it.start <= start && it.end >= end }.map { it.item }
                val family = spans.lastOrNull { it.fontFamily != null }?.fontFamily ?: style.fontFamily
                if (family != null && family != FontFamily.Default && family !is androidx.compose.ui.text.font.GenericFontFamily) continue
                val size = spans.lastOrNull { it.fontSize.isSpecified }?.fontSize ?: style.fontSize
                add(size.toPx(), cjk(text.substring(start, end)))
            }
        }
        return Line(ascent, descent)
    }

    /** Whether [text] needs the CJK fallback font: Hangul, CJK ideographs and symbols, kana, full-width forms. */
    fun cjk(text: CharSequence): Boolean = text.any {
        val c = it.code
        c in 0x1100..0x11FF || c in 0x2E80..0x303F || c in 0x3040..0x33FF || c in 0x3400..0x9FFF || c in 0xA960..0xA97F ||
            c in 0xAC00..0xD7FF || c in 0xF900..0xFAFF || c in 0xFE30..0xFE4F || c in 0xFF00..0xFFEF
    }
}

/**
 * A line of `line-height: normal` as the WebView lays it out: the ascent and descent of the fonts its text uses and
 * of the [strut] (the block's font), on one baseline, each rounded to device pixels (CssMetrics). A Korean run adds
 * the fallback font's taller box; a smaller run in a bigger block (13 sp sub-text in a 15 sp cell) gets the block's
 * line. Compose rounds its own line boxes differently, so the text is placed on this baseline.
 */
@Composable
internal fun CssText(
    text: AnnotatedString, style: TextStyle, modifier: Modifier = Modifier, strut: TextStyle = style, maxLines: Int = Int.MAX_VALUE,
    align: TextAlign? = null, borrow: Boolean = false, overflow: TextOverflow = TextOverflow.Clip,
) {
    val density = LocalDensity.current
    val box = remember(text, style, strut, density, borrow) { CssMetrics.line(text, style, strut, density, borrow) }
    Text(text, modifier.layout { measurable, constraints ->
        // The text keeps its own height, which may exceed the CSS line it reports (a row sized to its CSS lines).
        val placeable = measurable.measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
        val first = placeable[FirstBaseline]
        val last = placeable[LastBaseline]
        layout(placeable.width, box.ascent + (last - first) + box.descent) { placeable.place(0, box.ascent - first) }
    }, style = if (align != null) style.copy(textAlign = align) else style, maxLines = maxLines, softWrap = maxLines != 1, overflow = overflow)
}
