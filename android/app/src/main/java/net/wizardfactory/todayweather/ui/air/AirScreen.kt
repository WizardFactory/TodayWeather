package net.wizardfactory.todayweather.ui.air

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.core.domain.AirStandard
import net.wizardfactory.todayweather.core.domain.air.AirCell
import net.wizardfactory.todayweather.core.domain.air.AirGauge
import net.wizardfactory.todayweather.core.domain.air.AirMain
import net.wizardfactory.todayweather.core.domain.air.AirPage
import net.wizardfactory.todayweather.core.domain.air.AirSeries
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.forecast.AqiCell
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.forecast.AirRows
import net.wizardfactory.todayweather.ui.forecast.AqiTable
import net.wizardfactory.todayweather.ui.forecast.Arrow
import net.wizardfactory.todayweather.ui.forecast.Card
import net.wizardfactory.todayweather.ui.forecast.GlyphLine
import net.wizardfactory.todayweather.ui.forecast.ThemeImage
import net.wizardfactory.todayweather.ui.forecast.Zoomed
import net.wizardfactory.todayweather.ui.forecast.cardShadow
import net.wizardfactory.todayweather.ui.forecast.glyphStyle
import net.wizardfactory.todayweather.ui.forecast.gradeColor
import net.wizardfactory.todayweather.ui.forecast.plain
import net.wizardfactory.todayweather.ui.forecast.swipe
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.text.CssMetrics
import net.wizardfactory.todayweather.ui.text.CssText

object AirTags {
    const val PAGE = "air-page"

    /** The header block (block 0) and the gauge (block 1). */
    const val HEADER = "air-header"
    const val GAUGE = "air-gauge"
    const val PREVIOUS = "air-previous"
    const val NEXT = "air-next"
    const val WEATHER = "air-weather"
    const val LABEL = "air-label"

    /** The gauge's bands, whose texts end with an ellipsis when too long. */
    const val BANDS = "air-bands"
    const val CHART = "air-chart"

    /** Block [i] as the references number them: 0 the header, 1 the gauge, then each card. */
    fun block(i: Int) = when (i) {
        0 -> HEADER
        1 -> GAUGE
        else -> "air-block-$i"
    }

    fun code(code: String) = "air-code-$code"
    fun station(i: Int) = "air-station-$i"
}

/** S05 to draw: its model, the screen sizes, and the hourly series with its standard and `LOC_HOUR` for the chart. */
class AirContent(val page: AirPage, val metrics: ChartMetrics, val series: AirSeries?, val standard: AirStandard?, val hour: String)

/**
 * S05 as tab-air.html draws it (#2888): the first card with the header block (arrows, the main box) and the gauge, then
 * the hourly chart, daily forecast, detail, info and station cards, on the theme's page color. The header bar of the
 * shell lies over the header block's top 44 dp. [onCode] and [onStation] are the detail and station cells,
 * [onWeather] the current weather (S03), [onAction] the units and forecast source rows.
 */
@Composable
fun AirScreen(
    content: AirContent,
    theme: Theme,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onCode: (String) -> Unit,
    onStation: (Int) -> Unit,
    onWeather: () -> Unit,
    onAction: (PageAction) -> Unit,
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberScrollState(),
) {
    val colors = AirColors.of(theme)
    val page = content.page
    Column(modifier.fillMaxSize().background(colors.page.page).verticalScroll(scrollState).testTag(AirTags.PAGE)) {
        // `.card:first-child`: the header block and its 5 dp margin, the gauge and 10 dp of padding.
        Column(Modifier.fillMaxWidth().cardShadow().background(colors.page.card)) {
            Header(page, content.metrics, theme, colors, onPrevious, onNext, onWeather)
            Spacer(Modifier.height(5.dp))
            Gauge(page.gauge, colors, Modifier.padding(horizontal = 4.dp).testTag(AirTags.GAUGE))
            Spacer(Modifier.height(10.dp))
        }
        Spacer(Modifier.height(5.dp))
        var block = 2
        val series = content.series
        page.chartTitle?.let { title ->
            Card(colors.page, title, Modifier.testTag(AirTags.block(block++)), null) {
                if (series != null) Zoomed { AirChartView(series, content.standard, content.hour, colors) }
            }
        }
        page.daily?.let { cells ->
            Card(colors.page, page.dailyTitle, Modifier.testTag(AirTags.block(block++)), null) {
                AqiTable(cells.map { AqiCell(it.heading, it.glyph, it.color, it.text) }, colors.page, null)
            }
        }
        page.detail?.let { cells ->
            Card(colors.page, page.detailTitle, Modifier.testTag(AirTags.block(block++)), null) {
                Cells(cells, colors, minWidth = 110.dp, tag = { AirTags.code(cells[it].code.orEmpty()) }) { i -> cells[i].code?.let(onCode) }
            }
        }
        page.info?.let { rows ->
            Card(colors.page, null, Modifier.testTag(AirTags.block(block++)), null) { AirRows(rows, colors.page, onAction) }
        }
        page.stations?.let { cells ->
            Card(colors.page, page.stationsTitle, Modifier.testTag(AirTags.block(block++)), null) {
                Cells(cells, colors, minWidth = 110.dp, tag = AirTags::station, onTap = onStation)
            }
        }
    }
}

/**
 * `[md-page-header]`: at least `headerHeight` tall with the bar's 44 dp above its content and 5 dp below, the main box
 * (80 % wide) between the arrows, all centered (`margin: auto` in the flex row). Without a main box the arrows share
 * the free space around them.
 */
@Composable
private fun Header(page: AirPage, metrics: ChartMetrics, theme: Theme, colors: AirColors, onPrevious: () -> Unit, onNext: () -> Unit,
                   onWeather: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth().heightIn(min = metrics.headerHeight.dp).background(colors.page.header).swipe(onPrevious, onNext)
        .testTag(AirTags.HEADER)) {
        val width = maxWidth
        val main = page.main
        Row(
            Modifier.fillMaxWidth().heightIn(min = metrics.headerHeight.dp).padding(top = 44.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (main == null) Arrangement.SpaceAround else Arrangement.Center,
        ) {
            if (page.arrows) Arrow(Glyphs.CHEVRON_LEFT, colors.page, width, onPrevious, Modifier.testTag(AirTags.PREVIOUS))
            if (main != null) MainBox(main, metrics, theme, colors, onWeather, Modifier.width(width * 0.8f))
            if (page.arrows) Arrow(Glyphs.CHEVRON_RIGHT, colors.page, width, onNext, Modifier.testTag(AirTags.NEXT))
        }
    }
}

/**
 * `.main-box`: the title in its rounded border, the grade or the pollutant's value with its unit in the grade color,
 * the grade line (21 sp on 24 sp lines with the face) and the current weather, which opens S03.
 */
@Composable
private fun MainBox(main: AirMain, metrics: ChartMetrics, theme: Theme, colors: AirColors, onWeather: () -> Unit, modifier: Modifier) {
    val text = colors.page.headerText
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.border(1.dp, colors.titleBorder, RoundedCornerShape(4.dp)).padding(horizontal = 13.dp, vertical = 1.dp)) {
            CssText(AnnotatedString(main.title), plain(17.sp, colors.titleText, FontWeight.Medium), maxLines = 1)
        }
        // `font-size: bigFontSize` (× 0.55 for the overall index's grade), the unit at 32 sp.
        val color = gradeColor(main.color) ?: text
        CssText(buildAnnotatedString {
            append(main.value)
            withStyle(SpanStyle(fontSize = 32.sp)) { append(main.unit) }
        }, plain((if (main.grade) metrics.bigFontSize * 0.55 else metrics.bigFontSize).sp, color), Modifier.fillMaxWidth(), align = TextAlign.Center,
            borrow = true)
        GradeLine(main, color, text)
        WeatherRow(main, theme, text, onWeather)
    }
}

/**
 * `.main-box-air-summary`: the grade text, the face (24 dp, `vertical-align: bottom`: its box fills the 24 sp line) and
 * the advice, centered; a long advice wraps as the WebView wraps it. Each 24 sp line has its baseline where Chrome puts
 * it: the first font's ascent (a rounded-down descent borrowing a pixel) plus half the leading, rounded down.
 */
@Composable
private fun GradeLine(main: AirMain, color: Color, text: Color) {
    val density = LocalDensity.current
    val face = "face"
    val faceStart = if (main.lead.isNotEmpty()) main.lead.length + 1 else 0
    val annotated = remember(main) {
        buildAnnotatedString {
            if (main.lead.isNotEmpty()) append(main.lead + " ")
            appendInlineContent(face, main.glyph)
            main.advice?.let { append(" $it") }
        }
    }
    // Unhinted advances, as the weather pages' text: the WebView's widths.
    val style = line(21.sp, TextUnit.Unspecified, text).copy(textMotion = TextMotion.Animated)
    val measurer = rememberTextMeasurer()
    val lineHeight = with(density) { 24.sp.roundToPx() }
    val font = remember(density) { CssMetrics.line(AnnotatedString("x"), style, style, density, borrow = true) }
    val baseline = font.ascent + Math.floorDiv(lineHeight - font.ascent - font.descent, 2)
    // The face keeps its 24 dp whatever the font scale, as the shell's glyphs do (dp to sp through the font scale's
    // own, possibly nonlinear, conversion). It stands on the baseline in the text and is moved down to the line's top.
    val size = with(density) { 24.dp.toSp() }
    val placeholder = Placeholder(size, size, PlaceholderVerticalAlign.AboveBaseline)
    val inline = mapOf(face to InlineTextContent(placeholder) {
        Box(Modifier.layout { measurable, constraints ->
            val p = measurable.measure(constraints)
            layout(p.width, p.height) { p.place(0, p.height - baseline) }
        }) { Icon { Text(main.glyph, style = glyphStyle(24.sp, color, Glyphs.materialIcons)) } }
    })
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = constraints.maxWidth
        val lines = remember(annotated, style, width, measurer, placeholder) {
            val layout = measurer.measure(annotated, style, constraints = Constraints(maxWidth = width),
                placeholders = listOf(AnnotatedString.Range(placeholder, faceStart, faceStart + main.glyph.length)))
            (0 until layout.lineCount).map { layout.getLineStart(it) to layout.getLineEnd(it, visibleEnd = true) }
        }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            for ((start, end) in lines) {
                Text(annotated.subSequence(start, end), Modifier.layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints)
                    layout(placeable.width, lineHeight) { placeable.place(0, baseline - placeable[FirstBaseline]) }
                }, style = style, inlineContent = inline, maxLines = 1)
            }
        }
    }
}

/**
 * The current weather (`display: inline-flex`, a tap opens S03): the sky image on a line as tall as the image with the
 * 21 sp line's descent under it, and `weather t1h˚` centered beside it on a 24 sp line.
 */
@Composable
private fun WeatherRow(main: AirMain, theme: Theme, text: Color, onWeather: () -> Unit) {
    val density = LocalDensity.current
    // The image's line: the image on the baseline and the 21 sp descent under it (Chrome's rounding, 5.5 dp).
    val descent = with(density) {
        CssMetrics.line(AnnotatedString("x"), plain(21.sp, text), plain(21.sp, text), density, borrow = true).descent.toDp()
    }
    Row(Modifier.height(24.dp + descent).clickable(onClick = onWeather).testTag(AirTags.WEATHER), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.height(24.dp + descent)) { ThemeImage(main.weather.image, theme, 24.dp) }
        FixedLine(with(density) { 24.sp.toDp() }) {
            LineText(main.weather.text + if (main.weather.degree) "˚" else "", line(21.sp, TextUnit.Unspecified, text).copy(textMotion = TextMotion.Animated),
                Modifier.wrapContentHeight(unbounded = true))
        }
    }
}

/**
 * `.air-std-table`: the value label (bold 15 sp in a rounded border in the grade color, its pointer under it) placed
 * by `getLabelPosition` from the label's and the bands' widths in whole dp (`offsetWidth`), over the standard's bands
 * (a 2 dp top border in the grade's color, its name and `~ bound`, cut with an ellipsis when too long). The label's
 * line holds it on the 15 sp baseline: its text on that baseline, or, empty, its bottom.
 */
@Composable
private fun Gauge(gauge: AirGauge, colors: AirColors, modifier: Modifier) {
    val density = LocalDensity.current
    val labelColor = gradeColor(gauge.color) ?: Color.White
    val style = plain(15.sp, colors.page.text)
    val strut = remember(density) { CssMetrics.line(AnnotatedString("x"), style, style, density, borrow = true) }
    Layout(
        content = {
            Label(gauge.label, labelColor, Modifier.testTag(AirTags.LABEL))
            Row(Modifier.fillMaxWidth().testTag(AirTags.BANDS)) {
                for (band in gauge.bands) {
                    Column(Modifier.weight(1f).padding(horizontal = 1.dp)) {
                        Box(Modifier.fillMaxWidth().height(2.dp).background(gradeColor(band.color) ?: colors.page.text))
                        CssText(AnnotatedString(band.label), style, maxLines = 1, borrow = true, overflow = TextOverflow.Ellipsis)
                        CssText(AnnotatedString(band.bound), style, maxLines = 1, borrow = true, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        modifier = modifier.fillMaxWidth(),
    ) { (label, bands), constraints ->
        val l = label.measure(constraints.copy(minWidth = 0, minHeight = 0))
        val b = bands.measure(constraints.copy(minHeight = 0))
        val labelWidth = (l.width / density.density).roundToInt().toDouble()
        val gaugeWidth = (b.width / density.density).roundToInt().toDouble()
        val x = (gauge.labelPosition(gaugeWidth, labelWidth) * density.density).roundToInt()
        // The text's baseline is 1 dp (the border) plus the ascent under the label's top; an empty label sits on the line's baseline.
        val labelBaseline = if (gauge.label.isEmpty()) l.height else 1.dp.roundToPx() + strut.ascent
        val ascent = max(strut.ascent, labelBaseline)
        val descent = max(strut.descent, l.height - labelBaseline)
        layout(constraints.maxWidth, ascent + descent + b.height) {
            l.place(x, ascent - labelBaseline)
            b.place(0, ascent + descent)
        }
    }
}

/** `#aqistd-label`: the bordered value (10 dp each side) and, under it, the `.line` whose right border points at the value. */
@Composable
private fun Label(text: String, color: Color, modifier: Modifier) {
    // As wide as the bordered value (an inline block), which the pointer's half width follows.
    Column(modifier.width(IntrinsicSize.Max)) {
        Box(Modifier.border(1.dp, color, RoundedCornerShape(4.dp)).padding(horizontal = 11.dp, vertical = 1.dp)) {
            if (text.isNotEmpty()) CssText(AnnotatedString(text), plain(15.sp, color, FontWeight.Bold), maxLines = 1, borrow = true)
        }
        // `max-width: 50%` of the label with a 1 dp margin: its 1 dp right border ends half the label's width plus 1 dp in.
        Spacer(Modifier.fillMaxWidth().height(8.dp).drawBehind {
            drawRect(color, Offset(size.width / 2, 0f), Size(1.dp.toPx(), size.height))
        })
    }
}

/**
 * `.card-scroll` with `.rowgroup-hspacing-box`: cells 10 dp apart and from the edges, each at least [minWidth] (its
 * border included) and wider for longer texts, stretched to the card when they do not fill it (`min-width: 100%`),
 * scrolling sideways otherwise. A cell has a 1 dp rounded border, a gray background when selected, and the heading
 * (15 sp), the face and the text (17 sp) in the grade color, centered on the row's height (`vertical-align: middle`).
 */
@Composable
private fun Cells(cells: List<AirCell>, colors: AirColors, minWidth: Dp, tag: (Int) -> String, onTap: (Int) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val available = constraints.maxWidth
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Layout(content = {
                cells.forEachIndexed { i, cell ->
                    Box(Modifier.background(if (cell.selected) colors.selected else Color.Transparent, RoundedCornerShape(4.dp))
                        .border(1.dp, colors.cellBorder, RoundedCornerShape(4.dp)).selectable(cell.selected) { onTap(i) }.testTag(tag(i)),
                        contentAlignment = Alignment.Center) {
                        CellContent(cell, colors)
                    }
                }
            }) { measurables, _ ->
                val n = measurables.size
                val spacing = 10.dp.toPx()
                val natural = measurables.map { max(minWidth.toPx(), it.maxIntrinsicWidth(Constraints.Infinity).toFloat()) }
                val total = natural.sum() + spacing * (n + 1)
                val extra = if (total < available) (available - total) / n else 0f
                val widths = natural.map { it + extra }
                val height = measurables.zip(widths).maxOfOrNull { (m, w) -> m.minIntrinsicHeight(w.roundToInt()) } ?: 0
                var x = spacing
                val placed = measurables.zip(widths).map { (m, w) ->
                    val left = x.roundToInt()
                    val right = (x + w).roundToInt()
                    x += w + spacing
                    left to m.measure(Constraints.fixed(right - left, height))
                }
                layout(max(available, x.roundToInt()), height) { placed.forEach { (left, p) -> p.place(left, 0) } }
            }
        }
    }
}

@Composable
private fun CellContent(cell: AirCell, colors: AirColors) {
    val color = gradeColor(cell.color) ?: colors.page.text
    Column(Modifier.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        CssText(AnnotatedString(cell.heading), plain(15.sp, colors.page.text), maxLines = 1, align = TextAlign.Center, borrow = true)
        Spacer(Modifier.height(5.dp))
        GlyphLine(cell.glyph, color)
        CssText(AnnotatedString(cell.text), plain(17.sp, color), maxLines = 1, align = TextAlign.Center, borrow = true)
    }
}
