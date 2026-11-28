package net.wizardfactory.todayweather.ui.shell

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.Layout
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import kotlin.math.ceil
import kotlin.math.roundToInt

internal val LocalLineMeasurer = staticCompositionLocalOf<TextMeasurer?> { null }

@Composable
internal fun referenceLine(text: AnnotatedString, style: TextStyle): TextLayoutResult {
    // Use the caller's density, including Icon's fixed font scale, and font resolver as layout cache keys.
    val measurer = LocalLineMeasurer.current ?: rememberTextMeasurer()
    return measurer.measure(text, style, density = LocalDensity.current,
        layoutDirection = LocalLayoutDirection.current, fontFamilyResolver = LocalFontFamilyResolver.current)
}

@Composable
internal fun ShellLine(text: AnnotatedString, style: TextStyle, modifier: Modifier,
                       baselineOf: TextStyle, maxLines: Int, outline: Color?) {
    val anchored = if (baselineOf.fontFamily != null && baselineOf == style && maxLines == 1) modifier else {
        val reference = if (baselineOf.fontFamily == null) AnnotatedString("x") else text
        val line = referenceLine(reference, baselineOf)
        modifier.layout { measurable, constraints ->
            val placeable = measurable.measure(constraints)
            val height = if (style.lineHeight.isSpecified) placeable.height else line.size.height
            layout(placeable.width, height) { placeable.place(0, line.firstBaseline.roundToInt() - placeable[FirstBaseline]) }
        }
    }
    PaintText(text, style, anchored, outline, maxLines, TextOverflow.Ellipsis)
}

@Composable
private fun PaintText(text: AnnotatedString, style: TextStyle, modifier: Modifier = Modifier,
                       outline: Color?, maxLines: Int = Int.MAX_VALUE, overflow: TextOverflow = TextOverflow.Clip) {
    if (outline == null) {
        Text(text, modifier, style = style, maxLines = maxLines, overflow = overflow)
    } else {
        var result by remember { mutableStateOf<TextLayoutResult?>(null) }
        Text(text, modifier.drawBehind {
            result?.let { layout -> outlineOffsets { x, y -> drawText(layout, outline, Offset(x, y)) } }
        }, style = style, maxLines = maxLines, overflow = overflow, onTextLayout = { result = it })
    }
}

internal inline fun DrawScope.outlineOffsets(relative: Boolean = true, draw: (Float, Float) -> Unit) {
    val low = (-0.5).dp.roundToPx().toFloat()
    val high = 0.5.dp.roundToPx().toFloat()
    val direction = if (relative && layoutDirection == LayoutDirection.Rtl) -1 else 1
    draw(direction * low, low)
    draw(direction * high, low)
    draw(direction * low, high)
    draw(direction * high, high)
}

/** Draw a platform paragraph on CSS baselines. Its optional inline face stays 24 dp even at reduced font scales. */
@Composable
internal fun HeaderParagraph(text: AnnotatedString, style: TextStyle, modifier: Modifier,
                             lineHeight: Int, baseline: Int, outline: Color? = null,
                             inline: Map<String, InlineTextContent> = emptyMap(), faceStart: Int = 0,
                             face: (@Composable () -> Unit)? = null) {
    var result by remember { mutableStateOf<TextLayoutResult?>(null) }
    Layout(content = {
        Text(text, Modifier.fillMaxWidth().drawWithContent {
            val paragraph = result ?: return@drawWithContent
            for (i in 0 until paragraph.lineCount) {
                val x = paragraph.centerOffset(i)
                val y = i * lineHeight + baseline - paragraph.getLineBaseline(i)
                val top = paragraph.getLineTop(i)
                val bottom = paragraph.getLineBottom(i)
                if (outline != null) {
                    outlineOffsets { dx, dy ->
                        translate(x + dx, y + dy) {
                            clipRect(top = top, bottom = bottom) { drawText(paragraph, outline) }
                        }
                    }
                }
                translate(x, y) { clipRect(top = top, bottom = bottom) { this@drawWithContent.drawContent() } }
            }
        }, style = style, inlineContent = inline, onTextLayout = { result = it })
        if (face != null) Box { face() }
    }, modifier = modifier.fillMaxWidth()) { children, constraints ->
        val paragraph = children.first().measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
        val textLayout = result
        val rect = textLayout?.placeholderRects?.firstOrNull()
        val icon = if (rect == null) null else children.getOrNull(1)?.measure(
            Constraints(maxWidth = rect.width.toInt(), maxHeight = rect.height.toInt())
        )
        layout(paragraph.width, (textLayout?.lineCount ?: 1) * lineHeight) {
            paragraph.place(0, 0)
            if (icon != null && rect != null) {
                // InlineTextContent may paint past its line box. Place the real icon at its old baseline-relative
                // position independently of the text clips so its bottom survives small system font settings.
                val i = textLayout.getLineForOffset(faceStart)
                val x = rect.left.roundToInt() + textLayout.centerOffset(i).roundToInt()
                val y = i * lineHeight + (rect.top - textLayout.getLineBaseline(i)).roundToInt() + icon.height
                icon.place(x, y)
            }
        }
    }
}

private fun TextLayoutResult.centerOffset(line: Int): Float {
    val left = getLineLeft(line)
    val lineWidth = ceil(getLineRight(line) - left)
    return ((size.width - lineWidth) / 2f).roundToInt() - left
}
