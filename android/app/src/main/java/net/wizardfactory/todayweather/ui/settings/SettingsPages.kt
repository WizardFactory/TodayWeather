package net.wizardfactory.todayweather.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.settings.SettingLists
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.LabelAndValue
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.PlainHeader
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.line

/** A row of a settings page: its [label], the [value] at its right (S07) or whether it has the check mark (S08). */
data class SettingsRow(val label: String, val value: String? = null, val checked: Boolean = false)

object SettingsTags {
    const val PAGE = "settings-page"
    const val BACK = "settings-back"
    fun row(i: Int) = "settings-row-$i"
    const val CHECK = "settings-check"
}

/**
 * A settings page (units.html S07, setting-radio.html S08): the theme's plain header with the [title] and the back
 * arrow ([onBack], also Android back), then the [rows] as Ionic's `.list .item`s on the page's color. S07's rows show
 * their value at the right; S08's rows (`ion-radio`) show the check mark on the chosen one. [onRow] gets the row's index.
 * The page covers what is under it and takes its touches.
 */
@Composable
fun SettingsPage(title: String, rows: List<SettingsRow>, radio: Boolean, colors: ShellColors, onBack: () -> Unit, onRow: (Int) -> Unit,
                 modifier: Modifier = Modifier) {
    BackHandler(onBack = onBack)
    Column(modifier.fillMaxSize().background(colors.menuList).pointerInput(Unit) {}.testTag(SettingsTags.PAGE)) {
        PlainHeader(title, colors, onBack, backTag = SettingsTags.BACK)
        // The list scrolls when it is longer than the page: S08's (ion-content), and S07's too, whose rows (scroll="false")
        // always fit the Cordova app's fixed text size but not larger text (AN-06).
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())) {
            // Chrome puts each box edge on the device pixel nearest its fractional position; so does this list.
            val px = LocalDensity.current.density
            var y = 44f * px
            fun snapped(height: Dp): Dp {
                val top = Math.round(y)
                y += height.value * px
                return ((Math.round(y) - top) / px).dp
            }
            rows.forEachIndexed { i, row ->
                Item(row, radio, colors, snapped(1.dp), snapped(54.85.dp), Modifier.testTag(SettingsTags.row(i))) { onRow(i) }
            }
            if (rows.isNotEmpty()) Box(Modifier.fillMaxWidth().height(snapped(1.dp)).background(colors.menuBorder))
        }
    }
}

/**
 * `.item` (S07) or `.item.item-radio` (S08): a border above, the label on a 16 sp line of 22.85 dp with 16 dp around it,
 * and the value at the right, or the check mark (`.radio-icon`, ion-checkmark 24 sp on a line of 34.29 dp with 14 dp
 * around it) when the row is chosen.
 */
@Composable
private fun Item(row: SettingsRow, radio: Boolean, colors: ShellColors, border: Dp, height: Dp, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(border).background(colors.menuBorder))
        Box(Modifier.fillMaxWidth().heightIn(min = height).background(colors.menuItem)) {
            val style = line(16.sp, 22.85.sp, colors.menuText).copy(textMotion = TextMotion.Animated)
            Row(Modifier.fillMaxWidth().heightIn(min = height).padding(start = 16.dp, end = if (radio) 64.dp else 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                if (radio) LineText(row.label, style, maxLines = Int.MAX_VALUE) else LabelAndValue(row.label, row.value, style, Modifier.weight(1f))
            }
            if (radio && row.checked) {
                Icon {
                    FixedLine(34.2857.dp, Modifier.align(Alignment.TopEnd).padding(top = 14.dp, end = 14.dp).testTag(SettingsTags.CHECK)) {
                        LineText(Glyphs.CHECKMARK, line(24.sp, 34.2857.sp, colors.menuText, family = Glyphs.ionicons))
                    }
                }
            }
        }
    }
}

/** The settings pages open over the tabs, last on top: S07 ([UNITS]) and the S08 lists (`list:<name>`, [list]). */
object SettingsRoutes {
    const val UNITS = "units"
    fun list(name: String) = "list:$name"

    /** Whether [route] names a page (a saved route from another version may not). */
    fun known(route: String): Boolean =
        route == UNITS || route.startsWith("list:") && route.removePrefix("list:") in SettingLists.UNITS + SettingLists.SETTINGS
}

/**
 * The settings page of [route] for the saved [state]: S07's units with their values (`getUnitNameStr`,
 * `getUnitValueStr`), whose rows open their lists ([onUnit]), or an S08 list with the check mark on the saved value,
 * whose rows choose a value ([onChoose]; the chosen row does nothing, as `ng-change` does not fire). The page has the
 * theme's plain colors (the menu's). [texts] translates as the translate filter does: a missing key shows itself.
 */
@Composable
fun SettingsScreen(route: String, state: AppState, theme: Theme, texts: ChartTexts, onBack: () -> Unit, onUnit: (String) -> Unit,
                   onChoose: (String, String) -> Unit) {
    val colors = ShellColors.menu(theme)
    if (route == SettingsRoutes.UNITS) {
        val rows = SettingLists.UNITS.map { name ->
            SettingsRow(texts[SettingLists.unitName(name)], SettingLists.unitValue(name, state.units.value(name))?.let { texts[it] } ?: "")
        }
        SettingsPage(texts["LOC_UNITS"], rows, radio = false, colors, onBack, onRow = { i -> onUnit(SettingLists.UNITS[i]) })
    } else {
        val list = SettingLists.list(route.removePrefix("list:"))
        val current = if (list.unit) state.units.value(list.name) else state.settings.value(list.name)
        SettingsPage(texts[list.title], list.choices.map { SettingsRow(texts[it.label], checked = it.value == current) }, radio = true, colors, onBack,
            onRow = { i -> list.choices[i].value.let { if (it != current) onChoose(list.name, it) } })
    }
}
