package net.wizardfactory.todayweather.ui.places

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.AppLocale
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.places.PlaceRow
import net.wizardfactory.todayweather.core.domain.places.PlaceRows
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.domain.start.TownPage
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.search.PlaceSearch
import net.wizardfactory.todayweather.search.Prediction
import net.wizardfactory.todayweather.ui.chart.ChartImages
import net.wizardfactory.todayweather.ui.chart.rememberChartImages
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.IonicToggle
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.ShellTags
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.start.GoogleLogo
import net.wizardfactory.todayweather.ui.text.CssText
import net.wizardfactory.todayweather.ui.text.chromeRuns

object PlacesTags {
    const val INPUT = "places-input"
    const val MODE = "places-mode"
    const val LIST = "places-list"
    const val FIND = "places-find"
    const val TOWN_DIVIDER = "places-town-divider"
    const val GOOGLE_DIVIDER = "places-google-divider"
    const val TOGGLE = "places-toggle"
    const val FOUND = "places-found"
    fun row(index: Int) = "places-row-$index"
    fun bell(index: Int) = "places-bell-$index"
    fun delete(index: Int) = "places-delete-$index"
    fun town(index: Int) = "places-town-$index"
    fun prediction(index: Int) = "places-prediction-$index"
}

/** What S02 needs from the app: the place search, the bundled towns and a new visit's page. */
class PlacesHost(
    val search: PlaceSearch?,
    val towns: suspend () -> TownSearch,
    /** A visit of S02 in [scope], the composition's while the Locations tab shows. */
    val newPage: (CoroutineScope) -> PlacesPage,
)

/** S02's colors (`.search`): the light page and rows, or the dark theme's. */
private class PlacesColors(val page: Color, val row: Color, val border: Color, val text: Color, val button: Color) {
    companion object {
        fun of(theme: Theme) = if (theme == Theme.DARK) PlacesColors(Color(0xFF171717), Color(0xFF1C1C1D), Color(0xFF8F8F8F), Color(0xFFDDDDDD), Color(0xFF3B3B3B))
        else PlacesColors(Color(0xFFF5F5F5), Color.White, Color(0xFFDDDDDD), Color(0xFF444444), Color.White)
    }
}

/**
 * The Locations tab, S02 (tab-search.html, SearchCtrl, #2890), over one visit's [page]:
 * - the header: ☰, the search field (`ion-ios-search`, the input) and 편집, 취소 while searching or 확인 while editing;
 *   a focus on the input enters search mode;
 * - the list: each place in saved order with its label, the current position's glyph, the sky icon, the temperature
 *   and today's minimum and maximum, and the bell of the visit; a disabled current position shows only while editing;
 *   a row tap selects the place ([onSelect], `goPage`), a tap while the keyboard shows only closes it; an added result
 *   is selected already ([onAdded], `goPage`);
 * - edit mode: the current position's switch, a ⊗ on every other row (no confirmation);
 * - search mode: 현재위치로 지역찾기 (at once, also with the keyboard up; its result replaces the others), the bundled towns (10 at a time, more on each scroll) under "powered by TodayWeather",
 *   then Google's predictions, 300 ms after the last change and the latest answer only, or the found position, under
 *   Google's logo; a word without predictions keeps the last ones. With no enabled place the input takes focus.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun rememberPlacesTab(state: AppState, entries: Map<String, WeatherEntry>, theme: Theme, page: PlacesPage, host: PlacesHost, onSelect: (Int) -> Unit,
                      onAdded: () -> Unit, onAlarm: (Int) -> Unit = {}): TabContent {
    val colors = PlacesColors.of(theme)
    var editing by rememberSaveable { mutableStateOf(false) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    val word = field.text.trim()
    var predictions by remember { mutableStateOf<List<Prediction>>(emptyList()) }
    var towns by remember { mutableStateOf<TownPage?>(null) }
    val found by page.found.collectAsState()
    val hasPush by page.hasPush.collectAsState()
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.isImeVisible
    val scroll = rememberScrollState()
    fun clearSearch() {
        field = TextFieldValue("")
        predictions = emptyList()
        towns = null
        page.clearFound()
    }
    // A found position replaces the results, names the search word (`search.word = geoInfo.name`), ends the town pages
    // and scrolls to the top (`OnSearchCurrentPosition`).
    LaunchedEffect(found) {
        val name = (found?.get("name") as? JsonPrimitive)?.content ?: return@LaunchedEffect
        towns = null
        predictions = emptyList()
        field = TextFieldValue(name)
        scroll.scrollTo(0)
    }
    LaunchedEffect(word) {
        if (found != null && word == (found?.get("name") as? JsonPrimitive)?.content) return@LaunchedEffect
        towns = if (word.isEmpty()) null else host.towns().search(word)
        if (word.isEmpty()) {
            predictions = emptyList()
            return@LaunchedEffect
        }
        val search = host.search ?: return@LaunchedEffect
        delay(PREDICTION_DELAY_MS)
        val answer = search.predictions(word)
        if (!answer.isNullOrEmpty()) predictions = answer
    }
    LaunchedEffect(scroll) {
        snapshotFlow { scroll.value }.drop(1).collect {
            val shown = towns ?: return@collect
            if (shown.next < 0) return@collect
            val more = host.towns().search(word, shown.next)
            if (towns === shown) towns = TownPage(shown.towns + more.towns, more.next)
        }
    }
    // `setInputFocus`: with no enabled place the input takes focus after 100 ms.
    LaunchedEffect(Unit) {
        page.open()
        if (PlaceIndex.enabledCount(state.places.map { it.disable }) == 0) {
            delay(100)
            focus.requestFocus()
        }
    }
    LaunchedEffect(page) {
        page.added.collect {
            clearSearch()
            searching = false
            onAdded()
        }
    }
    fun keyboardOnly(): Boolean {
        if (!imeVisible) return false
        keyboard?.hide()
        return true
    }
    val texts = PlaceRows.Texts(stringResource(R.string.LOC_CURRENT), stringResource(R.string.LOC_LOCATION))
    val language = AppLocale.systemTags().firstOrNull().orEmpty()
    val rows = state.places.mapIndexed { i, place ->
        val weather = entries[WeatherRepository.key(place)]?.weather?.get("currentWeather") as? JsonObject
        PlaceRows.row(place.name, place.address, place.currentPosition, place.disable, weather, hasPush.getOrElse(i) { false }, language, texts)
    }
    val images = rememberChartImages()
    return TabContent(
        header = { shell, onMenu ->
            SearchHeader(shell, field, onChange = { value ->
                if (value.text.trim() != field.text.trim()) {
                    editing = false
                    page.clearFound()
                }
                field = value
            }, modeLabel = stringResource(if (editing) R.string.LOC_OK else if (searching) R.string.LOC_CANCEL else R.string.LOC_EDIT),
                focus = focus, onFocus = {
                    editing = false
                    searching = true
                }, onMenu = onMenu, onMode = {
                    when {
                        editing -> editing = false
                        searching -> {
                            searching = false
                            keyboard?.hide()
                            focusManager.clearFocus()
                            clearSearch()
                        }
                        else -> {
                            editing = true
                            clearSearch()
                        }
                    }
                })
        },
        page = {
            // The page starts under the header bar, which the shell draws over it.
            Column(Modifier.fillMaxSize().background(colors.page).verticalScroll(scroll).padding(top = 44.dp)) {
                if (searching) {
                    FindButton(colors) { page.findByLocation() }
                    val shownTowns = towns?.towns.orEmpty()
                    val places = found?.let { listOf((it["address"] as? JsonPrimitive)?.content.orEmpty()) } ?: predictions.map { it.fullText }
                    if (shownTowns.isNotEmpty() || places.isNotEmpty()) {
                        // `.list` 10 dp around, the first item 1 dp up (`margin: -1px`).
                        Column(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 9.dp, bottom = 10.dp)) {
                            var first = true
                            shownTowns.forEachIndexed { i, town ->
                                ResultRow(listOf(town.first, town.second, town.third).joinToString(" "), colors, first, Modifier.testTag(PlacesTags.town(i))) {
                                    if (!keyboardOnly()) page.addTown(town)
                                }
                                first = false
                            }
                            if (shownTowns.isNotEmpty()) {
                                DividerRow(colors, first, Modifier.testTag(PlacesTags.TOWN_DIVIDER)) {
                                    LineText("powered by TodayWeather", line(16.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium))
                                }
                                first = false
                            }
                            places.forEachIndexed { i, text ->
                                val tag = if (found != null) PlacesTags.FOUND else PlacesTags.prediction(i)
                                ResultRow(text, colors, first, Modifier.testTag(tag)) {
                                    if (keyboardOnly()) return@ResultRow
                                    if (found != null) page.addFound() else predictions.getOrNull(i)?.let { page.addPrediction(it.fullText, it.firstMatch, word) }
                                }
                                first = false
                            }
                            if (places.isNotEmpty()) DividerRow(colors, first, Modifier.testTag(PlacesTags.GOOGLE_DIVIDER), Color(0xFF222222)) { GoogleLogo() }
                        }
                    }
                } else {
                    Column(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 9.dp, bottom = 10.dp).testTag(PlacesTags.LIST)) {
                        var first = true
                        rows.forEachIndexed { i, row ->
                            if (row.disabled && !editing) return@forEachIndexed
                            PlaceRowItem(row, theme, images, colors, first, editing, Modifier.testTag(PlacesTags.row(i)),
                                onSelect = { if (!editing && !keyboardOnly()) onSelect(i) },
                                onBell = { onAlarm(i) },
                                onSwitch = { on -> page.setCurrentPosition(on) },
                                onDelete = { page.delete(i) }, index = i)
                            first = false
                        }
                    }
                }
            }
        },
    )
}

/**
 * The header (`p.title.search-header`): ☰, then from 50 dp the `#eee` field with 4 dp corners (`ion-ios-search` 14 sp
 * `#444`, the input in 17 sp, the placeholder `#aaa`) and the mode button (17 sp, 8 dp at its sides) 10 dp from the edge.
 */
@Composable
private fun SearchHeader(colors: ShellColors, field: TextFieldValue, onChange: (TextFieldValue) -> Unit, modeLabel: String, focus: FocusRequester,
                         onFocus: () -> Unit, onMenu: () -> Unit, onMode: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(44.dp).background(colors.headerBar).drawBehind {
        val h = 0.5.dp.toPx()
        drawRect(colors.headerLine, Offset(0f, size.height - h), Size(size.width, h))
    }) {
        Box(Modifier.padding(start = 5.dp)) { BarButton(Glyphs.NAVICON, colors, onMenu, Modifier.testTag(ShellTags.MENU_BUTTON)) }
        Row(Modifier.fillMaxWidth().padding(start = 50.dp, end = 10.dp, top = 5.dp).height(33.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).height(33.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFFEEEEEE)).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon { LineText(Glyphs.IOS_SEARCH, line(14.sp, TextUnit.Unspecified, Color(0xFF444444), family = Glyphs.ionicons)) }
                Spacer(Modifier.width(4.dp))
                val style = line(17.sp, TextUnit.Unspecified, Color(0xFF111111))
                BasicTextField(field, onChange, Modifier.weight(1f).focusRequester(focus).onFocusChanged { if (it.isFocused) onFocus() }
                    .testTag(PlacesTags.INPUT), singleLine = true, textStyle = style, cursorBrush = SolidColor(Color(0xFF111111)),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (field.text.isEmpty()) LineText(stringResource(R.string.LOC_ENTER_CITY), style.copy(color = Color(0xFFAAAAAA)))
                            inner()
                        }
                    })
            }
            Spacer(Modifier.width(10.67.dp))
            Box(Modifier.height(33.dp).clickable(onClick = onMode).padding(horizontal = 9.dp).testTag(PlacesTags.MODE), contentAlignment = Alignment.Center) {
                FixedLine(32.dp) { LineText(modeLabel, line(17.sp, TextUnit.Unspecified, colors.headerText)) }
            }
        }
    }
}

/** `button` 현재위치로 지역찾기: full width, 10 dp in, `#ddd` border with 4 dp corners, bold 17 sp on a 42 dp line. */
@Composable
private fun FindButton(colors: PlacesColors, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 10.dp).height(47.dp).clip(RoundedCornerShape(4.dp))
        .background(colors.button).border(1.dp, colors.border, RoundedCornerShape(4.dp)).clickable(onClick = onClick).testTag(PlacesTags.FIND),
        contentAlignment = Alignment.Center) {
        FixedLine(42.dp) { CssText(chromeRuns(stringResource(R.string.LOC_FIND_BY_LOCATION)), line(17.sp, TextUnit.Unspecified, colors.text, FontWeight.Bold), maxLines = 1) }
    }
}

/** An `.item` of the list: 1 dp borders shared with the item above it, white, the content 16 dp in. */
@Composable
private fun Item(colors: PlacesColors, first: Boolean, modifier: Modifier, background: Color = colors.row, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().background(background).drawBehind {
        val w = 1.dp.toPx()
        if (first) drawRect(colors.border, Offset.Zero, Size(size.width, w))
        drawRect(colors.border, Offset(0f, size.height - w), Size(size.width, w))
        drawRect(colors.border, Offset.Zero, Size(w, size.height))
        drawRect(colors.border, Offset(size.width - w, 0f), Size(w, size.height))
    }.padding(start = 17.dp, end = 17.dp, top = if (first) 17.dp else 16.dp, bottom = 17.dp)) { content() }
}

/** A search result: its text in bold 17 sp on one line (`.search-item`). */
@Composable
private fun ResultRow(text: String, colors: PlacesColors, first: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Item(colors, first, modifier.clickable(onClick = onClick)) {
        CssText(chromeRuns(text), line(17.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium), maxLines = 1)
    }
}

/** `.item.item-divider`: `#f5f5f5`, 8 dp above and below. */
@Composable
private fun DividerRow(colors: PlacesColors, first: Boolean, modifier: Modifier, text: Color = colors.text, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().background(Color(0xFFF5F5F5)).drawBehind {
        val w = 1.dp.toPx()
        if (first) drawRect(colors.border, Offset.Zero, Size(size.width, w))
        drawRect(colors.border, Offset(0f, size.height - w), Size(size.width, w))
        drawRect(colors.border, Offset.Zero, Size(w, size.height))
        drawRect(colors.border, Offset(size.width - w, 0f), Size(w, size.height))
    }.padding(start = 17.dp, end = 17.dp, top = if (first) 9.dp else 8.dp, bottom = 9.dp).heightIn(min = 19.dp), contentAlignment = Alignment.CenterStart) {
        content()
    }
}

/**
 * A place: the name cell (40 % with a temperature, else the free width; bold 17 sp on one line, the current position's
 * `location_on`), the sky icon (48 dp), the temperature (17 sp) over today's minimum and maximum (12 sp), and a 48 dp
 * cell with the bell, or in edit mode the current position's switch or ⊗.
 */
@Composable
private fun PlaceRowItem(row: PlaceRow, theme: Theme, images: ChartImages, colors: PlacesColors, first: Boolean,
                         editing: Boolean, modifier: Modifier, onSelect: () -> Unit, onBell: () -> Unit, onSwitch: (Boolean) -> Unit, onDelete: () -> Unit,
                         index: Int) {
    val temperature = row.temperature != null
    val height: Dp = when {
        temperature -> 48.dp
        editing && row.currentPosition -> 36.5.dp
        else -> 33.dp
    }
    Item(colors, first, modifier) {
        Row(Modifier.fillMaxWidth().height(height)) {
            val name = Modifier.clickable(onClick = onSelect)
            Box((if (temperature) name.fillMaxWidth(0.4f) else name.weight(1f)).fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
                val style = line(17.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // The glyph sits 3 dp left and 2 dp low of its place, and its -4 dp letter spacing pulls the name in.
                    if (row.currentPosition) {
                        Icon { LineText(LOCATION_ON, line(17.sp, TextUnit.Unspecified, colors.text, family = Glyphs.materialIcons), Modifier.offset((-3).dp, 2.dp)) }
                    }
                    Box(if (row.currentPosition) Modifier.offset((-4).dp) else Modifier) { Label(row.lines, style) }
                }
            }
            if (temperature) {
                Box(Modifier.width(48.dp).clickable(onClick = onSelect), contentAlignment = Alignment.Center) {
                    images["${theme.weather}/${row.skyIcon}.png"]?.let {
                        Image(it, null, Modifier.size(48.dp), contentScale = ContentScale.FillBounds, filterQuality = FilterQuality.High)
                    }
                }
                // `<span>t1h˚</span><br><span 12px>min˚/max˚</span>` on the cell's 17 px lines, from its top.
                Column(Modifier.weight(1f).clickable(onClick = onSelect), horizontalAlignment = Alignment.CenterHorizontally) {
                    val strut = line(17.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium)
                    CssText(chromeRuns(row.temperature.orEmpty()), strut, maxLines = 1)
                    CssText(chromeRuns(row.minMax.orEmpty()), line(12.sp, TextUnit.Unspecified, colors.text, FontWeight.Medium), strut = strut, maxLines = 1)
                }
            }
            Box(Modifier.width(48.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                when {
                    !editing -> Box(Modifier.clickable(onClick = onBell).testTag(PlacesTags.bell(index))) {
                        Icon { LineText(if (row.hasPush) Glyphs.NOTIFICATIONS else Glyphs.NOTIFICATIONS_NONE, line(28.sp, 28.sp, colors.text, family = Glyphs.ionicons)) }
                    }
                    row.currentPosition -> IonicToggle(!row.disabled, onSwitch, Modifier.testTag(PlacesTags.TOGGLE))
                    else -> Box(Modifier.clickable(onClick = onDelete).testTag(PlacesTags.delete(index))) {
                        Icon { LineText(Glyphs.IOS_CLOSE_OUTLINE, line(28.sp, 28.sp, colors.text, FontWeight.Bold, family = Glyphs.ionicons)) }
                    }
                }
            }
        }
    }
}

/** The label lines, the first on the row, a second under it (`<br>`), each on one line ending in an ellipsis. */
@Composable
private fun Label(lines: List<String>, style: TextStyle) {
    Column { lines.take(2).forEach { CssText(chromeRuns(it), style, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
}


private const val PREDICTION_DELAY_MS = 300L

/** Material Icons `location_on`. */
private const val LOCATION_ON = ""
