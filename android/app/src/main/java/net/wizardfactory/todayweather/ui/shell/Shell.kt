package net.wizardfactory.todayweather.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
            SideMenu(state, colors) { row ->
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

/** `.bar-header`: 44 dp with a 1 dp bottom line, the menu button on the left and a centered 19 sp title. */
@Composable
fun HeaderBar(colors: ShellColors, title: String, onMenu: () -> Unit, actions: @Composable () -> Unit = {}) {
    Box(
        Modifier.fillMaxWidth().height(45.dp).background(colors.headerBar).drawBehind {
            drawLine(colors.headerLine, Offset(0f, size.height - 0.5f * density), Offset(size.width, size.height - 0.5f * density), strokeWidth = 1 * density)
        },
    ) {
        Text(
            title, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            style = TextStyle(fontSize = 19.sp, color = colors.headerText, platformStyle = PlatformTextStyle(includeFontPadding = false)),
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 48.dp),
        )
        Glyph(Glyphs.NAVICON, 32.sp, colors.headerText, 44.dp,
            Modifier.align(Alignment.CenterStart).clickable(onClick = onMenu).testTag(ShellTags.MENU_BUTTON))
        Row(Modifier.align(Alignment.CenterEnd)) { actions() }
    }
}

/** `.tabs.tabs-icon-top`: 49 dp with a 1 dp top line; items up to 150 dp, 32 sp glyphs and 10 sp labels, 0.7 opacity unless selected. */
@Composable
fun TabBar(selected: Tab, colors: ShellColors, onTab: (Tab) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(50.dp).background(colors.tabBar).drawBehind {
            drawLine(colors.tabLine, Offset(0f, 0.5f * density), Offset(size.width, 0.5f * density), strokeWidth = 1 * density)
        }.padding(top = 1.dp),
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
                Modifier.weight(1f).widthIn(max = 150.dp).height(49.dp).alpha(if (on) 1f else 0.7f)
                    .clickable { onTab(tab) }.testTag(ShellTags.tab(tab)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Glyph(glyph, 32.sp, colors.tabText, 32.dp)
                Text(stringResource(label), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = TextStyle(fontSize = 10.sp, lineHeight = 14.sp, color = colors.tabText, platformStyle = PlatformTextStyle(includeFontPadding = false)))
            }
        }
    }
}

/** The full-screen side menu (S06): header with back arrow and title, then the rows; [onRow] null means close. */
@Composable
fun SideMenu(state: ShellState, colors: ShellColors, onRow: (MenuRow?) -> Unit) {
    val menuColors = colors.copy(headerBar = if (state.theme == Theme.DARK) colors.headerBar else Color.White,
        headerText = if (state.theme == Theme.DARK) Color.White else Color.Black,
        headerLine = if (state.theme == Theme.DARK) colors.headerLine else Color(0xFFDDDDDD))
    Column(Modifier.fillMaxSize().background(menuColors.menuList).testTag(ShellTags.MENU)) {
        Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(ShellColors.statusBar))
        Box(Modifier.fillMaxWidth().height(45.dp).background(menuColors.headerBar).drawBehind {
            drawLine(menuColors.headerLine, Offset(0f, size.height - 0.5f * density), Offset(size.width, size.height - 0.5f * density), strokeWidth = 1 * density)
        }) {
            Text(stringResource(R.string.LOC_TODAYWEATHER), modifier = Modifier.align(Alignment.Center),
                style = TextStyle(fontSize = 19.sp, color = menuColors.headerText, platformStyle = PlatformTextStyle(includeFontPadding = false)))
            Glyph(Glyphs.ARROW_BACK, 32.sp, menuColors.headerText, 44.dp,
                Modifier.align(Alignment.CenterStart).clickable { onRow(null) }.testTag(ShellTags.MENU_BACK))
        }
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())) {
            for (row in MenuRow.entries) {
                if (row.krOnly && state.region != "KR") continue
                val value = state.menuValues[row] ?: if (row == MenuRow.VERSION) state.version else null
                Row(
                    Modifier.fillMaxWidth().background(menuColors.menuItem).drawBehind {
                        drawLine(menuColors.menuBorder, Offset(0f, size.height - 0.5f * density), Offset(size.width, size.height - 0.5f * density), strokeWidth = 1 * density)
                    }.clickable { onRow(row) }.padding(horizontal = 16.dp, vertical = 16.dp).testTag(ShellTags.row(row)),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = if (row.button) Arrangement.Center else Arrangement.Start,
                ) {
                    Text(stringResource(row.textKey), modifier = if (row.button) Modifier else Modifier.weight(1f),
                        style = TextStyle(fontSize = if (row.button) 15.sp else 16.sp, color = menuColors.menuText,
                            platformStyle = PlatformTextStyle(includeFontPadding = false)))
                    if (value != null) {
                        Text(value, style = TextStyle(fontSize = 16.sp, color = menuColors.menuText.copy(alpha = 0.6f),
                            platformStyle = PlatformTextStyle(includeFontPadding = false)))
                    }
                    if (row.chevron) Glyph(Glyphs.CHEVRON_RIGHT, 16.sp, menuColors.menuText, 20.dp)
                }
            }
        }
    }
}
