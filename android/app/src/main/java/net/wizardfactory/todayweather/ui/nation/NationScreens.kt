package net.wizardfactory.todayweather.ui.nation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.core.domain.Nationwide
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.nation.NationLabel
import net.wizardfactory.todayweather.core.domain.nation.NationPages
import net.wizardfactory.todayweather.core.domain.nation.WarningCard
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.chart.rememberChartImages
import net.wizardfactory.todayweather.ui.forecast.Bubbles
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.PlainHeader
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.text.CssMetrics
import net.wizardfactory.todayweather.ui.text.CssText
import net.wizardfactory.todayweather.ui.text.chromeLines
import net.wizardfactory.todayweather.ui.text.chromeMinWidth
import net.wizardfactory.todayweather.ui.text.chromeRuns

object NationTags {
    const val PAGE = "nation-page"
    const val BACK = "nation-back"
    const val MAP = "nation-map"
    const val STRIP = "nation-strip"
    const val LOADING = "nation-loading"
    const val LOADING_BOX = "nation-loading-box"
    const val WARNINGS = "nation-warnings"
    fun mode(i: Int) = "nation-mode-$i"
    fun tab(type: String) = "nation-tab-$type"
    fun label(name: String) = "nation-label-$name"
    fun card(i: Int) = "nation-card-$i"
}

/** The width of `.nation`, the labels' containing block. */
private const val MAP_WIDTH = 330

/** The page under the three pages' content (`style="background-color: #F5F5F5"` on their ion-content), in every theme. */
private val PAGE = Color(0xFFF5F5F5)

/**
 * The page of [route] (NationRoutes) over the tabs: the theme's plain header (the menu's colors) with the title and
 * the back arrow ([onBack], also Android back), and the page's content on #F5F5F5.
 * - S10 and S11 show `$ionicLoading` while their request runs. Its backdrop takes every touch, the header's included,
 *   and Android back does nothing, as Ionic disables it while loading.
 * - [region] gives S10's and S11's title (`getNationName`).
 * - [units] gives S10's unit labels (`Units.getUnit`) and S11's air standard.
 * - [texts] translates as the translate filter does.
 * The page covers what is under it and takes its touches.
 */
@Composable
fun NationScreen(route: String, page: NationPageState?, theme: Theme, region: String, units: UnitSettings, texts: ChartTexts,
                 onBack: () -> Unit) {
    val colors = ShellColors.menu(theme)
    val loading = route != NationRoutes.WARNINGS && (page == null || page == NationPageState.Loading)
    BackHandler { if (!loading) onBack() }
    Box(Modifier.fillMaxSize().background(PAGE).pointerInput(Unit) {}.testTag(NationTags.PAGE)) {
        Column(Modifier.fillMaxSize()) {
            val title = if (route == NationRoutes.WARNINGS) texts["LOC_TYPE_SPECIAL_WEATHER"] else NationPages.title(region)?.let { texts[it] } ?: ""
            // Ionic draws the header over the content, which starts on the header's last dp (S12's first card border is
            // under it).
            PlainHeader(title, colors, onBack, Modifier.zIndex(1f), backTag = NationTags.BACK)
            Box(Modifier.fillMaxWidth().weight(1f)) {
                when (route) {
                    NationRoutes.NATION -> NationWeather((page as? NationPageState.Nation), theme, units, texts)
                    NationRoutes.NATION_AIR -> NationAir((page as? NationPageState.Nation), units)
                    else -> WarningsList((page as? NationPageState.Warnings)?.cards.orEmpty(), texts)
                }
            }
        }
        if (loading) IonicLoading()
    }
}

/** S10: the three mode buttons (`changeWeatherType`), then the map with NationCtrl's labels in the chosen mode. */
@Composable
private fun NationWeather(page: NationPageState.Nation?, theme: Theme, units: UnitSettings, texts: ChartTexts) {
    var mode by rememberSaveable { mutableStateOf(Nationwide.Mode.SKY_TEMPERATURE) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Spacer(Modifier.height(2.dp))
        ModeBar(NationPages.MODE_KEYS.map { keys -> keys.joinToString("/") { texts[it] } }) { mode = Nationwide.Mode.entries[it] }
        // `<p></p>` under the bar: its 10 px bottom margin takes in the map's 2 px.
        Spacer(Modifier.height(10.dp))
        NationMap(NationPages.weather(page?.response, mode) { units.value(it) }, theme)
    }
}

/** S11: the strip of pollutant tabs (`changeAirType`), then the map with NationAirCtrl's labels for the chosen one. */
@Composable
private fun NationAir(page: NationPageState.Nation?, units: UnitSettings) {
    var type by rememberSaveable { mutableStateOf(Nationwide.AIR_TYPES.first()) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        AirStrip(type) { type = it }
        Spacer(Modifier.height(2.dp))
        NationMap(NationPages.air(page?.response, type, units.airUnit), Theme.LIGHT)
    }
}

/**
 * `.button-bar.nation-bar`: three `button-dark button-outline` buttons sharing the width, 34 dp tall, in a #444 outline
 * with 4 dp outer corners, each later button's left border dividing it from the one before. The text is bold 15 sp #444
 * on a 32 dp line, centered between 16 dp paddings, on one line that ends with an ellipsis when it does not fit
 * (`.button-bar > .button`: the English "Wind direction/Wind speed"). While a button is pressed it turns #444 with white
 * text (`.activated`).
 */
@Composable
private fun ModeBar(labels: List<String>, onMode: (Int) -> Unit) {
    val dark = Color(0xFF444444)
    Layout(content = {
        labels.forEachIndexed { i, label ->
            val shape = RoundedCornerShape(topStart = if (i == 0) 4.dp else 0.dp, bottomStart = if (i == 0) 4.dp else 0.dp,
                topEnd = if (i == labels.lastIndex) 4.dp else 0.dp, bottomEnd = if (i == labels.lastIndex) 4.dp else 0.dp)
            val press = remember { MutableInteractionSource() }
            val pressed by press.collectIsPressedAsState()
            Box(Modifier.background(if (pressed) dark else Color.Transparent, shape)
                .drawBehind { if (i > 0) drawRect(dark, size = Size(1.dp.toPx(), size.height)) }
                .clickable(press, indication = null) { onMode(i) }.testTag(NationTags.mode(i))
                .padding(start = 17.dp, end = if (i == labels.lastIndex) 17.dp else 16.dp), contentAlignment = Alignment.Center) {
                FixedLine(32.dp) {
                    LineText(label, line(15.sp, 32.sp, if (pressed) Color.White else dark, FontWeight.Bold).copy(textMotion = TextMotion.Animated))
                }
            }
        }
    }, Modifier.fillMaxWidth().height(34.dp).border(1.dp, dark, RoundedCornerShape(4.dp))) { measurables, constraints ->
        // Flex shares what the borders (1 dp left on each, 1 dp right on the last) and paddings (16 dp each side) leave;
        // Chrome puts each button's edges on the device pixel nearest their fractional position.
        val width = constraints.maxWidth.toFloat()
        val share = (width - (labels.size + 1) * 1.dp.toPx() - labels.size * 32.dp.toPx()) / labels.size
        var x = 0f
        val edges = labels.indices.map { i ->
            val w = share + 32.dp.toPx() + 1.dp.toPx() * (if (i == labels.lastIndex) 2 else 1)
            Math.round(x).also { x += w }
        } + Math.round(x)
        val height = 34.dp.roundToPx()
        val placeables = measurables.mapIndexed { i, m -> m.measure(Constraints.fixed(edges[i + 1] - edges[i], height)) }
        layout(constraints.maxWidth, height) { placeables.forEachIndexed { i, p -> p.place(edges[i], 0) } }
    }
}

/**
 * `ion-scroll` with `.nation-air-label`: a 480 dp row of `.item` tabs that scrolls sideways when the window is narrower.
 * The tabs are 81 dp boxes every 79 dp from -1 dp, 53 dp tall from 2 dp above the strip. They are drawn in order, so
 * each one's left border covers the previous one's right edge. The strip shows the 50 dp under the header; it clips the
 * tabs' top and bottom borders. The chosen tab is `.item-dark`: #444 with a #111 border and white text. The others are
 * white with a #ddd border and black text. Each text is 16 sp, 17 dp from the tab's left.
 */
@Composable
private fun AirStrip(type: String, onType: (String) -> Unit) {
    Box(Modifier.fillMaxWidth().height(50.dp).horizontalScroll(rememberScrollState()).testTag(NationTags.STRIP)) {
        Layout(content = {
            Nationwide.AIR_TYPES.forEach { t ->
                val chosen = t == type
                Box(Modifier.background(if (chosen) Color(0xFF444444) else Color.White)
                    .border(1.dp, if (chosen) Color(0xFF111111) else Color(0xFFDDDDDD))
                    .clickable { onType(t) }.testTag(NationTags.tab(t))) {
                    Box(Modifier.padding(start = 17.dp, top = 17.dp)) {
                        CssText(AnnotatedString(t.uppercase()), TextStyle(fontSize = 16.sp, color = if (chosen) Color.White else Color.Black,
                            textMotion = TextMotion.Animated), maxLines = 1)
                    }
                }
            }
        }, Modifier.width(480.dp).height(50.dp).clipToBounds()) { measurables, _ ->
            val tab = Constraints.fixed(81.dp.roundToPx(), 53.dp.roundToPx())
            val tabs = measurables.map { it.measure(tab) }
            layout(480.dp.roundToPx(), 50.dp.roundToPx()) {
                tabs.forEachIndexed { i, p -> p.place((-1 + 79 * i).dp.roundToPx(), (-2).dp.roundToPx()) }
            }
        }
    }
}

/**
 * `.nation`: the 330×485 dp map (img/kr.png at its size, top centered) with 2 dp margins, centered in the window and
 * from its left edge when the window is narrower. Each label sits at its fixed position in the map (NationLabelBox);
 * a label that larger text makes reach past the window's right edge moves left to stay whole (the Cordova labels, at a
 * fixed text size, fit a 360 dp window).
 */
@Composable
private fun NationMap(labels: List<NationLabel>, theme: Theme) {
    val images = rememberChartImages()
    Layout(content = {
        Box(Modifier.requiredSize(MAP_WIDTH.dp, 485.dp).testTag(NationTags.MAP)) {
            images["img/kr.png"]?.let { Image(it, null, Modifier.requiredSize(MAP_WIDTH.dp, 485.dp), contentScale = ContentScale.FillBounds, filterQuality = FilterQuality.High) }
        }
        labels.forEach { NationLabelBox(it, theme, Modifier) }
    }, Modifier.fillMaxWidth()) { measurables, constraints ->
        val map = measurables.first().measure(Constraints())
        val placed = measurables.drop(1).map { it.measure(Constraints()) }
        val width = constraints.maxWidth
        val x = max(0, (width - map.width) / 2)
        layout(width, map.height + 2.dp.roundToPx()) {
            map.place(x, 0)
            placed.forEachIndexed { i, p ->
                val left = x + labels[i].left.dp.roundToPx()
                p.place(max(0, min(left, width - p.width)), labels[i].top.dp.roundToPx())
            }
        }
    }
}

/**
 * `.nation-label`: the city's name, then (S10) the weather icon and the values, each line centered, with 4 dp at both
 * sides, on the label's color with 5% elliptic corners. Text is #F5F5F5 at 20 sp on `line-height: normal` lines, and
 * units are 12 sp. The icon (36 dp, margin -3 dp above and -12 dp under) makes its own line 21 dp above the baseline.
 * The next line starts 26 dp under the name, where the icon still overlaps it.
 * The label is absolutely positioned, so its width is CSS's shrink-to-fit: its longest line, but no wider than the map
 * leaves right of it, and no narrower than its longest unbreakable piece. Text wraps at that width, Korean between
 * syllables (울산's 북북서 near the map's edge). Chrome does not break a value such as 1.6km/h, where Android would
 * after the slash, so a line without Korean counts as one piece.
 */
@Composable
private fun NationLabelBox(label: NationLabel, theme: Theme, modifier: Modifier) {
    val images = rememberChartImages()
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val text = TextStyle(fontSize = 20.sp, color = Color(0xFFF5F5F5), textMotion = TextMotion.Animated)
    val icon = label.icon?.let { images["${theme.weather}/$it.png"] }
    val shape = GenericShape { size, _ ->
        addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(size.width * 0.05f, size.height * 0.05f)))
    }
    // The label's lines at its shrink-to-fit width: the name and a Korean value (a wind direction) wrap there; a value
    // with its unit is one piece. null stands for the icon's line.
    val rows = remember(label, density, measurer) {
        val values = label.lines.map { l ->
            buildAnnotatedString { append(l.text); if (l.unit.isNotEmpty()) withStyle(SpanStyle(fontSize = 12.sp)) { append(l.unit) } }
        }
        val pad = with(density) { 4.dp.roundToPx() }
        val available = with(density) { (MAP_WIDTH - label.left).dp.roundToPx() } - 2 * pad
        val iconWidth = if (label.icon != null) with(density) { 36.dp.roundToPx() } else 0
        val texts = listOf(AnnotatedString(label.name)) + values
        val wraps = { t: AnnotatedString -> CssMetrics.cjk(t.text) }
        val longest = texts.maxOf { measurer.measure(if (wraps(it)) chromeRuns(it.text) else it, text).size.width }
        val piece = texts.maxOf { if (wraps(it)) chromeMinWidth(measurer, it.text, text) else measurer.measure(it, text).size.width }
        val width = min(max(max(piece, iconWidth), available), max(longest, iconWidth))
        val lines = texts.map { t -> if (wraps(t)) chromeLines(measurer, t.text, text, width).map { chromeRuns(it) } else listOf(t) }
        width to (lines.take(1) + listOfNotNull(if (label.icon != null) listOf(null) else null) + lines.drop(1)).flatten()
    }
    val (width, lines) = rows
    Layout(content = {
        lines.forEach { line ->
            if (line == null) {
                Box(Modifier.size(36.dp)) { icon?.let { Image(it, null, Modifier.size(36.dp), contentScale = ContentScale.FillBounds, filterQuality = FilterQuality.High) } }
            } else {
                CssText(line, text, maxLines = 1)
            }
        }
    }, modifier.background(nationColor(label.background), shape).testTag(NationTags.label(label.name))) { measurables, _ ->
        val pad = 4.dp.roundToPx()
        val parts = measurables.map { it.measure(Constraints()) }
        val strut = CssMetrics.line(AnnotatedString(""), text, text, density)
        var y = 0
        val tops = parts.mapIndexed { i, p ->
            if (lines[i] == null) {
                // The icon's line: its margin box (36 - 3 - 12 dp) above the baseline, the strut's descent under it. The
                // icon itself starts 3 dp above the line and reaches into the next one.
                val top = y - 3.dp.roundToPx()
                y += max(21.dp.roundToPx(), strut.ascent) + strut.descent
                top
            } else {
                y.also { y += p.height }
            }
        }
        layout(width + 2 * pad, y) {
            parts.forEachIndexed { i, p -> p.place(pad + (width - p.width) / 2, tops[i]) }
        }
    }
}

/** `rgba(r,g,b,a)` or `rgba(r, g, b, a)` as a color; the label's translucent black for anything else. */
internal fun nationColor(css: String): Color {
    val v = Regex("""rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)""").matchEntire(css)?.groupValues
        ?: return Color(0f, 0f, 0f, 0.4f)
    return Color(v[1].toInt(), v[2].toInt(), v[3].toInt(), (v[4].toFloat() * 255).roundToInt())
}

/**
 * S12: a `.item.item-body` card per warning, each overlapping the previous one's border. A card is 2 dp wider than
 * the window, so its side borders fall outside it; it has a #ddd border, white background and 16 dp padding, with
 * #444 16 sp text (WarningCardBox).
 */
@Composable
private fun WarningsList(cards: List<WarningCard>, texts: ChartTexts) {
    Column(Modifier.fillMaxSize().offset(y = (-1).dp).verticalScroll(rememberScrollState()).testTag(NationTags.WARNINGS)) {
        cards.forEachIndexed { i, card ->
            WarningCardBox(card, texts["LOC_SPECIAL_WEATHER_NOTE"], Modifier.offset(y = (-i).dp).testTag(NationTags.card(i)))
        }
    }
}

/**
 * A card of kma-special.html, laid out as the WebView does:
 * - the heading (h2: black 16 sp on lines 1.2 times its size, 19.2 dp at 16 sp, with 16 dp margins);
 * - the image's line: its own 19 dp line when blocks follow, else the start of the comment's first line;
 * - per situation, the bold title line, the info lines and the empty line of its `<br>`;
 * - the note heading (types 1 and 2);
 * - the comment's lines.
 * Lines are `line-height: normal`: 23 dp with Korean, 19 dp without, and 19 dp for an empty line (the strut).
 */
@Composable
internal fun WarningCardBox(card: WarningCard, note: String, modifier: Modifier) {
    val body = TextStyle(fontSize = 16.sp, color = Color(0xFF444444), textMotion = TextMotion.Animated, lineBreak = LineBreak.Simple)
    val bold = body.copy(fontWeight = FontWeight.Bold)
    val heading = line(16.sp, 19.2.sp, Color.Black).copy(textMotion = TextMotion.Animated, lineBreak = LineBreak.Simple)
    val blocks = card.situations.isNotEmpty() || card.note
    Column(modifier.fillMaxWidth().background(Color.White).drawBehind {
        // The side borders fall outside the window.
        val h = 1.dp.toPx()
        drawRect(BORDER, size = Size(size.width, h))
        drawRect(BORDER, topLeft = Offset(0f, size.height - h), size = Size(size.width, h))
    }.padding(horizontal = 16.dp, vertical = 17.dp)) {
        Spacer(Modifier.height(16.dp))
        // `line-height: 1.2`: 19.2 dp at 16 sp, growing with the font scale.
        Paragraph(card.heading, heading, fixed = with(LocalDensity.current) { (16.sp * 1.2f).toDp() })
        Spacer(Modifier.height(16.dp))
        if (blocks) {
            Spacer(Modifier.height(strutLine()))
            card.situations.forEach { s ->
                Paragraph(s.title, bold)
                s.lines.forEach { Paragraph(it, body) }
                Spacer(Modifier.height(strutLine()))
            }
            if (card.note) Paragraph(note, bold)
        }
        // Without blocks the comment's first line follows the image and the white space after it, which is not at a
        // line's start and stays: one space.
        val comment = if (blocks) card.comment else card.comment.mapIndexed { i, l -> if (i == 0 && l.isNotEmpty()) " $l" else l }
        comment.forEach { if (it.isEmpty()) Spacer(Modifier.height(strutLine())) else Paragraph(it, body) }
        if (!blocks && card.comment.isEmpty()) Spacer(Modifier.height(strutLine()))
    }
}

private val BORDER = Color(0xFFDDDDDD)

/** An empty line of 16 px text: the strut's ascent and descent (Roboto). */
@Composable
private fun strutLine(): Dp {
    val density = LocalDensity.current
    return with(density) { CssMetrics.heightDp("", TextStyle(fontSize = 16.sp), density).dp }
}

/**
 * A block of text wrapped as Chrome wraps it (chromeLines: greedy, between Korean syllables too), each line on its own
 * CSS line box. With [fixed] (a set `line-height`) a line is that tall with its text on the primary font's baseline, as
 * Chrome places it whatever fallback font draws the text. Otherwise the line is `line-height: normal` from the fonts it
 * uses (CssText), with Chrome's borrowed pixel when a descent rounds down. An empty text makes no line.
 */
@Composable
private fun Paragraph(text: String, style: TextStyle, fixed: Dp? = null) {
    if (text.isEmpty()) return
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = constraints.maxWidth
        val lines = remember(text, style, width) { chromeLines(measurer, text, style, width).map { chromeRuns(it) } }
        val baseline = remember(style) { measurer.measure("x", style).firstBaseline.roundToInt() }
        Column {
            lines.forEach { l ->
                if (fixed != null) {
                    Layout(content = { Text(l, style = style, maxLines = 1, softWrap = false) }) { measurables, _ ->
                        val p = measurables.first().measure(Constraints())
                        layout(p.width, fixed.roundToPx()) { p.place(0, baseline - p[FirstBaseline]) }
                    }
                } else {
                    CssText(l, style, maxLines = 1, borrow = true)
                }
            }
        }
    }
}

/**
 * `$ionicLoading` with the app's template (`<ion-spinner icon="bubbles" class="spinner-stable">`): the backdrop
 * (#000 at 0.4) over the page, header included, and in the middle a 68×72 dp box (#000 at 0.7, 5 dp corners, 20 dp
 * padding) with the 28 dp spinner in #f8f8f8 at its top left.
 */
@Composable
internal fun IonicLoading() {
    Box(Modifier.fillMaxSize().background(Color(0f, 0f, 0f, 0.4f)).pointerInput(Unit) {}.testTag(NationTags.LOADING), contentAlignment = Alignment.Center) {
        Box(Modifier.size(68.dp, 72.dp).background(Color(0f, 0f, 0f, 0.7f), RoundedCornerShape(5.dp)).testTag(NationTags.LOADING_BOX).padding(20.dp)) {
            Bubbles(Modifier.size(28.dp), Color(0xFFF8F8F8))
        }
    }
}
