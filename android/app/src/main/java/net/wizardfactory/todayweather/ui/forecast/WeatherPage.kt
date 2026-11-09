package net.wizardfactory.todayweather.ui.forecast

import androidx.compose.foundation.Image
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.forecast.AirRow
import net.wizardfactory.todayweather.core.domain.forecast.AqiCell
import net.wizardfactory.todayweather.core.domain.forecast.Attribution
import net.wizardfactory.todayweather.core.domain.forecast.DayCell
import net.wizardfactory.todayweather.core.domain.forecast.DustRow
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.forecast.ForecastType
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.forecast.PageImage
import net.wizardfactory.todayweather.core.domain.forecast.RunStyle
import net.wizardfactory.todayweather.core.domain.forecast.TextRun
import net.wizardfactory.todayweather.core.domain.forecast.WeatherRow
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.chart.DailyChartView
import net.wizardfactory.todayweather.ui.chart.HourlyChartView
import net.wizardfactory.todayweather.ui.chart.rememberChartImages
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.OutlinedText
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.text.CssMetrics
import net.wizardfactory.todayweather.ui.text.CssText

object ForecastTags {
    const val PAGE = "forecast-page"
    /** The header block (block 0). */
    const val HEADER = "forecast-header"
    const val PREVIOUS = "forecast-previous"
    const val NEXT = "forecast-next"
    const val SUMMARY_AIR = "forecast-summary-air"
    const val ATTRIBUTION = "forecast-attribution"
    const val POLLEN = "forecast-pollen"
    /** Block [i] of the page as the references number them: 1 the chart, then the cards and the attribution. */
    fun block(i: Int) = if (i == 0) HEADER else "forecast-block-$i"
}

/** A weather page to draw: its model and the charts built for the same scope. */
class WeatherPageContent(
    val type: ForecastType,
    val page: ForecastPage,
    val metrics: ChartMetrics,
    val hourly: HourlyChart?,
    val daily: DailyChart?,
)

/**
 * S03 (Hourly) or S04 (Daily) as tab-forecast.html and tab-dailyforecast.html draw them (#2887): the first card with
 * the header block (photo box, arrows, temperature, sky image, summary) and the chart, then the cards and the
 * attribution, on the theme's page color. The header bar of the shell lies over the header block's top 44 dp.
 * [photo] is the photo theme's image (null: none, the block's color shows); [onPrevious] and [onNext] are the
 * arrows and the header's swipes; [onAction] opens what a tap asks for.
 */
@Composable
fun WeatherPage(
    content: WeatherPageContent,
    theme: Theme,
    photo: ImageBitmap?,
    photoGradient: Boolean,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onAction: (PageAction) -> Unit,
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberScrollState(),
) {
    val daily = content.type == ForecastType.MID
    val colors = ForecastColors.of(theme, daily)
    val page = content.page
    Column(modifier.fillMaxSize().background(colors.page).verticalScroll(scrollState).testTag(ForecastTags.PAGE)) {
        // `.card:first-child`: the header block, its 5 dp margin, the chart and 10 dp of padding.
        Column(Modifier.fillMaxWidth().cardShadow().background(colors.card)) {
            HeaderBlock(page, content.metrics, theme, colors, photo, photoGradient, onPrevious, onNext, onAction)
            Spacer(Modifier.height(5.dp))
            Box(Modifier.testTag(ForecastTags.block(1))) {
                Zoomed {
                    if (!daily && page.showChart && content.hourly != null) {
                        HourlyChartView(content.hourly, expanded, onToggleExpanded, colors = colors.chart)
                    }
                    if (daily && content.daily != null) DailyChartView(content.daily, colors = colors.chart)
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        Spacer(Modifier.height(5.dp))
        var block = 2
        @Composable
        fun card(title: String?, action: PageAction? = null, body: @Composable ColumnScope.() -> Unit) =
            Card(colors, title, Modifier.testTag(ForecastTags.block(block++)), action?.let { { onAction(it) } }, body)
        page.hourlyAqi?.let { cells -> card(page.hourlyAqiTitle, PageAction.AirInfo("aqi")) { AqiTable(cells, colors, null) } }
        page.currentAir?.let { cells -> card(null) { AqiTable(cells, colors, onAction) } }
        page.detailWeather?.let { rows -> card(page.detailWeatherTitle) { WeatherRows(rows, theme, colors, onAction) } }
        page.detailAir?.let { rows -> card(page.detailAirTitle) { AirRows(rows, colors, onAction) } }
        page.dailyAqi?.let { aqi ->
            card(aqi.title) {
                aqi.cells?.let { cells -> AqiTable(cells, colors, null, Modifier.clickable { onAction(PageAction.AirInfo("aqi")) }) }
                aqi.legacyRows?.let { rows -> DustRows(rows, colors, onAction) }
            }
        }
        page.dayDetails?.let { days -> card(page.detailWeatherTitle) { DayCells(days, theme, colors) } }
        page.attribution?.let { Box(Modifier.testTag(ForecastTags.block(block++))) { Attribution(it, colors, onAction) } }
    }
}

/**
 * `[md-page-header]`: at least `headerHeight` tall with the bar's 44 dp above its content and 5 dp below (22 dp in the
 * photo theme), the photo box under it, and the main box (80 % wide) between the arrows, centered.
 */
@Composable
private fun HeaderBlock(
    page: ForecastPage, metrics: ChartMetrics, theme: Theme, colors: ForecastColors, photo: ImageBitmap?, gradient: Boolean,
    onPrevious: () -> Unit, onNext: () -> Unit, onAction: (PageAction) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxWidth().heightIn(min = metrics.headerHeight.dp).background(colors.header).swipe(onPrevious, onNext)
        .testTag(ForecastTags.HEADER)) {
        // Percentages of the block's width, as in CSS.
        val width = maxWidth
        if (photo != null) PhotoBox(photo, gradient, Modifier.matchParentSize())
        Row(
            Modifier.fillMaxWidth().heightIn(min = metrics.headerHeight.dp).padding(top = 44.dp, bottom = colors.headerBottom),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (page.arrows) Arrow(Glyphs.CHEVRON_LEFT, colors, width, onPrevious, Modifier.testTag(ForecastTags.PREVIOUS))
            MainBox(page, metrics, theme, colors, onAction, Modifier.width(width * 0.8f))
            if (page.arrows) Arrow(Glyphs.CHEVRON_RIGHT, colors, width, onNext, Modifier.testTag(ForecastTags.NEXT))
        }
    }
}

/** `.main-box-arrow`: 10 % wide, 7 % of the width above and below a 17 sp chevron; a tap switches the place. */
@Composable
internal fun Arrow(glyph: String, colors: ForecastColors, width: Dp, onClick: () -> Unit, modifier: Modifier) {
    Box(modifier.width(width * 0.1f).clickable(onClick = onClick).padding(vertical = width * 0.07f), contentAlignment = Alignment.Center) {
        OutlinedText(glyph, line(17.sp, TextUnit.Unspecified, colors.headerText, family = Glyphs.ionicons), colors.headerOutline)
    }
}

/** `.main-box`: the temperature with its unit sign and the sky image side by side, then the summary lines. */
@Composable
private fun MainBox(page: ForecastPage, metrics: ChartMetrics, theme: Theme, colors: ForecastColors, onAction: (PageAction) -> Unit, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        val hero = page.hero ?: return@Column
        Row(verticalAlignment = Alignment.CenterVertically) {
            Outlined(colors.headerOutline) { color, offset ->
                Temperature(hero.temperature, metrics.bigFontSize, color ?: colors.headerText, offset)
            }
            ThemeImage(hero.sky, theme, metrics.bigImageSize.dp)
        }
        Summary(hero.summary, colors, Modifier)
        hero.summaryAir?.let {
            Summary(it, colors, Modifier.clickable { onAction(PageAction.AirInfo("aqi")) }.testTag(ForecastTags.SUMMARY_AIR))
        }
    }
}

/**
 * The temperature in the light weight at [size] sp with its sign at half the size, raised by a third of [size]
 * (`vertical-align: super`) without making the line taller, as in the WebView.
 */
@Composable
private fun Temperature(value: String, size: Double, color: Color, modifier: Modifier) {
    val style = plain(size.sp, color, FontWeight.Light)
    Layout(content = {
        Text(value, style = style)
        Text("˚", style = style.copy(fontSize = (size / 2).sp))
    }, modifier = modifier) { (number, sign), constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val n = number.measure(loose)
        val s = sign.measure(loose)
        val raise = (size / 3).sp.toPx()
        layout(n.width + s.width, n.height) {
            n.place(0, 0)
            s.place(n.width, (n[FirstBaseline] - raise - s[FirstBaseline]).roundToInt())
        }
    }
}

/**
 * `.main-box-summary`: centered 21 sp text on 24 sp lines, each line on the baseline its first font gives it in the
 * WebView (Compose would make a Korean line taller).
 */
@Composable
internal fun Summary(text: String, colors: ForecastColors, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val style = line(21.sp, TextUnit.Unspecified, colors.headerText).copy(textMotion = TextMotion.Animated)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val width = constraints.maxWidth
        val lines = remember(text, style, width, measurer) {
            val layout = measurer.measure(text, style, constraints = androidx.compose.ui.unit.Constraints(maxWidth = width))
            (0 until layout.lineCount).map { text.substring(layout.getLineStart(it), layout.getLineEnd(it, visibleEnd = true)) }
        }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            for (line in lines) {
                // The glyphs may reach past the 24 sp line, as in CSS: the text keeps its own height, centered on it.
                FixedLine(with(LocalDensity.current) { 24.sp.toDp() }) {
                    OutlinedText(line, style, colors.headerOutline, Modifier.wrapContentHeight(unbounded = true))
                }
            }
        }
    }
}

/**
 * The charts at the system font scale (AN-06: text follows it). They are drawn to columns of a seventh of the screen,
 * so they zoom as a whole: their text grows with the scale and keeps its room, and the chart scrolls further.
 */
@Composable
internal fun Zoomed(content: @Composable () -> Unit) {
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density * density.fontScale, 1f), content = content)
}

/**
 * `[photo-url]`: the photo under a dark veil fading to white at the bottom, covering the block at 0.8 opacity. The photo
 * covers the box from its top left (`background-size: cover` at the default `background-position: 0 0`), so a wider
 * photo is cut at the right.
 */
@Composable
private fun PhotoBox(photo: ImageBitmap, gradient: Boolean, modifier: Modifier) {
    Box(modifier.graphicsLayer(alpha = 0.8f)) {
        Image(photo, null, Modifier.matchParentSize(), alignment = Alignment.TopStart, contentScale = ContentScale.Crop, filterQuality = FilterQuality.High)
        if (gradient) {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(
                0f to Color(0x4D000000), 0.95f to Color(0x4D000000), 1f to Color(0xE6FFFFFF))))
        }
    }
}

/** A `.card`: white with a soft line under it, 10 dp of padding above and below, a title, and 5 dp to the next. */
@Composable
internal fun Card(colors: ForecastColors, title: String?, modifier: Modifier, onClick: (() -> Unit)?, body: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().cardShadow().background(colors.card).padding(vertical = 10.dp)) {
        if (title != null) {
            CssText(AnnotatedString(title), plain(15.sp, colors.cardTitle), Modifier.padding(start = 5.dp, end = 5.dp, bottom = 10.dp))
        }
        Column(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier) { body() }
    }
    Spacer(Modifier.height(5.dp))
}

/**
 * `.rowgroup-vspacing-aqi-box`: equal cells side by side, each a 15 sp heading, 5 dp, a 32 dp sentiment glyph on its
 * line, the grade and the value under it. [onAction] null: the table as a whole is the target.
 */
@Composable
internal fun AqiTable(cells: List<AqiCell>, colors: ForecastColors, onAction: ((PageAction) -> Unit)?, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth()) {
        for (cell in cells) {
            val action = cell.action
            Column(
                Modifier.weight(1f).then(if (onAction != null && action != null) Modifier.clickable { onAction(action) } else Modifier),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CssText(AnnotatedString(cell.heading), plain(15.sp, colors.text), align = TextAlign.Center)
                Spacer(Modifier.height(5.dp))
                GlyphLine(cell.glyph, colors.forced ?: gradeColor(cell.color) ?: colors.text)
                CssText(AnnotatedString(cell.grade), plain(17.sp, colors.forced ?: gradeColor(cell.color) ?: colors.text), align = TextAlign.Center)
                if (cell.value.isNotEmpty()) {
                    CssText(runs(cell.value, 17.sp, colors, prefix = ""), plain(17.sp, colors.text), align = TextAlign.Center)
                }
            }
        }
    }
}

/**
 * A 32 dp Material glyph on its own line (`<i class="material-icons">` and `<br>` in a 17 sp cell): the line holds
 * the glyph on the cell font's baseline, so it reaches the font's descent below the glyph.
 */
@Composable
internal fun GlyphLine(glyph: String, color: Color) {
    val density = LocalDensity.current
    // Measured on the Cordova screen: the glyph's box reaches 32.55 dp above the cell font's baseline.
    val descent = with(density) { CssMetrics.robotoDescent(17.sp.toPx()).toDp() }
    Box(Modifier.height(32.55.dp + descent)) {
        Icon { Text(glyph, style = glyphStyle(32.sp, color, Glyphs.materialIcons)) }
    }
}

/** `.colgroup-box` of the detail weather card: rows of a 24 dp image and its text, as one centered table. */
@Composable
private fun WeatherRows(rows: List<WeatherRow>, theme: Theme, colors: ForecastColors, onAction: (PageAction) -> Unit) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.width(IntrinsicSize.Max)) {
            for (row in rows) {
                val pollen = row.pollen
                if (pollen != null) {
                    PollenButton(row, theme, colors) { onAction(pollen) }
                    continue
                }
                Row(Modifier.heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    ThemeImage(row.image, theme, 24.dp, Modifier.padding(horizontal = 8.dp))
                    CssText(runs(row.text, 17.sp, colors), plain(17.sp, colors.forced ?: colors.text))
                }
            }
        }
    }
}

/**
 * The pollen row: an Ionic clear button (bold 15 sp at 0.87 opacity, 47 dp high, 12 dp padding) with the image, the
 * risk and an information glyph; it opens the pollen popup.
 */
@Composable
private fun PollenButton(row: WeatherRow, theme: Theme, colors: ForecastColors, onClick: () -> Unit) {
    Row(
        Modifier.heightIn(min = 47.dp).graphicsLayer(alpha = 0.87f).clickable(onClick = onClick).padding(horizontal = 13.dp)
            .testTag(ForecastTags.POLLEN),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = colors.forced ?: Color(0xFF444444)
        ThemeImage(row.image, theme, 24.dp, Modifier.padding(horizontal = 8.dp))
        CssText(runs(row.text, 15.sp, colors), plain(15.sp, color, FontWeight.Bold), maxLines = 1)
        Text(" " + INFO_GLYPH, style = plain(15.sp, color).copy(fontFamily = Glyphs.ionicons))
    }
}

/** `.colgroup-box` of the detail AQI card: the labels' column and the values' column, centered as one table. */
@Composable
internal fun AirRows(rows: List<AirRow>, colors: ForecastColors, onAction: (PageAction) -> Unit) {
    val text = colors.forced ?: colors.text
    Layout(
        content = {
            for (row in rows) {
                CssText(AnnotatedString(row.label), plain(17.sp, text), modifier = row.click(onAction))
            }
            for (row in rows) {
                Row(row.click(onAction).heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.width(8.dp))
                    Icon { Text(row.glyph, style = glyphStyle(24.sp, colors.forced ?: gradeColor(row.color) ?: text, Glyphs.materialIcons)) }
                    Spacer(Modifier.width(8.dp))
                    CssText(runs(row.text, 17.sp, colors), plain(17.sp, text))
                }
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val n = rows.size
        val labels = measurables.take(n).map { it.measure(loose) }
        // A table wider than the card makes its value column narrower (its texts wrap).
        val labelWidth = labels.maxOfOrNull { it.width } ?: 0
        val values = measurables.drop(n).map { it.measure(loose.copy(maxWidth = (constraints.maxWidth - labelWidth).coerceAtLeast(0))) }
        val first = labels.maxOfOrNull { it.width } ?: 0
        val second = values.maxOfOrNull { it.width } ?: 0
        val left = ((constraints.maxWidth - first - second) / 2).coerceAtLeast(0)
        val heights = (0 until n).map { max(labels[it].height, values[it].height) }
        layout(constraints.maxWidth, heights.sum()) {
            var y = 0
            for (i in 0 until n) {
                // `td` cells are vertically centered in their row.
                labels[i].place(left, y + (heights[i] - labels[i].height) / 2)
                values[i].place(left + first, y + (heights[i] - values[i].height) / 2)
                y += heights[i]
            }
        }
    }
}

private fun AirRow.click(onAction: (PageAction) -> Unit): Modifier = action?.let { a -> Modifier.clickable { onAction(a) } } ?: Modifier

/**
 * The legacy daily dust rows (S04, without `dailyAqiForecast`): the day (weekday, date and day name) over two columns
 * with a divider, then PM2.5, PM10 and, when sent, ozone.
 */
@Composable
private fun DustRows(rows: List<DustRow>, colors: ForecastColors, onAction: (PageAction) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        rows.forEachIndexed { i, row ->
            Row(Modifier.fillMaxWidth().padding(bottom = if (i < rows.lastIndex) 10.dp else 0.dp)) {
                Column(Modifier.weight(2f), horizontalAlignment = Alignment.CenterHorizontally) {
                    CssText(AnnotatedString(row.weekday), plain(15.sp, colors.text), align = TextAlign.Center)
                    Spacer(Modifier.height(5.dp))
                    Column(Modifier.fillMaxWidth().drawBehind {
                        drawRect(colors.divider, Offset(size.width - 1.dp.toPx(), 0f), Size(1.dp.toPx(), size.height))
                    }, horizontalAlignment = Alignment.CenterHorizontally) {
                        CssText(AnnotatedString(row.date), plain(32.sp, colors.forced ?: colors.text), align = TextAlign.Center)
                        CssText(AnnotatedString(row.dayString), plain(17.sp, colors.forced ?: colors.text, FontWeight.Bold), align = TextAlign.Center)
                    }
                }
                for (cell in row.cells) {
                    val action = cell.action
                    Column(Modifier.weight(1f).then(if (action != null) Modifier.clickable { onAction(action) } else Modifier),
                        horizontalAlignment = Alignment.CenterHorizontally) {
                        CssText(AnnotatedString(cell.heading), plain(15.sp, colors.text), align = TextAlign.Center)
                        Spacer(Modifier.height(5.dp))
                        GlyphLine(cell.glyph, colors.forced ?: gradeColor(cell.color) ?: colors.text)
                        CssText(AnnotatedString(cell.grade), plain(17.sp, colors.forced ?: gradeColor(cell.color) ?: colors.text), align = TextAlign.Center)
                    }
                }
            }
        }
    }
}

/**
 * `.card-scroll` with `.rowgroup-vspacing-box`: a day per cell, at least 132 dp wide with 5 dp padding and wider for
 * longer texts, which do not wrap (`white-space: nowrap`), scrolling when wider than the page; each cell has the
 * calendar title and rows of a 24 dp image, a value and its label.
 */
@Composable
private fun DayCells(days: List<DayCell>, theme: Theme, colors: ForecastColors) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        // `min-width: 100%`: a wide page stretches the cells.
        val cellWidth = if (days.isEmpty()) 132.dp else maxOf(132.dp, maxWidth / days.size)
        DayRow(days, cellWidth, theme, colors)
    }
}

@Composable
private fun DayRow(days: List<DayCell>, cellWidth: Dp, theme: Theme, colors: ForecastColors) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        for (day in days) {
            Column(Modifier.widthIn(min = cellWidth).padding(horizontal = 5.dp)) {
                Row(Modifier.padding(start = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    CssText(buildAnnotatedString {
                        withStyle(SpanStyle(fontFamily = Glyphs.ionicons)) { append(Glyphs.CALENDAR) }
                        append(" " + day.title)
                    }, plain(15.sp, colors.text), maxLines = 1)
                }
                for (row in day.rows) {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ThemeImage(row.image, theme, 24.dp, Modifier.padding(end = 8.dp))
                        Column {
                            CssText(runs(row.value, 15.sp, colors, prefix = ""), plain(15.sp, colors.text), maxLines = 1)
                            CssText(AnnotatedString(row.label), plain(13.sp, colors.subText), strut = plain(15.sp, colors.text), maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

/** The provider attribution under the cards: the Dark Sky image (160 dp wide) or the Visual Crossing link (12 sp). */
@Composable
private fun Attribution(attribution: Attribution, colors: ForecastColors, onAction: (PageAction) -> Unit) {
    Box(Modifier.fillMaxWidth().testTag(ForecastTags.ATTRIBUTION), contentAlignment = Alignment.TopCenter) {
        val open = Modifier.clickable { onAction(PageAction.Url(attribution.url)) }
        when (attribution) {
            Attribution.DARK_SKY -> {
                val images = rememberChartImages()
                images["img/poweredby_darksky.png"]?.let { image ->
                    Image(image, null, open.width(160.dp).height((160.0 * image.height / image.width).dp), filterQuality = FilterQuality.High)
                }
            }
            Attribution.VISUAL_CROSSING -> CssText(AnnotatedString(Attribution.VISUAL_CROSSING_TEXT), plain(12.sp, colors.attributionLink),
                strut = plain(14.sp, colors.text), modifier = open, maxLines = 1)
        }
    }
}

/** An image of the theme's weather or icon folder (client/www/data/theme.js), [height] high with its own aspect. */
@Composable
internal fun ThemeImage(image: PageImage, theme: Theme, height: Dp, modifier: Modifier = Modifier) {
    val images = rememberChartImages()
    val bitmap = images[(if (image.weather) theme.weather else theme.icons) + "/" + image.name]
    if (bitmap == null) {
        // A missing image draws nothing in the WebView either.
        Spacer(modifier.height(height))
        return
    }
    Image(bitmap, null, modifier.height(height).width(height * bitmap.width / bitmap.height), contentScale = ContentScale.FillBounds,
        filterQuality = FilterQuality.High)
}

/** A row's runs: the row's font, `<small>` at 0.8 of [base], `.sub-text` at 13 sp, its `<small>` at 10.4 sp, links. */
internal fun runs(runs: List<TextRun>, base: TextUnit, colors: ForecastColors, prefix: String = " "): AnnotatedString = buildAnnotatedString {
    // The white space between the image and the text (`<img> <span>`).
    append(prefix)
    for (run in runs) {
        val style = when (run.style) {
            RunStyle.PLAIN -> SpanStyle(color = colors.forced ?: gradeColor(run.color) ?: Color.Unspecified)
            RunStyle.SMALL -> SpanStyle(fontSize = base * 0.8f)
            RunStyle.SUB -> SpanStyle(fontSize = 13.sp, color = colors.forced ?: colors.subText)
            RunStyle.SUB_SMALL -> SpanStyle(fontSize = 10.4.sp, color = colors.forced ?: colors.subText)
            RunStyle.LINK -> SpanStyle(color = colors.forced ?: colors.link)
            RunStyle.LINK_ARROW -> SpanStyle(fontFamily = Glyphs.ionicons, color = colors.forced ?: colors.link)
        }
        withStyle(style) { append(run.text) }
    }
}

private const val INFO_GLYPH = ""

internal fun gradeColor(hex: String?): Color? = hex?.let { Color(android.graphics.Color.parseColor(it)) }

/**
 * Text without font padding, on the line its fonts give it (`line-height: normal`), with unhinted glyph advances: the
 * WebView's text widths, which hinted Compose text falls short of by up to 1 dp in a 17 sp line.
 */
internal fun plain(size: TextUnit, color: Color, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontSize = size, color = color, fontWeight = weight, textMotion = TextMotion.Animated,
        platformStyle = PlatformTextStyle(includeFontPadding = false))

internal fun glyphStyle(size: TextUnit, color: Color, family: FontFamily) = plain(size, color).copy(fontFamily = family, lineHeight = size)

/** `box-shadow: 0 1px 1px rgba(0, 0, 0, .1)` under a card. */
internal fun Modifier.cardShadow() = drawBehind {
    drawRect(Color(0x14000000), Offset(0f, size.height), Size(size.width, 1.dp.toPx()))
}

/** [content] with the photo theme's [outline] around it (four 0.5 dp diagonal copies, `text-shadow`). */
@Composable
private fun Outlined(outline: Color?, content: @Composable (Color?, Modifier) -> Unit) {
    Box {
        if (outline != null) {
            for ((dx, dy) in listOf(-0.5f to -0.5f, 0.5f to -0.5f, -0.5f to 0.5f, 0.5f to 0.5f)) {
                content(outline, Modifier.layout { m, c -> val p = m.measure(c); layout(p.width, p.height) { p.place(dx.dp.roundToPx(), dy.dp.roundToPx()) } })
            }
        }
        content(null, Modifier)
    }
}

/** Ionic's swipe on the header block: a horizontal fling of at least 0.4 dp/ms; left shows the next place. */
@Composable
internal fun Modifier.swipe(onPrevious: () -> Unit, onNext: () -> Unit): Modifier {
    val density = LocalDensity.current
    val state = rememberDraggableState { }
    return draggable(state, Orientation.Horizontal, onDragStopped = { velocity ->
        val threshold = with(density) { 400.dp.toPx() }
        if (abs(velocity) >= threshold) if (velocity < 0) onNext() else onPrevious()
    })
}
