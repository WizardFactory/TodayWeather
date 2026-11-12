package net.wizardfactory.todayweather.ui.start

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.exclude
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import kotlin.math.roundToInt
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.domain.start.CityShortcut
import net.wizardfactory.todayweather.core.domain.start.CityShortcuts
import net.wizardfactory.todayweather.core.domain.start.Town
import net.wizardfactory.todayweather.core.domain.start.TownPage
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.search.PlaceSearch
import net.wizardfactory.todayweather.search.Prediction
import net.wizardfactory.todayweather.ui.forecast.rememberScreenMetrics
import net.wizardfactory.todayweather.ui.nation.IonicLoading
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.IonicPopup
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.PopupButton
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.line
import net.wizardfactory.todayweather.ui.shell.sides

object StartTags {
    const val PAGE = "start-page"
    const val ICON = "start-icon"
    const val CARD = "start-card"
    const val INPUT = "start-input"
    const val GLYPH = "start-glyph"
    const val CANCEL = "start-cancel"
    const val CHIPS = "start-chips"
    const val ATTRIBUTION = "start-attribution"
    const val LOCATION = "start-location"
    fun chip(index: Int) = "start-chip-$index"
    fun result(index: Int) = "start-result-$index"
}

/** What S01's search shows: Google's predictions, or the bundled towns of a build without a Places key. */
private sealed interface Results {
    data class Predictions(val word: String, val list: List<Prediction>) : Results
    data class Towns(val word: String, val page: TownPage) : Results
}

/**
 * The start page S01 (`/start`, StartCtrl and start.html, #2889) of one [page] visit, which it shows while the startup
 * gate holds: the status bar over the page, the access notice O01, the loading overlay and the popups O04 and O09.
 * Android back leaves the app (Ionic's default, without the tabs' exit confirmation); the overlay holds it, and a popup
 * closes first.
 */
@Composable
fun StartScreen(
    page: StartPage,
    search: PlaceSearch?,
    towns: suspend () -> TownSearch,
    onExit: () -> Unit,
    openAppSettings: () -> Unit,
    openLocationSettings: () -> Unit,
) {
    val notice by page.notice.collectAsState()
    val loading by page.loading.collectAsState()
    val popup by page.popup.collectAsState()
    BackHandler(onBack = onExit)
    Box(Modifier.fillMaxSize().background(Color.White)) {
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(ShellColors.statusBar))
            // The WebView's area, which the keyboard shortens (`adjustResize`).
            Box(Modifier.fillMaxWidth().weight(1f).windowInsetsPadding(WindowInsets.sides)
                .windowInsetsPadding(WindowInsets.ime.exclude(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom))) {
                StartContent(search, towns, onShortcut = page::addShortcut, onPrediction = page::addPrediction, onTown = page::addTown,
                    onLocation = page::useCurrentLocation)
                if (loading) {
                    BackHandler {}
                    IonicLoading()
                }
            }
            Spacer(Modifier.fillMaxWidth().windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
        if (notice) AccessNotice(onClose = page::closeNotice)
        when (val shown = popup) {
            is StartFlow.Outcome.Alert -> IonicAlert(stringResource(R.string.LOC_ERROR), listOf(locationText(shown.message)), stringResource(R.string.LOC_OK),
                onClose = page::closePopup)
            is StartFlow.Outcome.Confirm -> LocationRetryPopup(shown.confirm, onBack = page::closePopup) { button ->
                page.retryButton(button, openAppSettings, openLocationSettings)
            }
            else -> {}
        }
    }
}

/**
 * O01 (`init`): 선택 접근 권한 with what storage, location and call information are used for, and one gray OK. It asks
 * for nothing and saves nothing.
 */
@Composable
fun AccessNotice(onClose: () -> Unit) {
    IonicPopup(stringResource(R.string.LOC_NEEDS_ACCESS_TO),
        listOf(stringResource(R.string.LOC_STORAGE_SPACE), stringResource(R.string.LOC_LOCATION_ACCESS), stringResource(R.string.LOC_CALL_INFORMATION)),
        listOf(PopupButton(stringResource(R.string.LOC_OK), onTap = onClose)), onBack = onClose)
}

/**
 * start.html in the WebView's area: the app icon, the first card with the search box (`ion-search`, the input and,
 * once a word is typed, Cancel) over either the city shortcuts or the search results, and under the shortcuts the
 * second card with 현재위치 날씨보기. Results replace the shortcuts and the button once there are some; a word without
 * results keeps the last ones. Google's predictions come 300 ms after the last change, and only the latest answer
 * shows; without a Places key the bundled towns are searched instead, 10 at a time, with more on each scroll (S02's
 * scan). A result tapped while the keyboard shows only closes the keyboard.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StartContent(
    search: PlaceSearch?,
    towns: suspend () -> TownSearch,
    onShortcut: (CityShortcut) -> Unit,
    onPrediction: (Prediction, String) -> Unit,
    onTown: (Town) -> Unit,
    onLocation: () -> Unit,
) {
    val context = LocalContext.current
    val metrics = rememberScreenMetrics()
    val shortcuts = remember(metrics.bodyHeight) { CityShortcuts.forScreenHeight(metrics.bodyHeight) }
    val icon = remember(context) { runCatching { context.assets.open(ICON).use { BitmapFactory.decodeStream(it).asImageBitmap() } }.getOrNull() }
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    // `ng-model` trims, and an empty word is none.
    val word = field.text.trim()
    var results by remember { mutableStateOf<Results?>(null) }
    val keyboard = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.isImeVisible
    val scroll = rememberScrollState()
    LaunchedEffect(word) {
        if (word.isEmpty()) {
            results = null
            return@LaunchedEffect
        }
        if (search != null) {
            delay(PREDICTION_DELAY_MS)
            val found = search.predictions(word)
            if (!found.isNullOrEmpty()) results = Results.Predictions(word, found)
        } else {
            val page = towns().search(word)
            if (page.towns.isNotEmpty()) results = Results.Towns(word, page)
        }
    }
    // `OnScrollResults`: each scroll of the page brings the next towns.
    LaunchedEffect(scroll) {
        snapshotFlow { scroll.value }.drop(1).collect {
            val shown = results as? Results.Towns ?: return@collect
            if (shown.page.next < 0) return@collect
            val more = towns().search(shown.word, shown.page.next)
            if (results === shown) results = Results.Towns(shown.word, TownPage(shown.page.towns + more.towns, more.next))
        }
    }
    fun select(add: () -> Unit) {
        if (imeVisible) {
            keyboard?.hide()
            return
        }
        field = TextFieldValue("")
        results = null
        add()
    }
    val shown = results
    Column(Modifier.fillMaxSize().background(Color.White).verticalScroll(scroll).testTag(StartTags.PAGE)) {
        Spacer(Modifier.height(24.dp))
        icon?.let {
            Image(it, null, Modifier.size(96.dp).align(Alignment.CenterHorizontally).testTag(StartTags.ICON), contentScale = ContentScale.FillBounds,
                filterQuality = FilterQuality.High)
        }
        Spacer(Modifier.height(20.dp))
        // .list.list-inset: 10 dp from the sides; its items' 1 dp borders overlap, so lines of #ddd frame and divide them.
        Column(Modifier.padding(horizontal = 10.dp).fillMaxWidth().clip(CARD).background(Color.White).border(1.dp, BORDER, CARD).testTag(StartTags.CARD)
            .padding(1.dp)) {
            SearchRow(field, onChange = { field = it }, onCancel = {
                field = TextFieldValue("")
                results = null
            })
            Box(Modifier.fillMaxWidth().height(1.dp).background(BORDER))
            when (shown) {
                null -> ShortcutFlow(shortcuts.map { it.name }, Modifier.fillMaxWidth().padding(8.dp).testTag(StartTags.CHIPS)) { i ->
                    onShortcut(shortcuts[i])
                }
                is Results.Predictions -> {
                    shown.list.forEachIndexed { i, prediction ->
                        ResultRow(prediction.fullText, Modifier.testTag(StartTags.result(i))) { select { onPrediction(prediction, shown.word) } }
                    }
                    Divider { GoogleLogo() }
                }
                is Results.Towns -> {
                    shown.page.towns.forEachIndexed { i, town ->
                        ResultRow(listOf(town.first, town.second, town.third).filter { it.isNotEmpty() }.joinToString(" "), Modifier.testTag(StartTags.result(i))) {
                            select { onTown(town) }
                        }
                    }
                    Divider { LineText("powered by TodayWeather", line(16.sp, TextUnit.Unspecified, Color(0xFF222222), FontWeight.Medium)) }
                }
            }
        }
        if (shown == null) {
            Spacer(Modifier.height(20.dp))
            Box(Modifier.fillMaxWidth().padding(horizontal = 10.dp).padding(vertical = 1.dp), contentAlignment = Alignment.Center) {
                OutlineButton(stringResource(R.string.LOC_USE_YOUR_CURRENT_LOCATION), Modifier.testTag(StartTags.LOCATION), onClick = onLocation)
            }
        }
    }
}

/**
 * `.item.item-input` with `.start`'s 16 dp at the right: the gray `ion-search` glyph, 6 dp, then the input (14 sp
 * `#111` centered, the placeholder `#aaa` on a 16 dp line, 44 dp kept free at its end) and, while a word is typed, the
 * `button-icon` Cancel (16 sp `#444`, 6 dp at its sides).
 */
@Composable
private fun SearchRow(field: TextFieldValue, onChange: (TextFieldValue) -> Unit, onCancel: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(45.dp).padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon { LineText(Glyphs.SEARCH, line(16.sp, TextUnit.Unspecified, PLACEHOLDER, family = Glyphs.ionicons), Modifier.testTag(StartTags.GLYPH)) }
        Spacer(Modifier.width(6.dp))
        // The font's own line, centered: a Korean word keeps the Latin font's baseline, as Chrome draws a fallback font.
        val style = line(14.sp, TextUnit.Unspecified, Color(0xFF111111))
        BasicTextField(field, onChange, Modifier.weight(1f).testTag(StartTags.INPUT), singleLine = true, textStyle = style,
            cursorBrush = SolidColor(Color(0xFF111111)), decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().padding(end = 44.dp), contentAlignment = Alignment.CenterStart) {
                    if (field.text.isEmpty()) FixedLine(16.dp) { LineText(stringResource(R.string.LOC_ENTER_CITY), style.copy(color = PLACEHOLDER)) }
                    inner()
                }
            })
        if (field.text.trim().isNotEmpty()) {
            Box(Modifier.clickable(onClick = onCancel).padding(horizontal = 7.dp).testTag(StartTags.CANCEL)) {
                LineText(stringResource(R.string.LOC_CANCEL), line(16.sp, TextUnit.Unspecified, Color(0xFF444444)))
            }
        }
    }
}

/**
 * `.button.button-outline.button-positive`: the label in bold 15 sp `#387ef5` on a 42 dp line, 12 dp from a 1 dp
 * border of the same blue with 4 dp corners, at least 47 dp high.
 */
@Composable
private fun OutlineButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.heightIn(min = 47.dp).clip(BUTTON).border(1.dp, POSITIVE, BUTTON).clickable(onClick = onClick).padding(horizontal = 13.dp),
        contentAlignment = Alignment.Center) {
        FixedLine(42.dp) { LineText(text, BUTTON_LABEL) }
    }
}

/**
 * The shortcuts as Chrome flows their inline-block buttons: each as wide as its label at the label's fractional width
 * plus 26 dp, with 4 dp around it, the next line starting where a button does not fit; each edge on the device pixel
 * nearest its position, so that the widths do not add up rounding as whole-pixel boxes would.
 */
@Composable
private fun ShortcutFlow(names: List<String>, modifier: Modifier, onTap: (Int) -> Unit) {
    val measurer = rememberTextMeasurer()
    val widths = remember(names, measurer) {
        names.map { name -> measurer.measure(name, BUTTON_LABEL).multiParagraph.let { it.getLineRight(0) - it.getLineLeft(0) } }
    }
    Layout(content = {
        names.forEachIndexed { i, name -> OutlineButton(name, Modifier.testTag(StartTags.chip(i))) { onTap(i) } }
    }, modifier = modifier) { measurables, constraints ->
        val px = density
        val available = constraints.maxWidth / px
        var x = 0f
        var y = 0f
        val boxes = widths.map { labelPx ->
            val width = labelPx / px + 26f
            if (x > 0f && x + width + 8f > available) {
                x = 0f
                y += 55f
            }
            val left = x + 4f
            x += width + 8f
            Triple(left, y + 4f, width)
        }
        val placeables = measurables.zip(boxes).map { (m, box) ->
            val start = (box.first * px).roundToInt()
            m.measure(Constraints.fixed((box.first + box.third).times(px).roundToInt() - start, (47f * px).roundToInt()))
        }
        val height = if (boxes.isEmpty()) 0 else ((y + 55f) * px).roundToInt()
        layout(constraints.maxWidth, height) {
            placeables.zip(boxes).forEach { (p, box) -> p.place((box.first * px).roundToInt(), (box.second * px).roundToInt()) }
        }
    }
}

/** A result row (`.item` with 8 dp around): its text in 16 sp `#444`, a #ddd line under it. */
@Composable
private fun ResultRow(text: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().padding(8.dp)) { LineText(text, line(16.sp, TextUnit.Unspecified, Color(0xFF444444)), maxLines = Int.MAX_VALUE) }
        Box(Modifier.fillMaxWidth().height(1.dp).background(BORDER))
    }
}

/** `.item.item-divider` under the results: `#f5f5f5`, 8 dp above and below, 16 dp at the sides, at least 30 dp. */
@Composable
private fun Divider(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 30.dp).background(Color(0xFFF5F5F5)).padding(horizontal = 16.dp, vertical = 8.dp).testTag(StartTags.ATTRIBUTION),
        contentAlignment = Alignment.CenterStart) { content() }
}

/** `img/powered_by_google_on_white.png` at 144 dp wide. */
@Composable
internal fun GoogleLogo() {
    val context = LocalContext.current
    val logo: ImageBitmap? = remember(context) {
        runCatching { context.assets.open(GOOGLE_LOGO).use { BitmapFactory.decodeStream(it).asImageBitmap() } }.getOrNull()
    }
    logo?.let { Image(it, "powered by Google", Modifier.width(144.dp).height((144f * it.height / it.width).dp), contentScale = ContentScale.FillBounds) }
}

private const val ICON = "img/app_icon.png"
private const val GOOGLE_LOGO = "img/powered_by_google_on_white.png"
private const val PREDICTION_DELAY_MS = 300L
private val CARD = RoundedCornerShape(2.dp)
private val BUTTON = RoundedCornerShape(4.dp)
private val BORDER = Color(0xFFDDDDDD)
private val POSITIVE = Color(0xFF387EF5)
private val PLACEHOLDER = Color(0xFFAAAAAA)
private val BUTTON_LABEL = line(15.sp, TextUnit.Unspecified, POSITIVE, FontWeight.Bold)
