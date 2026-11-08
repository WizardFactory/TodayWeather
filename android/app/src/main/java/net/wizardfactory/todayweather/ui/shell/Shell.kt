package net.wizardfactory.todayweather.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme

/** Rows of the side menu in Cordova order (client/www/index.html L97-L171); [krOnly] rows need region KR. */
enum class MenuRow(val textKey: Int, val krOnly: Boolean = false, val chevron: Boolean = false, val button: Boolean = false) {
    SPECIAL_WEATHER(R.string.LOC_TYPE_SPECIAL_WEATHER, krOnly = true, chevron = true),
    NATIONAL_WEATHER(R.string.LOC_NATIONAL_WEATHER, krOnly = true, chevron = true),
    NATIONAL_AIR(R.string.LOC_NATIONAL_AIR, krOnly = true, chevron = true),
    NULLSCHOOL_WIND(R.string.LOC_NULLSCHOOL_WIND, krOnly = true, chevron = true),
    UNITS(R.string.LOC_UNITS),
    STARTUP_PAGE(R.string.LOC_STARTUP_PAGE),
    REFRESH_INTERVAL(R.string.LOC_REFRESH_INTERVAL),
    THEME(R.string.LOC_THEME_SETTING),
    ANALYTICS(R.string.LOC_ANALYTICS_CHOICE, button = true),
    AD_PRIVACY(R.string.LOC_AD_PRIVACY_CHOICES, button = true),
    PRIVACY_POLICY(R.string.LOC_PRIVACY_POLICY, button = true),
    TERMS(R.string.LOC_TERMS, button = true),
    SEND_FEEDBACK(R.string.LOC_SEND_FEEDBACK),
    RATE(R.string.LOC_RATE_THIS_APP),
    VERSION(R.string.LOC_VERSION),
    ABOUT(R.string.LOC_ABOUT),
}

/** What the shell shows and how it reacts; screens (AN-08 and later) fill the tab pages and menu actions. */
class ShellState(
    val theme: Theme,
    val region: String,
    val startupTab: Tab,
    val version: String,
    /** Values shown at the right of the startup page, refresh interval and theme rows. */
    val menuValues: Map<MenuRow, String> = emptyMap(),
)

object ShellTags {
    const val MENU_BUTTON = "shell-menu-button"
    const val MENU = "shell-menu"
    const val MENU_BACK = "shell-menu-back"
    const val EXIT_DIALOG = "shell-exit-dialog"
    fun tab(tab: Tab) = "shell-tab-${tab.state}"
    fun page(tab: Tab) = "shell-page-${tab.state}"
    fun row(row: MenuRow) = "shell-menu-${row.name.lowercase()}"
}

/**
 * The frame every screen shares (gate of AN-07, #2886): the page of the selected tab under its header bar, the
 * bottom tab bar, the full-screen side menu, the exit confirmation and a slot for the bottom banner (AN-15).
 * Android back closes the menu, then a dialog, and on a main tab asks before leaving ([onExit]).
 */
@Composable
fun TodayWeatherShell(
    state: ShellState,
    onRefresh: (Tab) -> Unit,
    onMenuRow: (MenuRow) -> Unit,
    onExit: () -> Unit,
    banner: @Composable () -> Unit = {},
    page: @Composable BoxScope.(Tab, ShellColors) -> Unit = { _, _ -> },
) {
    var selected by rememberSaveable { mutableStateOf(state.startupTab) }
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    var exitAsked by rememberSaveable { mutableStateOf(false) }
    var lastTap by remember { mutableLongStateOf(0L) }
    val colors = ShellColors.of(state.theme, selected)

    BackHandler(enabled = menuOpen) { menuOpen = false }
    BackHandler(enabled = !menuOpen && !exitAsked) { exitAsked = true }

    Box(Modifier.fillMaxSize().background(colors.page)) {
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(ShellColors.statusBar))
            Box(Modifier.fillMaxWidth().weight(1f).testTag(ShellTags.page(selected))) {
                page(selected, colors)
                HeaderBar(colors, title = "", onMenu = { menuOpen = true })
            }
            TabBar(selected, colors) { tab ->
                val now = System.currentTimeMillis()
                if (tab == selected) {
                    // Cordova: the selected weather or air tab refreshes; a second tap within 700 ms does nothing.
                    if (tab != Tab.LOCATIONS && now - lastTap >= 700) onRefresh(tab)
                } else {
                    selected = tab
                }
                lastTap = now
            }
            banner()
            Spacer(Modifier.fillMaxWidth().windowInsetsBottomHeight(WindowInsets.navigationBars).background(colors.tabBar))
        }
        AnimatedVisibility(
            visible = menuOpen,
            enter = slideInHorizontally(tween(200)) { -it },
            exit = slideOutHorizontally(tween(200)) { -it },
        ) {
            SideMenu(state) { row ->
                if (row == null) menuOpen = false else onMenuRow(row)
            }
        }
        if (exitAsked) {
            AlertDialog(
                onDismissRequest = { exitAsked = false },
                text = { Text(stringResource(R.string.LOC_DO_YOU_WANT_TO_EXIT)) },
                dismissButton = { TextButton(onClick = { exitAsked = false }) { Text(stringResource(R.string.LOC_CANCEL)) } },
                confirmButton = { TextButton(onClick = { exitAsked = false; onExit() }) { Text(stringResource(R.string.LOC_OK)) } },
                modifier = Modifier.testTag(ShellTags.EXIT_DIALOG),
            )
        }
    }
}

/**
 * The header bar of a tab (`ion-nav-bar`, `.bar.bar-header`): 44 dp with a hairline at the bottom, the menu button
 * at the left, the page's [actions] at the right and the title (19 sp, medium) centered between equal sides that
 * clear the wider group of buttons, as Ionic places it (ionic.bundle.js `calcWidths`: that group plus 10 dp, and
 * the title's 10 dp margin).
 */
@Composable
fun HeaderBar(colors: ShellColors, title: String, onMenu: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    Layout(
        content = {
            BarButton(Glyphs.NAVICON, colors, onMenu, Modifier.testTag(ShellTags.MENU_BUTTON))
            Row { actions() }
            BarTitle(title, colors)
        },
        modifier = Modifier.fillMaxWidth().height(44.dp).background(colors.headerBar).hairline(colors.headerLine, bottom = true),
    ) { (menu, buttons, text), constraints ->
        val loose = constraints.copy(minWidth = 0)
        val left = menu.measure(loose)
        val right = buttons.measure(loose)
        val padding = 5.dp.roundToPx()
        val side = max(left.width, right.width) + 20.dp.roundToPx()
        val label = text.measure(constraints.copy(minWidth = 0, maxWidth = (constraints.maxWidth - 2 * side).coerceAtLeast(0)))
        layout(constraints.maxWidth, constraints.maxHeight) {
            label.place((constraints.maxWidth - label.width) / 2, 0)
            left.place(padding, 0)
            right.place(constraints.maxWidth - padding - right.width, 0)
        }
    }
}

/**
 * An icon button of a header bar (`.bar .button.button-icon`) below the bar's 5 dp padding: a transparent 1 dp
 * border, [padding] at each side, a 32 sp glyph on a 32 dp line with 2 dp at each side, and 0.87 opacity, which
 * every `.button` has in ionic.app.scss.
 */
@Composable
fun BarButton(glyph: String, colors: ShellColors, onClick: () -> Unit, modifier: Modifier = Modifier, padding: Dp = 8.dp) {
    Box(modifier.padding(top = 5.dp).alpha(0.87f).clickable(onClick = onClick).padding(vertical = 1.dp, horizontal = 1.dp + padding + 2.dp)) {
        OutlinedText(glyph, line(32.sp, 32.sp, colors.headerText, family = Glyphs.ionicons), colors.headerOutline)
    }
}

/** `.bar .title` on Android: one line of 44 dp, 19 sp, medium. */
@Composable
private fun BarTitle(title: String, colors: ShellColors, modifier: Modifier = Modifier) {
    OutlinedText(title, line(19.sp, 44.sp, colors.headerText, FontWeight.Medium), colors.headerOutline, modifier)
}

/**
 * `.tabs.tabs-icon-top`: 49 dp with a hairline at the top and the items 2 dp below it. Each item, up to 150 dp
 * wide, has a 32 sp glyph on a 32 dp line over a 10 sp label on a 14 dp line, at 0.7 opacity unless selected.
 */
@Composable
fun TabBar(selected: Tab, colors: ShellColors, onTab: (Tab) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(49.dp).background(colors.tabBar).hairline(colors.tabLine, bottom = false).padding(top = 2.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        for (tab in Tab.entries) {
            val on = tab == selected
            val (glyph, label) = when (tab) {
                Tab.LOCATIONS -> (if (on) Glyphs.STAR else Glyphs.STAR_OUTLINE) to R.string.LOC_SAVED_LOCATIONS
                Tab.HOURLY -> (if (on) Glyphs.REFRESH else Glyphs.TIME) to R.string.LOC_HOURLY_FORECAST
                Tab.DAILY -> (if (on) Glyphs.REFRESH else Glyphs.CALENDAR) to R.string.LOC_DAILY_FORECAST
                Tab.AIR -> (if (on) Glyphs.REFRESH else Glyphs.CLOUD_OUTLINE) to R.string.LOC_AIR_INFORMATION
            }
            Column(
                Modifier.weight(1f).widthIn(max = 150.dp).fillMaxHeight().alpha(if (on) 1f else 0.7f)
                    .clickable { onTab(tab) }.testTag(ShellTags.tab(tab)),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                LineText(glyph, line(32.sp, 32.sp, colors.tabText, family = Glyphs.ionicons))
                LineText(stringResource(label), line(10.sp, 14.sp, colors.tabText))
            }
        }
    }
}

/**
 * The full-screen side menu (S06): the theme's header with the back arrow and the app name, then the rows. Plain
 * rows (`.item`) share 1 dp borders; the analytics, ad privacy, policy and terms rows are blocks
 * (`.item.button.button-block`) with 9 to 10 dp around them. [onRow] null means close.
 */
@Composable
fun SideMenu(state: ShellState, onRow: (MenuRow?) -> Unit) {
    val colors = ShellColors.menu(state.theme)
    // .menu: a 1 dp border at the bottom of the panel.
    Column(Modifier.fillMaxSize().background(Color(0xFFD2D2D2)).padding(bottom = 1.dp).background(colors.menuList).testTag(ShellTags.MENU)) {
        Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(ShellColors.statusBar))
        // A plain `.bar.bar-header`: the title is centered over the whole bar with its 10 dp margins.
        Box(Modifier.fillMaxWidth().height(44.dp).background(colors.headerBar).hairline(colors.headerLine, bottom = true)) {
            BarTitle(stringResource(R.string.LOC_TODAYWEATHER), colors, Modifier.align(Alignment.TopCenter).padding(horizontal = 10.dp))
            BarButton(Glyphs.ARROW_BACK, colors, { onRow(null) }, Modifier.padding(start = 5.dp).testTag(ShellTags.MENU_BACK))
        }
        val rows = MenuRow.entries.filter { !it.krOnly || state.region == "KR" }
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())) {
            // Chrome puts each box edge on the device pixel nearest its fractional position; so does this list.
            val px = LocalDensity.current.density
            var y = 0f
            fun snapped(height: Dp): Dp {
                val top = Math.round(y)
                y += height.value * px
                return ((Math.round(y) - top) / px).dp
            }
            rows.forEachIndexed { i, row ->
                val previous = rows.getOrNull(i - 1)
                if (row.button) {
                    Spacer(Modifier.height(snapped(if (previous?.button == true) 10.dp else 9.dp)))
                    MenuButton(row, state.menuValues[row], colors, snapped(47.dp)) { onRow(row) }
                    if (rows.getOrNull(i + 1)?.button == false) Spacer(Modifier.height(snapped(9.dp)))
                } else {
                    MenuItem(row, state, colors, snapped(1.dp), snapped(54.85.dp)) { onRow(row) }
                    if (rows.getOrNull(i + 1)?.button != false) Box(Modifier.fillMaxWidth().height(snapped(1.dp)).background(colors.menuBorder))
                }
            }
        }
    }
}

/** `.item`: a border above, 16 dp padding around a 16 sp line of 22.85 dp, and the value or a chevron at the right. */
@Composable
private fun MenuItem(row: MenuRow, state: ShellState, colors: ShellColors, border: Dp, height: Dp, onClick: () -> Unit) {
    val value = state.menuValues[row] ?: if (row == MenuRow.VERSION) state.version else null
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).testTag(ShellTags.row(row))) {
        Box(Modifier.fillMaxWidth().height(border).background(colors.menuBorder))
        Row(Modifier.fillMaxWidth().height(height).background(colors.menuItem).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            val style = line(16.sp, 22.85.sp, colors.menuText)
            LineText(stringResource(row.textKey), style, Modifier.weight(1f))
            if (value != null) LineText(value, style)
            // The chevron sits on the row's baseline (`<i class="icon ion-chevron-right">` floated in the text's line).
            if (row.chevron) LineText(Glyphs.CHEVRON_RIGHT, line(16.sp, 22.85.sp, colors.menuText, family = Glyphs.ionicons), baselineOf = style)
        }
    }
}

/**
 * `.item.button.button-block`: a 47 dp block with a 1 dp border and 4 dp corners, a bold 15 sp label followed by
 * " · [value]" when the row has one (the analytics choice), at 0.87 opacity.
 */
@Composable
private fun MenuButton(row: MenuRow, value: String?, colors: ShellColors, height: Dp, onClick: () -> Unit) {
    val text = stringResource(row.textKey).let { if (value != null) "$it · $value" else it }
    Box(
        Modifier.fillMaxWidth().height(height).alpha(0.87f).clip(RoundedCornerShape(4.dp)).background(colors.menuItem)
            .border(1.dp, colors.menuBorder, RoundedCornerShape(4.dp)).clickable(onClick = onClick).testTag(ShellTags.row(row)),
    ) {
        LineText(text, line(15.sp, 42.sp, colors.menuText, FontWeight.Bold), Modifier.align(Alignment.TopCenter).padding(top = 1.dp, start = 12.dp, end = 12.dp))
    }
}

/** A CSS line box: [lineHeight] with half the leading above the font's ascent and half below its descent. */
private fun line(size: TextUnit, lineHeight: TextUnit, color: Color, weight: FontWeight = FontWeight.Normal, family: FontFamily? = null) =
    TextStyle(
        fontSize = size, lineHeight = lineHeight, color = color, fontWeight = weight, fontFamily = family,
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
        platformStyle = PlatformTextStyle(includeFontPadding = false),
    )

/**
 * One line of [text] where Chrome puts it: on the baseline of a line in the font of [baselineOf]. Android lowers a
 * line drawn by a taller fallback font, such as Noto Sans CJK for Korean, while Chrome keeps the first font's
 * baseline. Icon fonts draw their own glyphs; an icon inside a line of text takes the text's baseline.
 */
@Composable
private fun LineText(text: String, style: TextStyle, modifier: Modifier = Modifier, baselineOf: TextStyle = style) {
    val measurer = rememberTextMeasurer()
    val reference = if (baselineOf.fontFamily == null) "x" else text
    val baseline = remember(baselineOf, reference, measurer) { measurer.measure(reference, baselineOf).firstBaseline }
    Text(text, modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, placeable.height) { placeable.place(0, baseline.roundToInt() - placeable[FirstBaseline]) }
    }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = style)
}

/** [text] in [style] with the photo theme's [outline]: four 0.5 dp diagonal shadows (`text-shadow`). */
@Composable
private fun OutlinedText(text: String, style: TextStyle, outline: Color?, modifier: Modifier = Modifier) {
    Box(modifier) {
        if (outline != null) {
            for ((dx, dy) in listOf(-0.5f to -0.5f, 0.5f to -0.5f, -0.5f to 0.5f, 0.5f to 0.5f)) {
                LineText(text, style.copy(color = outline), Modifier.offset(dx.dp, dy.dp))
            }
        }
        LineText(text, style)
    }
}

/** Ionic draws a bar's 1 px border as a hairline: the half CSS pixel on the inner side of its top or [bottom] edge. */
private fun Modifier.hairline(color: Color, bottom: Boolean) = drawBehind {
    val h = 0.5.dp.toPx()
    drawRect(color, Offset(0f, if (bottom) size.height - h else h), Size(size.width, h))
}
