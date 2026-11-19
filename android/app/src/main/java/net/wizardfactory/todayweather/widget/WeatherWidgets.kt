package net.wizardfactory.todayweather.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.widget.RemoteViews
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.compose.ui.graphics.toArgb
import androidx.glance.ColorFilter
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.layout.size
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.height
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.width
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import java.text.DateFormat
import java.util.Date
import java.util.Calendar
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.AppLocale
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.TodayWeatherApp
import net.wizardfactory.todayweather.core.domain.YesterdayText

internal enum class Kind { CURRENT, FORECAST, CLOCK, AIR }
private val revisionKey = longPreferencesKey("weatherRevision")

/** Invalidating state also refreshes Glance sessions that are still alive when the worker finishes. */
internal suspend fun redrawWidget(context: Context, id: Int) {
    val provider = AppWidgetManager.getInstance(context).getAppWidgetInfo(id)?.provider ?: return
    val kind = when (provider.className) {
        CurrentReceiver::class.java.name -> Kind.CURRENT
        ForecastReceiver::class.java.name -> Kind.FORECAST
        ClockReceiver::class.java.name -> Kind.CLOCK
        AirReceiver::class.java.name -> Kind.AIR
        else -> return
    }
    val glanceId = GlanceAppWidgetManager(context).getGlanceIdBy(id)
    updateAppWidgetState(context, glanceId) { it[revisionKey] = (it[revisionKey] ?: 0L) + 1 }
    WeatherWidget(kind).update(context, glanceId)
}

abstract class WeatherReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, manager, appWidgetIds)
        WidgetRefresh.enqueue(context)
    }
    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        appWidgetIds.forEach { WidgetOptions.remove(context, it) }
        super.onDeleted(context, appWidgetIds)
    }
}
class CurrentReceiver : WeatherReceiver() { override val glanceAppWidget: GlanceAppWidget = WeatherWidget(Kind.CURRENT) }
class ForecastReceiver : WeatherReceiver() { override val glanceAppWidget: GlanceAppWidget = WeatherWidget(Kind.FORECAST) }
class ClockReceiver : WeatherReceiver() { override val glanceAppWidget: GlanceAppWidget = WeatherWidget(Kind.CLOCK) }
class AirReceiver : WeatherReceiver() { override val glanceAppWidget: GlanceAppWidget = WeatherWidget(Kind.AIR) }

internal data class Display(
    val placeKey: String? = null, val title: String = "", val daily: Boolean = false, val yesterday: Boolean = false,
    val style: WidgetStyle = WidgetStyle.CLASSIC, val readings: WidgetReadings? = null, val updated: String = "", val shortTime: String = "", val message: Int? = null,
    val manualRefresh: Boolean = false,
)

private suspend fun loadDisplay(context: Context, id: Int): Display {
    val options = WidgetOptions.read(context, id)
    if (!WidgetAccess.allowed(context)) return Display(options.placeKey, style = options.style, message = R.string.widget_display_expired)
    val app = context.applicationContext as TodayWeatherApp
    val state = app.appState.state.filterNotNull().first()
    val place = WidgetOptions.resolve(state, options.placeKey) ?: return Display(style = options.style, message = R.string.widget_display_no_place)
    val entry = app.weather.cachedForWidget(place)
    val title = place.name?.takeIf(String::isNotBlank) ?: place.address ?: context.getString(R.string.app_name)
    if (entry == null) return Display(WidgetOptions.key(place), title, style = options.style, message = R.string.widget_display_no_weather,
        manualRefresh = options.manualRefresh)
    val labels = YesterdayText(context.getString(R.string.LOC_SAME_AS_YESTERDAY), context.getString(R.string.LOC_THAN_YESTERDAY))
    val loaded = Date(entry.loadedAt)
    val time = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(loaded)
    val today = Calendar.getInstance()
    val day = Calendar.getInstance().apply { timeInMillis = entry.loadedAt }
    val sameDay = today.get(Calendar.YEAR) == day.get(Calendar.YEAR) && today.get(Calendar.DAY_OF_YEAR) == day.get(Calendar.DAY_OF_YEAR)
    val shortTime = if (sameDay) android.text.format.DateFormat.getTimeFormat(context).format(loaded)
        else android.text.format.DateFormat.format("MM/dd", loaded).toString()
    return Display(WidgetOptions.key(place), title, options.daily, options.yesterday, options.style,
        WidgetReadings(entry.weather, entry.temperatureUnit, labels), time, shortTime, manualRefresh = options.manualRefresh)
}

private class WeatherWidget(private val kind: Kind) : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(48.dp, 50.dp), DpSize(130.dp, 50.dp),
        DpSize(245.dp, 50.dp), DpSize(130.dp, 100.dp),
        DpSize(245.dp, 100.dp), DpSize(130.dp, 150.dp), DpSize(200.dp, 150.dp),
        DpSize(245.dp, 150.dp), DpSize(300.dp, 150.dp), DpSize(245.dp, 218.dp), DpSize(300.dp, 218.dp),
        DpSize(245.dp, 270.dp), DpSize(300.dp, 270.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val localized = AppLocale.wrap(context)
        val widgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
        provideContent {
            val revision = currentState<Preferences>()[revisionKey]
            key(revision) {
                val display by produceState<Display?>(null) { value = loadDisplay(localized, widgetId) }
                val shown = if (WidgetAccess.allowed(context)) display else WidgetOptions.read(context, widgetId).let {
                    Display(it.placeKey, style = it.style, message = R.string.widget_display_expired)
                }
                Panel(localized, kind, shown)
            }
        }
    }
}

private val localStyle = staticCompositionLocalOf { WidgetStyle.CLASSIC }
private val primary: ColorProvider @Composable get() = ColorProvider(localStyle.current.ink)
private val secondary: ColorProvider @Composable get() = ColorProvider(localStyle.current.muted)

@Composable
private fun Label(value: String, size: Int, color: ColorProvider = primary, lines: Int = 1, bold: Boolean = false, align: TextAlign = TextAlign.Start) {
    if (value.isNotBlank()) Text(value, maxLines = lines, style = TextStyle(fontSize = size.sp, color = color, textAlign = align,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal))
}

@Composable
internal fun Panel(context: Context, kind: Kind, data: Display?) {
    CompositionLocalProvider(localStyle provides (data?.style ?: WidgetStyle.CLASSIC)) {
        StyledPanel(context, kind, data)
    }
}

@Composable
private fun StyledPanel(context: Context, kind: Kind, data: Display?) {
    val style = localStyle.current
    val size = LocalSize.current
    val compact = size.width < 130.dp
    val wide = size.width >= 245.dp
    val roomy = size.height >= 150.dp
    val strip = size.height < 100.dp
    val action = actionStartActivity(WidgetOptions.openIntent(context, data?.placeKey))
    val frame = GlanceModifier.fillMaxSize().cornerRadius(if (style == WidgetStyle.BLUE) 24.dp else 17.dp).background(style.background).clickable(action)
        .padding(horizontal = when { compact -> 3.dp; wide -> 16.dp; else -> 10.dp },
            vertical = when { strip -> 1.dp; roomy -> 12.dp; else -> 6.dp })
    if (data == null || data.message != null) {
        val message = when {
            data == null -> R.string.app_name
            data.message == R.string.widget_display_expired && compact -> R.string.widget_display_expired_compact
            data.message == R.string.widget_display_expired && !wide && !strip -> R.string.widget_display_expired_card
            else -> data.message ?: R.string.app_name
        }
        Box(frame, contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (data?.manualRefresh == true && message == R.string.widget_display_no_weather) {
                    if (!compact && !strip) Label(data.title, 14, bold = true)
                    RefreshStamp(context, data)
                    return@Column
                }
                Label(context.getString(message), when { compact -> 12; wide -> 19; else -> 16 },
                    lines = if (strip) 3 else 5, bold = true, align = TextAlign.Center)
                if (wide && roomy && data?.message == R.string.widget_display_expired) {
                    Box(GlanceModifier.padding(top = 9.dp)) {
                        Box(GlanceModifier.cornerRadius(14.dp).background(style.surface).padding(horizontal = 12.dp, vertical = 4.dp)) {
                            Label(context.getString(R.string.widget_style_open), 13, bold = true)
                        }
                    }
                }
            }
        }
        return
    }
    val weather = data.readings ?: return
    Column(frame, verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = if (compact) Alignment.CenterHorizontally else Alignment.Start) {
        if (compact) {
            Label(data.title, 10, primary, bold = true)
            Label(weather.compact.ifEmpty { "–" }, 13, bold = true)
            RefreshStamp(context, data)
            return@Column
        }
        if (strip) {
            Strip(context, kind, data, weather, wide)
            return@Column
        }
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(GlanceModifier.defaultWeight()) { Label(data.title, if (roomy) 15 else 13, bold = true) }
            RefreshStamp(context, data)
        }
        Column(GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
            when (kind) {
                Kind.CURRENT -> {
                    val center = if (style == WidgetStyle.BLUE) Alignment.Start else Alignment.CenterHorizontally
                    Column(GlanceModifier.fillMaxWidth().defaultWeight(), horizontalAlignment = center, verticalAlignment = Alignment.CenterVertically) {
                        val surround = if (style == WidgetStyle.PAPER) GlanceModifier.cornerRadius(12.dp).background(style.surface)
                            .padding(horizontal = 6.dp, vertical = 3.dp) else GlanceModifier
                        Row(surround, verticalAlignment = Alignment.CenterVertically) {
                            Reading(weather, if (wide) 33 else 24, if (roomy) 42 else 26)
                        }
                        if (roomy) Label(weather.condition, 14, secondary)
                    }
                    Column(GlanceModifier.fillMaxWidth(), horizontalAlignment = center) {
                        Label(weather.days.find { it.offset == 0 }?.value.orEmpty(), if (roomy) 17 else 14)
                        if (data.yesterday) {
                            Label(weather.comparison, 13, secondary)
                            if (wide && roomy) weather.days.find { it.offset == -1 }?.let {
                                Label(context.getString(R.string.LOC_YESTERDAY) + " " + it.value, 14, secondary)
                            }
                        } else if (roomy) Label(weather.airGrade, 12, secondary)
                    }
                }
                Kind.CLOCK -> {
                    if (wide) {
                        Row(GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                            if (style == WidgetStyle.BLUE) WeatherBlock(weather, roomy, wide)
                            Column(GlanceModifier.defaultWeight(), horizontalAlignment = if (style == WidgetStyle.BLUE) Alignment.End else Alignment.Start) {
                                if (roomy) Label(android.text.format.DateFormat.getMediumDateFormat(context).format(Date()), 12, secondary)
                                Clock(context, when { !roomy -> 19; style == WidgetStyle.BLUE -> 23; size.width < 300.dp -> 25; else -> 31 },
                                    alignEnd = style == WidgetStyle.BLUE)
                            }
                            if (style != WidgetStyle.BLUE) WeatherBlock(weather, roomy, wide)
                        }
                        Cells(context, weather, data.daily, data.yesterday, true, inlineIcon = !roomy, dense = true)
                        if (size.height >= 270.dp) Cells(context, weather, !data.daily, data.yesterday, true, dense = true)
                    } else {
                        Clock(context, if (roomy) 25 else 18)
                        Row(verticalAlignment = Alignment.CenterVertically) { Reading(weather, if (roomy) 20 else 15, 28) }
                    }
                }
                Kind.FORECAST -> {
                    if (roomy) Row(verticalAlignment = Alignment.CenterVertically) { Reading(weather, 20, 25) }
                    Cells(context, weather, data.daily, data.yesterday, wide, dense = !roomy)
                }
                Kind.AIR -> {
                    Column(GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                        if (roomy) Label(context.getString(R.string.widget_display_air) + " · AQI", 12, secondary)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val face = when (weather.airLevel) {
                                1 -> R.drawable.widget_ic_sentiment_satisfied_white_48dp
                                2 -> R.drawable.widget_ic_sentiment_neutral_white_48dp
                                3 -> R.drawable.widget_ic_sentiment_dissatisfied_white_48dp
                                4, 5, 6 -> R.drawable.widget_ic_sentiment_very_dissatisfied_white_48dp
                                else -> null
                            }
                            if (face != null) Image(ImageProvider(face), null, GlanceModifier.size(if (roomy) 32.dp else 19.dp),
                                colorFilter = ColorFilter.tint(primary))
                            Label(weather.airIndex ?: "–", if (roomy) 27 else 17, bold = true)
                            Label(weather.airName?.let { "  $it" }.orEmpty(), if (roomy) 14 else 12, secondary)
                        }
                    }
                    val codes = if (wide) listOf("pm25" to "PM2.5", "pm10" to "PM10", "o3" to "O₃")
                        else listOf("pm10" to "PM10", "pm25" to "PM2.5")
                    if (!wide && roomy) {
                        for ((code, title) in codes) {
                            val value = weather.pollutant(code) ?: continue
                            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(GlanceModifier.defaultWeight()) { Label(title, 13, secondary) }
                                Label(value, 14, bold = true)
                            }
                        }
                    } else {
                        Row(GlanceModifier.fillMaxWidth()) {
                            for ((code, title) in codes) {
                                val value = weather.pollutant(code) ?: continue
                                Column(GlanceModifier.defaultWeight()) {
                                    Label(title, 12, secondary)
                                    Label(value, if (wide) 15 else 13, bold = true)
                                }
                            }
                        }
                    }
                    if (roomy && wide) Label(weather.airSummary.orEmpty(), 13, secondary, lines = 2)
                }
            }
        }
    }
}

private val refreshPlace = ActionParameters.Key<String>("weather_refresh_place")

class ManualWeatherRefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val placeKey = parameters[refreshPlace] ?: return
        val id = GlanceAppWidgetManager(context).getAppWidgetId(glanceId)
        WidgetRefresh.enqueueManual(context, id, placeKey)
    }
}

@Composable
private fun RefreshStamp(context: Context, data: Display) {
    val size = LocalSize.current
    val compact = size.width < 130.dp
    val strip = size.height < 100.dp
    val time = if (strip && size.width >= 245.dp) data.updated else data.shortTime
    val stamp = if (compact) time else context.getString(R.string.widget_refresh_stamp, time)
    val fontSize = if (compact || strip) 9 else 11
    if (!data.manualRefresh || data.placeKey == null) {
        Label(stamp, fontSize, secondary)
        return
    }
    val style = localStyle.current
    val action = actionRunCallback<ManualWeatherRefreshAction>(actionParametersOf(refreshPlace to data.placeKey))
    val text = if (time.isEmpty()) context.getString(R.string.widget_refresh_empty) else stamp
    val height = if (strip) 16.dp else 26.dp
    Row(GlanceModifier.height(height).cornerRadius(13.dp).background(style.surface).clickable(action)
        .padding(horizontal = if (compact) 3.dp else 7.dp), verticalAlignment = Alignment.CenterVertically) {
        if (!compact) Label(text, fontSize, primary)
        Image(ImageProvider(R.drawable.widget_refresh), context.getString(R.string.widget_refresh_action),
            GlanceModifier.padding(start = if (compact) 0.dp else 4.dp).size(if (strip) 12.dp else 15.dp),
            colorFilter = ColorFilter.tint(primary))
    }
}

@Composable
private fun Reading(weather: WidgetReadings, fontSize: Int, iconSize: Int) {
    val art = skyArtwork(weather.sky)
    if (art != null) Image(ImageProvider(art), weather.condition.ifBlank { null }, GlanceModifier.size(iconSize.dp))
    Label((if (art == null) weather.current else weather.degrees).ifEmpty { "–" }, fontSize, bold = true)
}

@Composable
private fun WeatherBlock(weather: WidgetReadings, roomy: Boolean, wide: Boolean) {
    val style = localStyle.current
    val paper = style == WidgetStyle.PAPER && roomy
    val modifier = if (paper) GlanceModifier.cornerRadius(12.dp).background(style.surface).padding(horizontal = 7.dp, vertical = 3.dp) else GlanceModifier
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Reading(weather, if (roomy && wide) 25 else 16, if (roomy) 37 else 23)
        }
        if (roomy) Label(weather.condition, 12, secondary)
    }
}

@Composable
private fun Clock(context: Context, sp: Int = 17, alignEnd: Boolean = false) {
    val layout = when {
        alignEnd -> R.layout.widget_end_clock_face
        localStyle.current == WidgetStyle.PAPER -> R.layout.widget_paper_clock_face
        else -> R.layout.widget_display_clock_face
    }
    val face = RemoteViews(context.packageName, layout)
    face.setTextViewTextSize(R.id.widget_clock_time, android.util.TypedValue.COMPLEX_UNIT_SP, sp.toFloat())
    face.setTextColor(R.id.widget_clock_time, localStyle.current.ink.toArgb())
    val width = sp * (if (android.text.format.DateFormat.is24HourFormat(context)) 3 else 5)
    // Size the embedded RemoteViews as well as its TextClock: a wrap-content wrapper
    // can keep the original XML text height after setTextViewTextSize runs.
    val fontScale = context.resources.configuration.fontScale
    val clockBox = if (alignEnd) GlanceModifier.fillMaxWidth() else GlanceModifier.width(width.dp)
    AndroidRemoteViews(face, clockBox.height((sp * 1.5f * fontScale).dp))
}

/** One launcher row: reserve its first line for the location and update time. */
@Composable
private fun Strip(context: Context, kind: Kind, data: Display, weather: WidgetReadings, wide: Boolean) {
    Row(GlanceModifier.fillMaxWidth()) {
        Column(GlanceModifier.defaultWeight()) { Label(data.title, 10, primary, bold = true) }
        RefreshStamp(context, data)
    }
    when (kind) {
        Kind.FORECAST -> Cells(context, weather, data.daily, data.yesterday, wide, inlineIcon = true)
        Kind.CLOCK -> Row {
            Clock(context)
            Label("  " + weather.current, 16)
        }
        Kind.CURRENT -> Row {
            Label(weather.current + "  ", 15, bold = true)
            val detail = if (data.yesterday) weather.comparison else weather.days.find { it.offset == 0 }?.value.orEmpty()
            Label(detail, 12, secondary)
        }
        Kind.AIR -> {
            Label(weather.airGrade, 11, bold = true)
            Label(listOfNotNull(weather.pollutant("pm25")?.let { "PM2.5 $it" },
                weather.pollutant("pm10")?.let { "PM10 $it" },
                weather.pollutant("o3")?.takeIf { wide }?.let { "O₃ $it" }).joinToString("  "), 9)
        }
    }
}

@Composable
private fun Cells(context: Context, weather: WidgetReadings, daily: Boolean, yesterday: Boolean, wide: Boolean, inlineIcon: Boolean = false, dense: Boolean = false) {
    val cells = if (daily) weather.days.filter { yesterday || it.offset != -1 } else weather.hours
    if (cells.isEmpty()) {
        Label("–", 13)
        return
    }
    val style = localStyle.current
    val band = if (style == WidgetStyle.BLUE && !inlineIcon)
        GlanceModifier.fillMaxWidth().cornerRadius(12.dp).background(style.surface).padding(vertical = 3.dp)
        else GlanceModifier.fillMaxWidth()
    Row(band) {
        cells.take(when { LocalSize.current.width >= 300.dp -> 5; wide -> 4; else -> 2 }).forEach { cell ->
            Column(GlanceModifier.defaultWeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                val label = when (cell.offset) {
                    -1 -> context.getString(R.string.LOC_YESTERDAY)
                    0 -> context.getString(R.string.LOC_TODAY)
                    1 -> context.getString(R.string.LOC_TOMORROW)
                    else -> cell.label
                }
                Label(label, if (inlineIcon) 10 else 13, secondary)
                val classicHours = !daily && style == WidgetStyle.CLASSIC
                if (classicHours && !inlineIcon) Label(cell.value, 14, bold = true)
                if (!inlineIcon) {
                    val art = skyArtwork(cell.sky)
                    if (art == null) Label(cell.icon, if (dense) 16 else 22)
                    else Image(ImageProvider(art), cell.icon, GlanceModifier.size(if (dense) 26.dp else 32.dp))
                }
                if (daily && !dense && !inlineIcon) {
                    val low = cell.value.substringBefore(" / ")
                    val high = cell.value.substringAfter(" / ")
                    Label(high, 17, bold = true)
                    Label("${low}°", 14, secondary)
                } else if (!classicHours || inlineIcon) {
                    Label(if (inlineIcon) cell.icon + cell.value else cell.value, if (inlineIcon || daily) 11 else 15, bold = true)
                }
            }
        }
    }
}
