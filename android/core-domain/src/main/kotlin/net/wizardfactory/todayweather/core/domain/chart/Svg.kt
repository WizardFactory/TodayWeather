package net.wizardfactory.todayweather.core.domain.chart

/**
 * The SVG a Cordova chart directive builds, element by element in document (drawing) order, with the
 * directive's classes and attributes. Numbers are CSS pixels (dp); NaN stands for a JavaScript NaN or
 * undefined value, which the browser ignores.
 */
data class Svg(val width: Double, val height: Double, val children: List<SvgNode>)

sealed interface SvgNode

data class SvgGroup(val cls: String, val children: List<SvgNode>) : SvgNode

data class SvgRect(val cls: String, val x: Double, val y: Double, val width: Double, val height: Double) : SvgNode

data class SvgLine(val cls: String, val x1: Double, val y1: Double, val x2: Double, val y2: Double) : SvgNode

/** `transform="rotate(angle, cx, cy)"`. */
data class Rotation(val angle: Double, val cx: Double, val cy: Double)

data class SvgImage(
    val cls: String?,
    val href: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val rotation: Rotation? = null,
) : SvgNode

/** A `tspan` after the text: a class, or the daily chart's `font-size` attribute holding a class name. */
data class Tspan(val text: String, val cls: String? = null, val fontSizeAttr: String? = null)

/** `text` with its baseline at `y + dy` (no `y` attribute: 0). */
data class SvgText(val cls: String, val x: Double, val y: Double?, val dy: Double?, val text: String, val tspan: Tspan? = null) : SvgNode

/** A linear `path`: `M x,y L x,y …`. */
data class SvgPath(val cls: String, val points: List<Pair<Double, Double>>) : SvgNode

data class SvgCircle(val cls: String, val cx: Double, val cy: Double, val r: Double) : SvgNode
