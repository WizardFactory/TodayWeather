package net.wizardfactory.todayweather.ui.chart

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import net.wizardfactory.todayweather.core.domain.chart.Svg
import net.wizardfactory.todayweather.core.domain.chart.SvgCircle
import net.wizardfactory.todayweather.core.domain.chart.SvgGroup
import net.wizardfactory.todayweather.core.domain.chart.SvgImage
import net.wizardfactory.todayweather.core.domain.chart.SvgLine
import net.wizardfactory.todayweather.core.domain.chart.SvgNode
import net.wizardfactory.todayweather.core.domain.chart.SvgPath
import net.wizardfactory.todayweather.core.domain.chart.SvgRect
import net.wizardfactory.todayweather.core.domain.chart.SvgText

/** Text without font padding, as the WebView lays out SVG and `line-height: normal` text. */
internal fun chartTextStyle(color: Color, size: TextUnit) =
    TextStyle(color = color, fontSize = size, platformStyle = PlatformTextStyle(includeFontPadding = false))

/**
 * Draws a chart [svg] at [top] (dp) as the WebView draws the Cordova SVG with the light-theme styles:
 * elements in document order, coordinates in dp; elements at NaN positions are skipped.
 */
internal fun DrawScope.drawSvg(svg: Svg, top: Double, images: ChartImages, measurer: TextMeasurer) {
    for (node in svg.children) drawNode(node, top, images, measurer)
}

private fun DrawScope.drawNode(node: SvgNode, top: Double, images: ChartImages, measurer: TextMeasurer) {
    fun x(v: Double) = (v * density).toFloat()
    fun y(v: Double) = ((v + top) * density).toFloat()
    when (node) {
        is SvgGroup -> node.children.forEach { drawNode(it, top, images, measurer) }
        is SvgRect -> {
            if (node.cls == "chart-bar" && listOf(node.x, node.y, node.width, node.height).none { it.isNaN() }) {
                drawRect(ChartStyle.today, Offset(x(node.x), y(node.y)), androidx.compose.ui.geometry.Size(x(node.width), x(node.height)))
            }
            // current-rect is transparent in the light theme.
        }
        is SvgLine -> {
            val (color, alpha) = when (node.cls) {
                "guide-vivid-line" -> ChartStyle.guideVivid to 0.6f
                "guide-line" -> ChartStyle.guide to 0.3f
                else -> return
            }
            if (listOf(node.x1, node.y1, node.x2, node.y2).any { it.isNaN() }) return
            drawLine(color, Offset(x(node.x1), y(node.y1)), Offset(x(node.x2), y(node.y2)), strokeWidth = 1 * density, alpha = alpha)
        }
        is SvgImage -> {
            val image = images[node.href] ?: return
            if (listOf(node.x, node.y, node.width, node.height).any { it.isNaN() }) return
            // Fractional position and size, as SVG images have; mipmapped bitmaps scale down smoothly.
            val draw: DrawScope.() -> Unit = {
                withTransform({
                    translate(x(node.x), y(node.y))
                    scale(x(node.width) / image.width, x(node.height) / image.height, pivot = Offset.Zero)
                }) { drawImage(image) }
            }
            val r = node.rotation
            // An invalid rotate() (undefined angle) is ignored by the browser.
            if (r != null && !r.angle.isNaN()) rotate(r.angle.toFloat(), Offset(x(r.cx), y(r.cy)), draw) else draw()
        }
        is SvgText -> drawSvgText(node, top, measurer)
        is SvgPath -> {
            val (color, width) = when {
                node.cls.endsWith("line-today") -> ChartStyle.today to 2.0
                node.cls.endsWith("line-yesterday") -> ChartStyle.yesterday to 1.0
                else -> return
            }
            val points = node.points.filter { !it.first.isNaN() && !it.second.isNaN() }
            if (points.size < 2) return
            val path = Path().apply {
                moveTo(x(points[0].first), y(points[0].second))
                points.drop(1).forEach { lineTo(x(it.first), y(it.second)) }
            }
            drawPath(path, color, style = Stroke(width = (width * density).toFloat(), join = StrokeJoin.Miter, miter = 4f))
        }
        is SvgCircle -> {
            val color = when {
                node.cls.contains("circle-today-current") -> ChartStyle.current
                node.cls.contains("circle-yesterday-current") || node.cls.contains("circle-yesterday") -> ChartStyle.yesterday
                node.cls.contains("circle-today") -> ChartStyle.today
                else -> return
            }
            if (node.cx.isNaN() || node.cy.isNaN()) return
            val center = Offset(x(node.cx), y(node.cy))
            // Fill and a 2 px stroke of the same color: the disc reaches r + 1.
            drawCircle(color, radius = x(node.r), center = center)
            drawCircle(color, radius = x(node.r), center = center, style = Stroke(width = 2 * density))
        }
    }
}

private fun DrawScope.drawSvgText(node: SvgText, top: Double, measurer: TextMeasurer) {
    val (color, size) = ChartStyle.svgText(node.cls) ?: return
    val text: AnnotatedString = buildAnnotatedString {
        append(node.text)
        node.tspan?.let { t ->
            // A tspan class sets 10 px units; the daily chart's font-size attribute is invalid and inherits.
            withStyle(SpanStyle(fontSize = if (t.cls == "chart-unit-text") ChartStyle.unitText else size)) { append(t.text) }
        }
    }
    if (text.isEmpty()) return
    val baseline = (node.y ?: 0.0) + (node.dy ?: 0.0)
    if (baseline.isNaN() || node.x.isNaN()) return
    val layout = measurer.measure(text, chartTextStyle(color, size), softWrap = false, maxLines = 1)
    // text-anchor: middle centers the whole text, tspan included, on x; y + dy is the baseline.
    drawText(layout, topLeft = Offset((node.x * density).toFloat() - layout.size.width / 2f,
        ((baseline + top) * density).toFloat() - layout.firstBaseline))
}
