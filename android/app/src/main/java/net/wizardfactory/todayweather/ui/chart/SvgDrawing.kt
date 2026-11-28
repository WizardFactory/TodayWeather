package net.wizardfactory.todayweather.ui.chart

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Density
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

/** A laid-out chart label and its precomputed device-pixel position. */
internal class PreparedText(val layout: TextLayoutResult, val topLeft: Offset)

/** A precomputed filled rectangle in device pixels. */
internal class PreparedRect(val color: Color, val topLeft: Offset, val size: Size, val alpha: Float = 1f)

/** Flattened, draw-ready operations for a chart [Svg], in document order (#3232). */
internal class PreparedSvg(val ops: List<PreparedSvgOp>)

internal sealed class PreparedSvgOp {
    class Rect(val color: Color, val topLeft: Offset, val size: Size) : PreparedSvgOp()
    class StrokedRect(val color: Color, val topLeft: Offset, val size: Size, val stroke: Stroke) : PreparedSvgOp()
    class Line(val color: Color, val start: Offset, val end: Offset, val strokeWidth: Float, val alpha: Float) : PreparedSvgOp()
    class Image(
        val image: ImageBitmap,
        val tx: Float,
        val ty: Float,
        val sx: Float,
        val sy: Float,
        val angle: Float,
        val pivot: Offset,
    ) : PreparedSvgOp()
    class Text(val layout: TextLayoutResult, val topLeft: Offset) : PreparedSvgOp()
    class Polyline(val path: Path, val color: Color, val stroke: Stroke) : PreparedSvgOp()
    class Circle(val fill: Color, val strokeColor: Color, val radius: Float, val center: Offset, val stroke: Stroke) : PreparedSvgOp()
}

/**
 * Prepares a chart [svg] at [top] (dp) with the theme's [colors] and [density] outside [DrawScope]: elements are
 * flattened in document order, NaN elements are skipped, polylines become [Path]s and texts are measured once.
 */
internal fun prepareSvg(
    svg: Svg,
    top: Double,
    images: Map<String, ImageBitmap>,
    colors: ChartColors = ChartColors.LIGHT,
    density: Density,
    measurer: TextMeasurer,
): PreparedSvg {
    val d = density.density
    val onePxStroke = Stroke(width = 1 * d)
    val circleStroke = Stroke(width = 2 * d)
    val ops = ArrayList<PreparedSvgOp>()

    fun x(v: Double) = (v * d).toFloat()
    fun y(v: Double) = ((v + top) * d).toFloat()

    fun collect(node: SvgNode) {
        when (node) {
            is SvgGroup -> {
                for (child in node.children) collect(child)
            }
            is SvgRect -> {
                if (node.x.isNaN() || node.y.isNaN() || node.width.isNaN() || node.height.isNaN()) return
                val topLeft = Offset(x(node.x), y(node.y))
                val size = Size(x(node.width), x(node.height))
                if (node.cls == "chart-bar") ops += PreparedSvgOp.Rect(colors.bar, topLeft, size)
                // current-rect is transparent but in the old theme, where its 1 px stroke has the fill's color.
                if (node.cls == "current-rect" && colors.currentRect != null) {
                    ops += PreparedSvgOp.Rect(colors.currentRect, topLeft, size)
                    ops += PreparedSvgOp.StrokedRect(colors.currentRect, topLeft, size, onePxStroke)
                }
            }
            is SvgLine -> {
                val color: Color
                val alpha: Float
                when (node.cls) {
                    "guide-vivid-line" -> {
                        color = colors.guideVivid
                        alpha = 0.6f
                    }
                    "guide-line" -> {
                        color = colors.guide
                        alpha = 0.3f
                    }
                    else -> return
                }
                if (node.x1.isNaN() || node.y1.isNaN() || node.x2.isNaN() || node.y2.isNaN()) return
                ops += PreparedSvgOp.Line(color, Offset(x(node.x1), y(node.y1)), Offset(x(node.x2), y(node.y2)), 1 * d, alpha)
            }
            is SvgImage -> {
                val image = images[node.href] ?: return
                if (node.x.isNaN() || node.y.isNaN() || node.width.isNaN() || node.height.isNaN()) return
                // Fractional position and size, as SVG images have; mipmapped bitmaps scale down smoothly.
                val tx = x(node.x)
                val ty = y(node.y)
                val sx = x(node.width) / image.width
                val sy = x(node.height) / image.height
                val r = node.rotation
                // An invalid rotate() (undefined angle) is ignored by the browser.
                val angle = if (r != null && !r.angle.isNaN()) r.angle.toFloat() else Float.NaN
                val pivot = if (r != null && !r.angle.isNaN()) Offset(x(r.cx), y(r.cy)) else Offset.Zero
                ops += PreparedSvgOp.Image(image, tx, ty, sx, sy, angle, pivot)
            }
            is SvgText -> {
                val (color, size) = ChartStyle.svgText(node.cls, colors) ?: return
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
                ops += PreparedSvgOp.Text(
                    layout = layout,
                    topLeft = Offset((node.x * d).toFloat() - layout.size.width / 2f, ((baseline + top) * d).toFloat() - layout.firstBaseline),
                )
            }
            is SvgPath -> {
                val color: Color
                val width: Double
                when {
                    node.cls.endsWith("line-today") -> {
                        color = colors.lineToday
                        width = 2.0
                    }
                    node.cls.endsWith("line-yesterday") -> {
                        color = colors.lineYesterday
                        width = 1.0
                    }
                    else -> return
                }
                var path: Path? = null
                var count = 0
                var firstX = 0f
                var firstY = 0f
                for (pt in node.points) {
                    if (pt.first.isNaN() || pt.second.isNaN()) continue
                    val px = x(pt.first)
                    val py = y(pt.second)
                    if (count == 0) {
                        firstX = px
                        firstY = py
                    } else {
                        val p = path ?: Path().also {
                            it.moveTo(firstX, firstY)
                            path = it
                        }
                        p.lineTo(px, py)
                    }
                    count++
                }
                val built = path ?: return
                ops += PreparedSvgOp.Polyline(
                    path = built,
                    color = color,
                    stroke = Stroke(width = (width * d).toFloat(), join = StrokeJoin.Miter, miter = 4f),
                )
            }
            is SvgCircle -> {
                val fill: Color
                val strokeColor: Color
                when {
                    node.cls.contains("circle-today-current") -> {
                        fill = colors.circleTodayCurrent
                        strokeColor = colors.circleTodayCurrentStroke
                    }
                    node.cls.contains("circle-yesterday-current") || node.cls.contains("circle-yesterday") -> {
                        fill = colors.circleYesterday
                        strokeColor = colors.circleYesterday
                    }
                    node.cls.contains("circle-today") -> {
                        fill = colors.circleToday
                        strokeColor = colors.circleToday
                    }
                    else -> return
                }
                if (node.cx.isNaN() || node.cy.isNaN()) return
                // A fill and a 2 px stroke: the disc reaches r + 1.
                ops += PreparedSvgOp.Circle(fill, strokeColor, x(node.r), Offset(x(node.cx), y(node.cy)), circleStroke)
            }
        }
    }

    for (node in svg.children) collect(node)
    return PreparedSvg(ops)
}

/** Draws a [PreparedSvg] using precomputed geometry, paths and text layouts. */
internal fun DrawScope.drawSvg(prepared: PreparedSvg) {
    for (op in prepared.ops) {
        when (op) {
            is PreparedSvgOp.Rect -> drawRect(op.color, op.topLeft, op.size)
            is PreparedSvgOp.StrokedRect -> drawRect(op.color, op.topLeft, op.size, style = op.stroke)
            is PreparedSvgOp.Line -> drawLine(op.color, op.start, op.end, strokeWidth = op.strokeWidth, alpha = op.alpha)
            is PreparedSvgOp.Image -> {
                if (!op.angle.isNaN()) {
                    rotate(op.angle, op.pivot) {
                        withTransform({
                            translate(op.tx, op.ty)
                            scale(op.sx, op.sy, pivot = Offset.Zero)
                        }) { drawImage(op.image) }
                    }
                } else {
                    withTransform({
                        translate(op.tx, op.ty)
                        scale(op.sx, op.sy, pivot = Offset.Zero)
                    }) { drawImage(op.image) }
                }
            }
            is PreparedSvgOp.Text -> drawText(op.layout, topLeft = op.topLeft)
            is PreparedSvgOp.Polyline -> drawPath(op.path, op.color, style = op.stroke)
            is PreparedSvgOp.Circle -> {
                drawCircle(op.fill, radius = op.radius, center = op.center)
                drawCircle(op.strokeColor, radius = op.radius, center = op.center, style = op.stroke)
            }
        }
    }
}
