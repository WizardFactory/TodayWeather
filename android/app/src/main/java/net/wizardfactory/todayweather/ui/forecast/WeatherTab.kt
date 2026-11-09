package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import android.content.Intent
import android.graphics.Point
import android.net.Uri
import android.os.Build
import android.view.WindowManager
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.forecast.ForecastScope
import net.wizardfactory.todayweather.core.domain.forecast.ForecastType
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.forecast.PageUnits
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.forecast.PollenRow
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.OutlinedText
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.line

/** What the weather tabs need from the app: texts, photos, and what their buttons and gestures do. */
class WeatherTabHost(
    val texts: ChartTexts,
    val photos: PhotoLoader,
    /** Reads a place's cached weather into the repository (a cold start shows it while it loads). */
    val readCache: suspend (Place) -> Unit,
    val onPrevious: () -> Unit,
    val onNext: () -> Unit,
    /** Saves `expandShortChart`. */
    val onExpand: (Boolean) -> Unit,
    /** The selected place's alarms (AN-14). */
    val onBell: () -> Unit = {},
    /** Sharing the weather (AN-16). */
    val onShare: () -> Unit = {},
    /** `switchToLocationSettings`: only acts when location is off. */
    val onLocationGlyph: () -> Unit = {},
    val locationEnabled: () -> Boolean = { true },
)

object WeatherTabTags {
    const val LOCATION = "weather-location"
    const val SPINNER = "weather-spinner"
    const val BELL = "weather-bell"
    const val SHARE = "weather-share"
    const val POLLEN_DIALOG = "weather-pollen-dialog"
    const val SOURCE_DIALOG = "weather-source-dialog"
}

/**
 * The Hourly or Daily tab (#2887): a visit of ForecastCtrl's scope, new each time the tab opens, that applies the
 * selected place's record whenever it changes (a swipe, a load, the cache) and on each of TabCtrl's `applyEvent`s
 * ([applies]: a load starting, the gate included, or a response applied), as ForecastCtrl did; the page, its title
 * with the current position's location glyph or the loading spinner, the bell and share buttons, and the pollen and
 * forecast-source popups. The air elements open S05 on their pollutant ([onAirInfo], `goAirInfoPage`) and the
 * standard opens S07 ([onUnits], `goUnitsPage`). The visit reads the temperature unit and the theme as it applies, as
 * ForecastCtrl did, so a change on the settings pages over it shows in the next apply.
 */
@Composable
fun rememberWeatherTab(tab: Tab, state: AppState, entries: Map<String, WeatherEntry>, loading: Set<String>, theme: Theme,
                       host: WeatherTabHost, onAirInfo: (String) -> Unit = {}, onUnits: () -> Unit = {}, applies: Int = 0): TabContent {
    val type = if (tab == Tab.DAILY) ForecastType.MID else ForecastType.SHORT
    val metrics = rememberScreenMetrics()
    val texts = host.texts
    val visit = remember(tab, metrics) {
        ForecastScope(type, metrics, state.units.temperatureUnit == "F", theme == Theme.PHOTO,
            YesterdayText(texts["LOC_SAME_AS_YESTERDAY"], texts["LOC_THAN_YESTERDAY"]), state.expandShortChart)
    }
    // `Units.getUnit('temperatureUnit')` and `settingsInfo.theme` as ForecastCtrl reads them.
    visit.fahrenheit = state.units.temperatureUnit == "F"
    visit.photoTheme = theme == Theme.PHOTO
    val index = state.placeIndex
    val place = state.places.getOrNull(index)
    LaunchedEffect(place) { place?.let { host.readCache(it) } }
    val entry = place?.let { entries[WeatherRepository.key(it)] }
    val record = remember(place, entry) { place?.let { cityRecord(it, entry) } }
    val hasPush = remember(state.push, index) { hasPushInfo(state, index) }
    val opened = remember(visit) { BooleanArray(1) }
    // The apply is the visit's own state, so it runs while composing, before the page reads it. A load starting applies
    // the place as it is (`applyEvent` "loadWeatherData"), so a theme chosen on S08 shows the saved photo at once (#2915 F2).
    val applied = remember(visit, record, hasPush, applies) {
        if (!opened[0]) {
            opened[0] = true
            visit.open(record, PlaceIndex.enabledCount(state.places.map { it.disable }), hasPush)
        } else {
            visit.apply(record, hasPush)
        }
        Any()
    }
    val units = state.units
    val page = remember(applied, units, texts) {
        ForecastPage(visit, PageUnits(units.temperatureUnit, units.windSpeedUnit, units.pressureUnit, units.distanceUnit,
            units.precipitationUnit, units.airUnit), texts)
    }
    val chartPlace = visit.chartPlace
    val content = remember(page, chartPlace, metrics) {
        val hourly = chartPlace?.takeIf { type == ForecastType.SHORT && ((it["timeChart"] as? kotlinx.serialization.json.JsonArray)?.size ?: 0) >= 2 }
            ?.let { HourlyChart.build(it, metrics, texts, units.precipitationUnit, units.windSpeedUnit) }
        val daily = chartPlace?.takeIf { type == ForecastType.MID && (it["dayChart"] as? kotlinx.serialization.json.JsonArray)?.isNotEmpty() == true }
            ?.let { DailyChart.build(it, metrics, texts, units.precipitationUnit) }
        WeatherPageContent(type, page, metrics, hourly, daily)
    }
    var expanded by remember(visit) { mutableStateOf(visit.expand) }
    val scroll = remember(visit) { ScrollState(0) }
    val photo = rememberPhoto(visit, (visit.photo as? JsonPrimitive)?.takeIf { it.isString }?.content, host.photos)
    var pollen by remember(visit) { mutableStateOf<List<PollenRow>?>(null) }
    var source by remember(visit) { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val loadingSelected = place != null && WeatherRepository.key(place) in loading
    val onAction: (PageAction) -> Unit = { action ->
        when (action) {
            is PageAction.AirInfo -> onAirInfo(action.code)
            PageAction.Units -> onUnits()
            is PageAction.AirForecastInfo -> if (action.source == "kaq" || action.source == "airkorea") source = action.source
            is PageAction.Pollen -> pollen = action.rows
            is PageAction.Url -> openUrl(context, action.url)
        }
    }
    return TabContent(
        title = page.title,
        afterTitle = { colors ->
            if (page.currentPosition && !loadingSelected) {
                val glyph = if (host.locationEnabled()) LOCATION_ON else LOCATION_OFF
                Icon {
                    OutlinedText(" $glyph", line(19.sp, TextUnit.Unspecified, colors.headerText, family = Glyphs.materialIcons), colors.headerOutline,
                        Modifier.clickable(onClick = host.onLocationGlyph).testTag(WeatherTabTags.LOCATION))
                }
            }
            if (loadingSelected) {
                Spacer(Modifier.width(4.dp))
                Bubbles(Modifier.size(14.dp).testTag(WeatherTabTags.SPINNER))
            }
        },
        actions = { colors ->
            BarButton(if (page.hasPush) Glyphs.NOTIFICATIONS else Glyphs.NOTIFICATIONS_NONE, colors, host.onBell,
                Modifier.testTag(WeatherTabTags.BELL), padding = 4.dp)
            BarButton(Glyphs.SHARE, colors, host.onShare, Modifier.padding(end = 4.dp).testTag(WeatherTabTags.SHARE), padding = 4.dp)
        },
        scrolled = { scroll.value / density },
        page = {
            WeatherPage(content, theme, photo?.first, photo?.second == true, expanded,
                onToggleExpanded = {
                    visit.expand = !visit.expand
                    expanded = visit.expand
                    host.onExpand(visit.expand)
                },
                onPrevious = host.onPrevious, onNext = host.onNext, onAction = onAction, scrollState = scroll)
            pollen?.let { rows -> PollenDialog(rows, texts) { pollen = null } }
            source?.let { s -> SourceDialog(s, texts) { source = null } }
        },
    )
}

/** `Push.hasPushInfo(cityIndex)`: an enabled alarm of the place at [index]. */
internal fun hasPushInfo(state: AppState, index: Int): Boolean =
    state.push.records.any { r -> (r["cityIndex"] as? JsonPrimitive)?.intOrNull == index && r["enable"].let { it is JsonPrimitive && it.content == "true" } }

/**
 * `[photo-url]`: the picture for [url] once it has loaded (with the veil), `img/bg.png` when it fails (without);
 * no URL keeps what was shown.
 */
@Composable
private fun rememberPhoto(visit: ForecastScope, url: String?, photos: PhotoLoader): Pair<ImageBitmap, Boolean>? {
    var shown by remember(visit) { mutableStateOf<Pair<ImageBitmap, Boolean>?>(null) }
    LaunchedEffect(visit, url) {
        if (url == null) return@LaunchedEffect
        shown = photos.load(url)?.let { it to true } ?: photos.fallback()?.let { it to false }
    }
    return shown
}

/** The pollen popup (`showPollenInfo`): each type's grade, what it is and the advice for its grade, and the source. */
@Composable
private fun PollenDialog(rows: List<PollenRow>, texts: ChartTexts, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(texts["LOC_POLLEN_RISK"]) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for (row in rows) {
                    Text("${texts[row.labelKey]}: ${row.gradeLabel}", fontWeight = FontWeight.Bold)
                    Text(texts[row.infoKey])
                    Text(texts[row.adviceKey], Modifier.padding(bottom = 8.dp))
                }
                Text(texts["LOC_POLLEN_SOURCE"], fontSize = 12.sp)
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(texts["LOC_CLOSE"]) } },
        modifier = Modifier.testTag(WeatherTabTags.POLLEN_DIALOG),
    )
}

/** `popUpAirForecastInfo`: what the air forecast source is, with a close button. */
@Composable
internal fun SourceDialog(source: String, texts: ChartTexts, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        text = { Text(texts[if (source == "kaq") "LOC_KAQ_DESCRIPTION" else "LOC_AIRKOREA_DESCRIPTION"]) },
        confirmButton = { TextButton(onClick = onClose) { Text(texts["LOC_CLOSE"]) } },
        modifier = Modifier.testTag(WeatherTabTags.SOURCE_DIALOG),
    )
}

/**
 * The retry confirmation after a failed load (O03, `showRetryConfirm` of type `weather`): 오류, 날씨 정보를 가져오지
 * 못하였습니다, with 닫기 and 확인, which loads again.
 */
@Composable
fun RetryDialog(onClose: () -> Unit, onRetry: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(R.string.LOC_ERROR)) },
        text = { Text(stringResource(R.string.LOC_FAIL_TO_GET_WEATHER_INFO)) },
        dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.LOC_CLOSE)) } },
        confirmButton = { TextButton(onClick = onRetry) { Text(stringResource(R.string.LOC_OK)) } },
        modifier = Modifier.testTag(RETRY_DIALOG),
    )
}

const val RETRY_DIALOG = "weather-retry-dialog"

/**
 * `<ion-spinner icon="bubbles">` in the title: nine dots around a circle, each fading in turn, in white (`.body-content
 * .bar p svg`), which the light theme's white bar hides (A08, kept).
 */
@Composable
internal fun Bubbles(modifier: Modifier) {
    val turn by rememberInfiniteTransition(label = "bubbles").animateFloat(0f, 1f,
        infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "turn")
    Canvas(modifier) {
        val r = size.minDimension / 2
        for (i in 0 until 9) {
            val angle = 2 * PI * i / 9
            val phase = ((turn - i / 9f) % 1f + 1f) % 1f
            drawCircle(Color.White, radius = r * 5 / 32 * (1 - phase), center = Offset(r + (r * 24 / 32 * cos(angle)).toFloat(), r + (r * 24 / 32 * sin(angle)).toFloat()))
        }
    }
}

/** `window.screen` in dp: the display the Cordova app sized its pages by (`initSize`), at the current orientation. */
@Composable
fun rememberScreenMetrics(): ChartMetrics {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    return remember(configuration) { screenMetrics(context) }
}

fun screenMetrics(context: Context): ChartMetrics {
    val density = context.resources.displayMetrics.density
    val (w, h) = if (Build.VERSION.SDK_INT >= 30) {
        context.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds.let { it.width() to it.height() }
    } else {
        @Suppress("DEPRECATION")
        Point().also { context.getSystemService(WindowManager::class.java).defaultDisplay.getRealSize(it) }.let { it.x to it.y }
    }
    return ChartMetrics((w / density).toDouble(), (h / density).toDouble())
}

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** Material Icons `location_on` and `location_off` (tab-forecast.html, `isLocationEnabled()`). */
internal const val LOCATION_ON = ""
internal const val LOCATION_OFF = ""
