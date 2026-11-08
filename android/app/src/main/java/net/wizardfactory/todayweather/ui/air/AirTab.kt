package net.wizardfactory.todayweather.ui.air

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.air.AirPage
import net.wizardfactory.todayweather.core.domain.air.AirScope
import net.wizardfactory.todayweather.core.domain.forecast.PageAction
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.ui.forecast.Bubbles
import net.wizardfactory.todayweather.ui.forecast.LOCATION_OFF
import net.wizardfactory.todayweather.ui.forecast.LOCATION_ON
import net.wizardfactory.todayweather.ui.forecast.SourceDialog
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.forecast.hasPushInfo
import net.wizardfactory.todayweather.ui.forecast.rememberScreenMetrics
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.OutlinedText
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.line

/**
 * The Air tab, S05 (#2888): a visit of AirCtrl's scope, new each time the tab opens, on the pollutant of the link
 * ([code], `?code=`, else the overall index). It applies the selected place's record whenever it changes, and on each
 * of TabCtrl's `applyEvent`s ([applies]: a load starting, the gate included, or a response applied) it returns to
 * the first station first. A detail or station cell selects its pollutant or station and brings the page to the top;
 * the current weather opens S03 ([onWeather]); the standard opens the units page and the forecast source its popup
 * (O08). The title, location glyph (inert on S05, A10), spinner, bell and share are the weather pages'.
 */
@Composable
fun rememberAirTab(state: AppState, entries: Map<String, WeatherEntry>, loading: Set<String>, theme: Theme, host: WeatherTabHost,
                   code: String?, applies: Int, onWeather: () -> Unit): TabContent {
    val metrics = rememberScreenMetrics()
    val texts = host.texts
    val airUnit = state.units.airUnit
    val visit = remember(metrics, airUnit) { AirScope(metrics, airUnit) }
    val index = state.placeIndex
    val place = state.places.getOrNull(index)
    LaunchedEffect(place) { place?.let { host.readCache(it) } }
    val entry = place?.let { entries[WeatherRepository.key(it)] }
    val record = remember(place, entry) { place?.let { cityRecord(it, entry) } }
    val hasPush = remember(state.push, index) { hasPushInfo(state, index) }
    val enabled = PlaceIndex.enabledCount(state.places.map { it.disable })
    // The `applyEvent` count the visit has seen; null until it opened.
    val seen = remember(visit) { arrayOfNulls<Int>(1) }
    // The apply is the visit's own state, so it runs while composing, before the page reads it.
    val applied = remember(visit, record, hasPush, enabled, applies) {
        val last = seen[0]
        seen[0] = applies
        when {
            last == null -> visit.open(record, code, enabled, hasPush)
            last != applies -> visit.applyEvent(record, enabled, hasPush)
            else -> visit.apply(record, enabled, hasPush)
        }
        Any()
    }
    var taps by remember(visit) { mutableIntStateOf(0) }
    val page = remember(applied, taps, texts) { AirPage(visit, texts) }
    val content = remember(page, metrics) { AirContent(page, metrics, visit.airChart, visit.standard, texts["LOC_HOUR"]) }
    val scroll = remember(visit) { ScrollState(0) }
    val scope = rememberCoroutineScope()
    var source by remember(visit) { mutableStateOf<String?>(null) }
    val loadingSelected = place != null && WeatherRepository.key(place) in loading
    // `$ionicScrollDelegate.scrollTop()`: at once, without animation.
    fun toTop() {
        taps++
        scope.launch { scroll.scrollTo(0) }
    }
    return TabContent(
        title = page.title,
        afterTitle = { colors ->
            if (page.currentPosition && !loadingSelected) {
                // `switchToLocationSettings()` is not defined on S05: the glyph does nothing (A10).
                val glyph = if (host.locationEnabled()) LOCATION_ON else LOCATION_OFF
                Icon {
                    OutlinedText(" $glyph", line(19.sp, TextUnit.Unspecified, colors.headerText, family = Glyphs.materialIcons), colors.headerOutline,
                        Modifier.clickable {}.testTag(WeatherTabTags.LOCATION))
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
        page = {
            AirScreen(content, theme, onPrevious = host.onPrevious, onNext = host.onNext,
                onCode = { c ->
                    visit.setCode(c)
                    toTop()
                },
                onStation = { i ->
                    visit.setStation(i)
                    toTop()
                },
                onWeather = onWeather,
                onAction = { action ->
                    when (action) {
                        PageAction.Units -> host.onUnits()
                        is PageAction.AirForecastInfo -> if (action.source == "kaq" || action.source == "airkorea") source = action.source
                        else -> {}
                    }
                },
                scrollState = scroll)
            source?.let { s -> SourceDialog(s, texts) { source = null } }
        },
    )
}
