package net.wizardfactory.todayweather.ui.alarms

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.AlarmPage
import net.wizardfactory.todayweather.core.data.AlarmPopup
import net.wizardfactory.todayweather.core.domain.alarms.AlarmRow
import net.wizardfactory.todayweather.core.domain.alarms.TimePicker
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AlarmSettings
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.IonicPopup
import net.wizardfactory.todayweather.ui.shell.IonicToggle
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.PlainHeader
import net.wizardfactory.todayweather.ui.shell.PopupButton
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.text.CssMetrics
import net.wizardfactory.todayweather.ui.text.CssFixedLine
import net.wizardfactory.todayweather.ui.text.CssText
import net.wizardfactory.todayweather.ui.text.chromeLines
import net.wizardfactory.todayweather.ui.text.chromeRuns

object AlarmsTags {
    const val PAGE = "alarms-page"
    const val BACK = "alarms-back"
    const val TOGGLE = "alarms-toggle"
    const val BAR = "alarms-bar"
    const val ADD = "alarms-add"
    const val CANCEL = "alarms-cancel"
    const val SAVE = "alarms-save"
    const val PICKER = "alarms-picker"
    const val PICKER_BACKDROP = "alarms-picker-backdrop"
    const val PICKER_HEADING = "alarms-picker-heading"
    const val PICKER_SET = "alarms-picker-set"
    const val PICKER_DELETE = "alarms-picker-delete"
    const val PICKER_CLOSE = "alarms-picker-close"
    fun title(i: Int) = "alarms-title-$i"
    fun description(i: Int) = "alarms-description-$i"
    fun day(i: Int) = "alarms-day-$i"
    fun row(i: Int) = "alarms-row-$i"
    /** The picker's arrows: 0 hours, 1 minutes, 2 meridian. */
    fun up(i: Int) = "alarms-up-$i"
    fun down(i: Int) = "alarms-down-$i"
}

/** S09's route, as the Cordova state names it: `setting-push?fav=N`. */
object AlarmRoutes {
    private const val NAME = "setting-push"
    fun of(fav: Int) = "$NAME?fav=$fav"
    fun known(route: String) = route == NAME || route.startsWith("$NAME?")
    /** `parseInt($stateParams.fav)`: the number after `fav=`, or nothing. */
    fun fav(route: String): Int? = route.substringAfter("fav=", "").takeWhile { it.isDigit() || it == '-' }.toIntOrNull()
    const val SCREEN = NAME
}

/**
 * S09's visits: a page for each opening, with the app's settings page for O11. Kept by the activity's view model, a
 * visit's page and its scope outlive the activity's recreation (a rotation, a theme or language change) until the page
 * goes back, as the Cordova page kept its edits (its activity handled those changes itself; review F5). O11's Settings
 * goes through the shown activity.
 */
class AlarmsHost(val newPage: (scope: CoroutineScope, openSettings: () -> Unit) -> AlarmPage) {
    private class Visit(val key: Any, val page: AlarmPage, val scope: CoroutineScope)

    private var visit: Visit? = null

    /** The shown activity's opener of the app's settings page. */
    internal var openSettings: () -> Unit = {}

    /** The page of the visit [key]: the same one until it goes back ([end]); a new key ends the visit before. */
    internal fun page(key: Any): AlarmPage {
        visit?.takeIf { it.key == key }?.let { return it.page }
        visit?.scope?.cancel()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        return newPage(scope) { openSettings() }.also { visit = Visit(key, it, scope) }
    }

    /** The visit of [page] went back. */
    internal fun end(page: AlarmPage) {
        val v = visit?.takeIf { it.page === page } ?: return
        v.scope.cancel()
        visit = null
    }
}

/** `.push` and `.dark-theme.push` (the SCSS of setting-push). */
private class PushColors(
    val page: Color, val card: Color, val border: Color, val text: Color, val desc: Color, val dayText: Color, val dayActiveText: Color,
    val cancel: Color,
) {
    companion object {
        fun of(theme: Theme) = if (theme == Theme.DARK) {
            PushColors(Color(0xFF171717), Color(0xFF1C1C1D), Color(0xFF111111), Color.White, Color(0xFF444444), Color.White, Color.Black, Color.White)
        } else {
            PushColors(Color(0xFFF5F5F5), Color.White, Color(0xFFDDDDDD), Color(0xFF444444), Color(0xFFF4F4F4), Color.Black, Color.Black, Color(0xFF444444))
        }
    }
}

/**
 * S09 (setting-push.html, PushCtrl, #2893) for the visit [visit] of [route] (the pages' return count, saved with the
 * route): the header with the back arrow and the place's name, the alert card (the switch, its description, the hour bar
 * while the alert is not off), the alarm card (its description, the weekday buttons, the enabled alarms with the gear and
 * the add row with the plus while fewer than five are on), Cancel and Save, and the popups O11–O14. The back arrow and
 * Cancel ask before discarding edits (O12); Android back leaves without asking (D34). [onBack] runs when the page goes back.
 */
@Composable
fun AlarmsScreen(route: String, visit: Int, theme: Theme, host: AlarmsHost, onBack: () -> Unit, openAppSettings: () -> Unit = {},
                 zone: () -> TimeZone = TimeZone::getDefault) {
    val page = remember(route, visit) { host.page(route to visit) }
    DisposableEffect(host, openAppSettings) {
        host.openSettings = openAppSettings
        onDispose { host.openSettings = {} }
    }
    LaunchedEffect(page) { page.open(AlarmRoutes.fav(route)) }
    val closed by page.closed.collectAsState()
    LaunchedEffect(closed) {
        if (closed) {
            host.end(page)
            onBack()
        }
    }
    val settings by page.settings.collectAsState()
    val popup by page.popup.collectAsState()
    val title by page.title.collectAsState()
    val colors = PushColors.of(theme)
    BackHandler(onBack = page::back)
    Column(Modifier.fillMaxSize().background(colors.page).testTag(AlarmsTags.PAGE)) {
        PlainHeader(title, ShellColors.menu(theme), onBack = page::cancel, backTag = AlarmsTags.BACK)
        settings?.let { s -> Content(s, colors, page, zone()) }
    }
    // The page is drawn under the status bar already (the shell's overlay): its popups cover the page without the system
    // bars' insets again.
    popup?.let { shown ->
        Box(Modifier.fillMaxSize().consumeWindowInsets(WindowInsets.systemBars)) {
            when (shown) {
                is AlarmPopup.Picker -> TimePickerPopup(shown, page)
                else -> IonicPopup(shown.title.orEmpty(), shown.body?.let { listOf(text(it)) }.orEmpty(), shown.buttons.mapIndexed { i, (key, dark) ->
                    PopupButton(text(key), dark = dark) { answer(page, shown, i) }
                }, onBack = page::back)
            }
        }
    }
}

/** The popups' buttons in their order: O11 Close, Settings; O12 Close, Save; O13 Close. */
private fun answer(page: AlarmPage, popup: AlarmPopup, button: Int) {
    when (popup) {
        AlarmPopup.Permission -> page.answerPermission(settings = button == 1)
        AlarmPopup.SaveChanges -> page.answerSaveChanges(saveIt = button == 1)
        AlarmPopup.EqualHours -> page.closeEqualHours()
        is AlarmPopup.Picker -> {}
    }
}

@Composable
private fun text(key: String): String = stringResource(when (key) {
    "LOC_CLOSE" -> R.string.LOC_CLOSE
    "LOC_SETTING" -> R.string.LOC_SETTING
    "LOC_SAVE" -> R.string.LOC_SAVE
    "LOC_DELETE" -> R.string.LOC_DELETE
    "LOC_SAVE_CHANGES" -> R.string.LOC_SAVE_CHANGES
    "LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME" -> R.string.LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME
    "LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP" -> R.string.LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP
    else -> error("no text for $key")
})

private val DAYS = listOf(R.string.LOC_SUN, R.string.LOC_MON, R.string.LOC_TUE, R.string.LOC_WED, R.string.LOC_THU, R.string.LOC_FRI, R.string.LOC_SAT)

@Composable
private fun Content(s: AlarmSettings, colors: PushColors, page: AlarmPage, zone: TimeZone) = BoxWithConstraints(Modifier.fillMaxSize()) {
    // `@media (max-width: 359px)`: the weekday row's padding and buttons shrink in a narrow window.
    val narrow = maxWidth < 360.dp
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // `.list.card`: 5 dp under each card, which draws its shadow (0 1 px 3 px, 30 % black) and 2 dp corners.
        Card(colors) {
            TitleItem(stringResource(R.string.LOC_WEATHER_ALERT), colors, Modifier.testTag(AlarmsTags.title(0))) {
                IonicToggle(s.alertOn, page::setAlert, Modifier.align(Alignment.TopEnd).offset(x = (-16).dp, y = 12.dp).testTag(AlarmsTags.TOGGLE))
            }
            Description(stringResource(R.string.LOC_ALERT_DESCRIPTION), colors, Modifier.testTag(AlarmsTags.description(0)))
            if (s.barShown) Item(colors, bottomBorder = false) { HourBar(s.startHour, s.endHour, page::setHours) }
        }
        Card(colors) {
            TitleItem(stringResource(R.string.LOC_WEATHER_ALARM), colors, Modifier.testTag(AlarmsTags.title(1)))
            Description(stringResource(R.string.LOC_ALARM_DESCRIPTION), colors, Modifier.testTag(AlarmsTags.description(1)))
            Item(colors, bottomBorder = true, horizontal = if (narrow) 8.dp else 16.dp) { Days(s.days, colors, narrow, page::toggleDay) }
            s.rows(zone).forEach { (index, seconds) ->
                AlarmItem(AlarmRow.text(seconds), Glyphs.IOS_GEAR_OUTLINE, colors, bottomBorder = true, Modifier.testTag(AlarmsTags.row(index))) {
                    page.openPicker(index)
                }
            }
            if (s.canAdd) AlarmItem("HH:MM", Glyphs.IOS_PLUS_EMPTY, colors, bottomBorder = false, Modifier.testTag(AlarmsTags.ADD)) {
                page.openPicker(s.alarms.size)
            }
        }
        // `.buttons-bottom`: two halves, 47 dp, bold 15 sp; Cancel in the text color, Save red.
        Row(Modifier.fillMaxWidth()) {
            BottomButton(stringResource(R.string.LOC_CANCEL), colors.cancel, Modifier.weight(1f).testTag(AlarmsTags.CANCEL), page::cancel)
            BottomButton(stringResource(R.string.LOC_SAVE), Color(0xFFEF473A), Modifier.weight(1f).testTag(AlarmsTags.SAVE), page::save)
        }
    }
}

/** A card's items one after another, each over the last dp of the one before it (Ionic's -1 px margins). */
@Composable
private fun Card(colors: PushColors, content: @Composable () -> Unit) {
    Layout(content, Modifier.fillMaxWidth().padding(bottom = 5.dp).cardShadow().clip(RoundedCornerShape(2.dp)).background(colors.card)) { parts, c ->
        val overlap = 1.dp.roundToPx()
        val placed = parts.map { it.measure(c.copy(minHeight = 0)) }
        val height = placed.sumOf { it.height } - overlap * (placed.size - 1).coerceAtLeast(0)
        layout(c.maxWidth, height) {
            var y = 0
            placed.forEach { p ->
                p.place(0, y)
                y += p.height - overlap
            }
        }
    }
}

/** `box-shadow: 0 1px 3px rgba(0,0,0,.3)` as rows of a blur under and beside the card. */
private fun Modifier.cardShadow() = drawBehind {
    val px = 1.dp.toPx()
    val radius = 2.dp.toPx()
    for (i in 0 until 4) {
        val alpha = listOf(0.12f, 0.07f, 0.035f, 0.012f)[i]
        val grow = i * px
        drawRoundRect(Color.Black.copy(alpha = alpha), Offset(-grow + px * 0.5f, px - grow + px * 0.5f),
            Size(size.width + 2 * grow - px, size.height + 2 * grow - px), CornerRadius(radius + grow))
    }
}

/** `.item.item-title`: 17 sp medium in 12 dp of padding, no border; [trailing] over it (the switch). */
@Composable
private fun TitleItem(title: String, colors: PushColors, modifier: Modifier = Modifier,
                      trailing: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit = {}) {
    Box(modifier.fillMaxWidth().background(colors.card)) {
        val style = line(17.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium)
        CssText(chromeRuns(title), style, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), maxLines = 1)
        trailing()
    }
}

/** `.item-desc`: 14 sp on lines of `line-height: normal` in 8 dp and 16 dp of padding, broken where Chrome breaks it. */
@Composable
private fun Description(text: String, colors: PushColors, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth().background(colors.desc)) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val style = line(14.sp, TextUnit.Unspecified, colors.text).copy(textMotion = TextMotion.Animated)
        val width = with(density) { (maxWidth - 32.dp).roundToPx() }
        val lines = remember(text, width, density) { chromeLines(measurer, text.trim(), style, width) }
        val linePx = remember(text, density) { CssMetrics.line(AnnotatedString(text), style, style, density).let { it.ascent + it.descent } }
        // Relative to the font size as drawn, so the lines keep it under any font scale (sp converts nonlinearly above 1);
        // a hundredth of a pixel under the whole height, which the text's line box rounds up.
        val normal = ((linePx - 0.01f) / with(density) { style.fontSize.toPx() }).em
        // The block is its lines' height (in px, as the text draws them at the font scale; review F6): Compose's text box
        // can round a pixel above it.
        Text(chromeRuns(lines.joinToString("\n")), Modifier.height(16.dp + with(density) { (lines.size * linePx).toDp() })
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .wrapContentHeight(Alignment.Top, unbounded = true), style = style.copy(lineHeight = normal,
            lineHeightStyle = androidx.compose.ui.text.style.LineHeightStyle(androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center,
                androidx.compose.ui.text.style.LineHeightStyle.Trim.None)))
    }
}

/** `.item`: a 1 dp border above (and under, unless the card's last), 12 dp and 16 dp of padding. */
@Composable
private fun Item(colors: PushColors, bottomBorder: Boolean, modifier: Modifier = Modifier, horizontal: Dp = 16.dp, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().background(colors.card)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        Box(Modifier.fillMaxWidth().padding(horizontal = horizontal, vertical = 12.dp)) { content() }
        if (bottomBorder) Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
    }
}

/** An alarm row or the add row (`.item-icon-right`): 16 sp text and a 32 sp icon 11 dp from the right, centered on the row. */
@Composable
private fun AlarmItem(text: String, glyph: String, colors: PushColors, bottomBorder: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Item(colors, bottomBorder) { CssText(chromeRuns(text), line(16.sp, TextUnit.Unspecified, colors.text), maxLines = 1) }
        Box(Modifier.align(Alignment.CenterEnd).padding(end = 11.dp).width(32.dp).padding(vertical = 1.dp), contentAlignment = Alignment.Center) {
            Icon { LineText(glyph, line(32.sp, TextUnit.Unspecified, colors.text, family = Glyphs.ionicons)) }
        }
    }
}

/**
 * The seven `.day-button`s (`.col` of a flex row): each a seventh of the row with 4 dp of margin, a 1 dp border, 4 dp
 * corners and 5 dp of padding around a 32 dp line of 15 sp; in a [narrow] window (`max-width: 359px`) 2 dp of margin
 * beside them and 14 sp. Chrome keeps the sevenths' fractions, so each button starts at its rounded fraction rather than
 * at Compose's whole-pixel shares. A label may run into the padding beside it, as Chrome draws an overflowing line; when
 * the widest is wider than its button's inside, which a large font scale gives in a narrow window, all seven are drawn at
 * the size that fits it (review F6; the Cordova page did not follow the font scale).
 */
@Composable
private fun Days(days: List<Boolean>, colors: PushColors, narrow: Boolean, onToggle: (Int) -> Unit) = BoxWithConstraints(Modifier.fillMaxWidth()) {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val labels = DAYS.map { chromeRuns(stringResource(it)) }
    val base = line(if (narrow) 14.sp else 15.sp, TextUnit.Unspecified, colors.dayText, FontWeight.Medium)
    val side = if (narrow) 2.dp else 4.dp
    val room = with(density) { (constraints.maxWidth / 7f - 2 * side.toPx()).toInt() - 2.dp.roundToPx() }
    // Measured again after each step: sp converts nonlinearly above font scale 1, so the width does not follow the size.
    val size = remember(labels, base, density, room) {
        var s = base.fontSize
        for (step in 0 until 4) {
            val widest = labels.maxOf { measurer.measure(it, base.copy(fontSize = s), maxLines = 1, softWrap = false, density = density).size.width }
            if (widest < room || room <= 1) break
            s *= (room - 1f) / widest
        }
        s
    }
    Layout({
        labels.forEachIndexed { i, label ->
            val on = days.getOrElse(i) { false }
            Box(Modifier.clip(RoundedCornerShape(4.dp))
                .background(if (on) Color(0xFFE5E5E5) else Color.Transparent)
                .border(1.dp, if (on) Color(0xFFA2A2A2) else Color(0xFFCCCCCC), RoundedCornerShape(4.dp))
                .clickable { onToggle(i) }.testTag(AlarmsTags.day(i)).padding(horizontal = 1.dp, vertical = 6.dp), contentAlignment = Alignment.Center) {
                CssFixedLine(label, line(size, TextUnit.Unspecified, if (on) colors.dayActiveText else colors.dayText, FontWeight.Medium), 32.dp)
            }
        }
    }, Modifier.fillMaxWidth()) { parts, c ->
        val margin = 4.dp.toPx()
        val cell = c.maxWidth / 7f
        val placed = parts.mapIndexed { i, p ->
            val left = (i * cell + side.toPx()).roundToInt()
            val right = ((i + 1) * cell - side.toPx()).roundToInt()
            p.measure(androidx.compose.ui.unit.Constraints.fixedWidth(right - left)) to left
        }
        val height = (placed.maxOfOrNull { it.first.height } ?: 0) + 2 * margin.roundToInt()
        layout(c.maxWidth, height) { placed.forEach { (p, x) -> p.place(x, margin.roundToInt()) } }
    }
}

@Composable
private fun BottomButton(text: String, color: Color, modifier: Modifier, onClick: () -> Unit) {
    // `.button`: a 42 dp line in the 47 dp button, 1 dp borders and 1.5 dp of the minimum height around it.
    Box(modifier.height(47.dp).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        CssFixedLine(chromeRuns(text), line(15.sp, TextUnit.Unspecified, color, FontWeight.Bold), 42.dp)
    }
}

/**
 * The hour bar (ion.rangeSlider 2.2.0, double, 0–24 by 1 with a grid, its flat skin): the gray line with rounded ends,
 * the red bar between the handles, the two handles (2 dp red lines), the hours over them in red labels (one label
 * "from — to" when they meet), and the grid of 21 marks with 0, 6, 12, 18 and 24 under it. A touch moves the nearer
 * handle in whole hours, the start never past the end ([onChange]). The gesture is not keyed on the hours, so its own
 * changes do not restart it during a drag (review F4); a touch reads the hours shown when it starts.
 */
@Composable
private fun HourBar(from: Double, to: Double, onChange: (Double, Double) -> Unit) {
    val hours by rememberUpdatedState(from to to)
    val change by rememberUpdatedState(onChange)
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 10.sp, color = Color.White, platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false))
    val gridStyle = TextStyle(fontSize = 9.sp, color = Color(0xFF999999), platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false))
    val density = LocalDensity.current
    Canvas(Modifier.fillMaxWidth().height(60.dp).testTag(AlarmsTags.BAR).semantics { contentDescription = "${fmt(from)} — ${fmt(to)}" }
        .pointerInput(Unit) {
            val handle = 16.dp.toPx()
            fun value(x: Float) = ((x - handle / 2) / (size.width - handle) * 24).roundToInt().coerceIn(0, 24).toDouble()
            awaitEachGesture {
                val down = awaitFirstDown()
                val v = value(down.position.x)
                val (start, end) = hours
                // The nearer handle; on a tie the one in the touch's direction (the start below it, else the end).
                val moveFrom = abs(v - start) < abs(v - end) || (abs(v - start) == abs(v - end) && v < start)
                var last = start to end
                fun apply(x: Float) {
                    val nv = value(x)
                    val next = if (moveFrom) nv.coerceAtMost(last.second) to last.second else last.first to nv.coerceAtLeast(last.first)
                    if (next != last) {
                        last = next
                        change(next.first, next.second)
                    }
                }
                apply(down.position.x)
                do {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull() ?: break
                    apply(change.position.x)
                    change.consume()
                } while (change.pressed)
            }
        }) {
        val px = 1.dp.toPx()
        val w = size.width
        val handle = 16 * px
        // Chrome's baseline in a line of [lineHeight] px: the half-leading above Roboto's rounded ascent.
        fun baseline(style: TextStyle, lineHeight: Float): Float {
            val m = CssMetrics.line(AnnotatedString("x"), style, style, density)
            return (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent
        }
        val track = w - handle
        fun x(v: Double) = (v / 24 * track).toFloat()
        // .irs-line: 12 dp high, 25 dp down, its ends rounded (the sprite's edge pixels).
        drawRoundRect(Color(0xFFE1E4E9), Offset(0f, 25 * px), Size(w, 12 * px), CornerRadius(4 * px))
        // .irs-bar between the handles' middles.
        drawRect(Color(0xFFED5565), Offset(x(from) + handle / 2, 25 * px), Size(x(to) - x(from), 12 * px))
        // .irs-slider: a 2 dp line in the middle of 16 by 18 dp, its ends lighter.
        for (v in listOf(from, to)) {
            val left = x(v) + 7 * px
            drawRect(Color(0xFFDA4453), Offset(left, 22 * px), Size(2 * px, 18 * px))
            drawRect(Color(0xFFED5565), Offset(left, 22 * px), Size(2 * px, px))
            drawRect(Color(0xFFED5565), Offset(left, 39 * px), Size(2 * px, px))
        }
        // .irs-grid: 21 marks 16.8 dp apart, every fifth 8 dp long, the others 4 dp, with the hours under the long ones.
        for (j in 0..20) {
            val gx = (7.64f + j * (track / px) / 20f) * px
            drawRect(Color(0xFFE1E4E9), Offset(gx, 40 * px), Size(px, (if (j % 5 == 0) 8 else 4) * px))
            if (j % 5 == 0) {
                // .irs-grid-text: 9 sp on a 9 dp line, 51 dp down.
                val label = measurer.measure((j / 5 * 6).toString(), gridStyle, density = density)
                drawText(label, topLeft = Offset(gx + px / 2 - label.size.width / 2f, 51 * px + baseline(gridStyle, 9 * px) - label.firstBaseline))
            }
        }
        // .irs-from, .irs-to: 10 sp white text, 1 dp and 5 dp of padding, 4 dp corners, a 3 dp arrow under, centered over
        // their handles and not kept within the bar (`force_edges` off). When the start's label reaches the end's, one
        // .irs-single "from — to" between them; with equal hours only the start's label (`drawLabels`).
        fun width(text: String) = measurer.measure(text, labelStyle, density = density).size.width + 10 * px
        val fromText = fmt(from)
        val toText = fmt(to)
        val f = (x(from) + handle / 2 - width(fromText) / 2) to width(fromText)
        val t = (x(to) + handle / 2 - width(toText) / 2) to width(toText)
        val singleText = "$fromText — $toText"
        val labels = when {
            f.first + f.second < t.first -> listOf(fromText to f, toText to t)
            from == to -> listOf(fromText to f)
            else -> listOf(singleText to (((f.first + t.first + t.second) / 2 - width(singleText) / 2) to width(singleText)))
        }
        labels.forEach { (text, box) ->
            val (left, width) = box
            val height = 15.33f * px
            drawRoundRect(Color(0xFFED5565), Offset(left, 0f), Size(width, height), CornerRadius(4 * px))
            val arrow = Path().apply {
                val c = left + width / 2
                moveTo(c - 3 * px, height); lineTo(c + 3 * px, height); lineTo(c, height + 3 * px); close()
            }
            drawPath(arrow, Color(0xFFED5565))
            // The text on its 13.33 dp line (`line-height: 1.333`) under 1 dp of padding.
            val layout = measurer.measure(text, labelStyle, density = density)
            drawText(layout, topLeft = Offset(left + 5 * px, px + baseline(labelStyle, 13.33f * px) - layout.firstBaseline))
        }
    }
}

/** An hour as the bar writes it: whole hours without a fraction. */
private fun fmt(v: Double) = if (v == Math.floor(v)) v.toInt().toString() else v.toString()

/**
 * O14, the time picker (ionic-timepicker's popup over the page's 40 % backdrop): 250 dp, white, no head; the heading
 * (18 sp bold on 44 dp with a 1 dp border), three columns of an arrow up, the box (16 sp on 38 dp in a 1 dp border) and
 * an arrow down, colons between them 45 dp down, and Set, Delete and Close side by side (#444, white, bold 15 sp, 1 dp
 * apart). Android back closes it without an answer.
 */
@Composable
private fun TimePickerPopup(popup: AlarmPopup.Picker, page: AlarmPage) {
    BackHandler(onBack = page::back)
    val time = popup.time
    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).background(Color(0x66000000)).pointerInput(Unit) {}
        .testTag(AlarmsTags.PICKER_BACKDROP), contentAlignment = Alignment.Center) {
        Column(Modifier.width(250.dp).background(Color.White).testTag(AlarmsTags.PICKER)) {
            Box(Modifier.fillMaxWidth().height(44.dp).border(1.dp, Color(0xFFDDDDDD)).testTag(AlarmsTags.PICKER_HEADING), contentAlignment = Alignment.Center) {
                CssFixedLine(AnnotatedString(time.heading), line(18.sp, TextUnit.Unspecified, Color(0xFF444444), FontWeight.Bold), 42.dp)
            }
            // .row with 15 dp at the left (12-hour) and 5 dp around; .col-25 and .col-10 of the 230 dp between, each 5 dp inside.
            Row(Modifier.fillMaxWidth().padding(start = 15.dp, top = 5.dp, end = 5.dp, bottom = 5.dp)) {
                val columns = listOf(time.hours to (TimePicker::increaseHours to TimePicker::decreaseHours),
                    time.minutes to (TimePicker::increaseMinutes to TimePicker::decreaseMinutes),
                    time.meridian to (TimePicker::changeMeridian to TimePicker::changeMeridian))
                columns.forEachIndexed { i, (value, arrows) ->
                    if (i > 0) Colon()
                    Column(Modifier.width(57.5.dp).padding(5.dp)) {
                        Arrow(Glyphs.CHEVRON_UP, Modifier.testTag(AlarmsTags.up(i))) { page.turnPicker(arrows.first) }
                        Box(Modifier.fillMaxWidth().height(40.dp).border(1.dp, Color(0xFFDDDDDD)), contentAlignment = Alignment.Center) {
                            CssFixedLine(AnnotatedString(value), line(16.sp, TextUnit.Unspecified, Color.Black), 38.dp)
                        }
                        Arrow(Glyphs.CHEVRON_DOWN, Modifier.testTag(AlarmsTags.down(i))) { page.turnPicker(arrows.second) }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().height(44.dp)) {
                listOf(Triple(R.string.LOC_SETTING, AlarmsTags.PICKER_SET) { page.pickerSet() },
                    Triple(R.string.LOC_DELETE, AlarmsTags.PICKER_DELETE) { page.answerPicker(0) },
                    Triple(R.string.LOC_CLOSE, AlarmsTags.PICKER_CLOSE) { page.answerPicker(null) }).forEachIndexed { i, (key, tag, onTap) ->
                    if (i > 0) Spacer(Modifier.width(1.dp))
                    // `.button` is 45 dp high in the 44 dp bar: it overflows the popup by 1 dp at the bottom.
                    Box(Modifier.weight(1f).wrapContentHeight(Alignment.Top, unbounded = true).height(45.dp).alpha(0.87f).clip(RoundedCornerShape(2.dp))
                        .background(Color(0xFF444444))
                        .clickable(onClick = onTap).testTag(tag), contentAlignment = Alignment.Center) {
                        CssFixedLine(chromeRuns(stringResource(key)), line(15.sp, TextUnit.Unspecified, Color.White, FontWeight.Bold), 20.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun Colon() {
    Box(Modifier.width(23.dp).padding(start = 5.dp, end = 5.dp, top = 45.dp)) {
        LineText(":", line(14.sp, TextUnit.Unspecified, Color.Black, FontWeight.Bold), Modifier.align(Alignment.TopCenter))
    }
}

/** `.button.button-clear.button-small` with a 16 sp chevron, 30 dp high over the column's width. */
@Composable
private fun Arrow(glyph: String, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.fillMaxWidth().height(30.dp).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon { LineText(glyph, line(16.sp, TextUnit.Unspecified, Color(0xFF444444), family = Glyphs.ionicons)) }
    }
}
