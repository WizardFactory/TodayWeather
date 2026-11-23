package net.wizardfactory.todayweather.widget

import android.app.Activity
import android.appwidget.AppWidgetHostView
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextClock
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.core.view.descendants
import androidx.glance.appwidget.ExperimentalGlanceRemoteViewsApi
import androidx.glance.appwidget.GlanceRemoteViews
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.YesterdayText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Exercise Glance's translated product layout with the exact space a launcher assigns. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
@OptIn(ExperimentalGlanceRemoteViewsApi::class)
class WidgetLayoutTest {
    private lateinit var activity: ActivityController<Activity>
    private val context: Context get() = activity.get()

    @Before fun openHostWindow() {
        activity = Robolectric.buildActivity(Activity::class.java).setup()
    }

    @After fun closeHostWindow() = activity.close()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val readings by lazy {
        val body = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
        WidgetReadings(WeatherConverter.convert(Json.parseToJsonElement(body))!!, "C",
            YesterdayText(context.getString(R.string.LOC_SAME_AS_YESTERDAY), context.getString(R.string.LOC_THAN_YESTERDAY)))
    }
    private val display get() = Display("current", "회현동", readings = readings, updated = "11. 8. 오전 9:00", shortTime = "09:07", timeZoneId = java.util.TimeZone.getDefault().id)

    @Test fun automaticHeaderShowsWhenTheCachedWeatherWasUpdated() {
        val host = render("auto-update-time", Kind.CURRENT, display, 172, 160)
        assertTrue("visible update time must describe the cache",
            host.labels().any { it.text.toString() == "09:07 기준" })
    }

    @Test fun manualButtonAppearsForCachedAndMissingReadingsButNeverOnExpiredOrMissingPlaces() {
        val manual = display.copy(manualRefresh = true)
        for (kind in Kind.entries) {
            val host = render("manual-$kind", kind, manual, 172, 200)
            assertEquals(1, host.refreshIcons().size)
        }
        val empty = manual.copy(readings = null, shortTime = "", updated = "", message = R.string.widget_display_no_weather)
        val emptyHost = render("manual-empty", Kind.CURRENT, empty, 172, 200)
        assertEquals(1, emptyHost.refreshIcons().size)
        assertTrue(emptyHost.labels().any { it.text.toString() == "새로고침" })
        assertTrue(emptyHost.labels().none { it.text.contains("기준") })
        for (message in listOf(R.string.widget_display_no_place, R.string.widget_display_expired)) {
            val host = render("manual-unavailable-$message", Kind.CURRENT, empty.copy(message = message), 172, 200)
            assertTrue(host.refreshIcons().isEmpty())
        }
        assertTrue(render("automatic", Kind.CURRENT, display, 172, 200).refreshIcons().isEmpty())
    }

    @Test fun manualControlRemainsVisibleAtMinimumAndOneRowSizes() {
        for ((kind, width) in listOf(Kind.CURRENT to 48, Kind.CURRENT to 130, Kind.FORECAST to 245,
            Kind.AIR to 245, Kind.CLOCK to 245)) {
            val host = render("manual-strip-$kind-$width", kind, display.copy(manualRefresh = true), width, 50)
            val icon = host.refreshIcons().single()
            assertTrue("refresh icon must be visible", !host.boundsOf(icon).isEmpty)
        }
    }

    @Test fun currentAndAirShowReadingsBetweenLocationAndTimestamp() {
        val current = render("current", Kind.CURRENT, display, 172, 160)
        assertTrue(current.labels().any { it.text.toString() == readings.degrees })
        val air = render("air", Kind.AIR, display, 260, 180)
        for (label in listOf("PM10", "PM2.5", "O₃")) assertTrue(label, air.labels().any { it.text.toString() == label })
    }

    @Test fun clockIncludesLiveClockAndForecast() {
        val clock = render("clock", Kind.CLOCK, display, 360, 224)
        val face = clock.findViewById<TextClock>(R.id.widget_clock_time)
        assertTrue("attached clock should show a time, got '${face.text}'", Regex("\\d{1,2}:\\d{2}").containsMatchIn(face.text))
        assertEquals("clock time wraps: '${face.text}'", 1, face.layout.lineCount)
        val available = face.width - face.compoundPaddingLeft - face.compoundPaddingRight
        assertTrue("clock time exceeds its width: '${face.text}'", face.layout.getLineWidth(0) <= available + 1f)
        assertTrue(clock.labels().any { it.text.toString() == readings.hours.first().label })
    }

    @Test fun forecastLabelsAndIconsRemainLegibleAtLauncherSizes() {
        for (style in WidgetStyle.entries) {
            for (kind in listOf(Kind.CLOCK, Kind.FORECAST)) {
                val host = render("legibility-$style-$kind", kind, display.copy(style = style), 360, 200)
                val first = readings.hours.first()
                val time = host.labels().single { it.text.toString() == first.label }
                val expected = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 16f, context.resources.displayMetrics)
                assertEquals("forecast hour size in $kind", expected, time.textSize, 0.5f)
                val icon = host.descendants.first { it.contentDescription == first.icon && it.width == dp(if (kind == Kind.CLOCK) 31 else 38) }
                assertEquals("square forecast icon", icon.width, icon.height)
            }
            for ((width, height) in listOf(245 to 50, 245 to 100, 245 to 150, 300 to 150, 172 to 180, 300 to 180, 245 to 270)) {
                for (kind in listOf(Kind.CLOCK, Kind.FORECAST)) {
                    for (daily in listOf(false, true)) {
                        render("fit-$kind-$style-$width-$height-$daily", kind,
                            display.copy(style = style, daily = daily, manualRefresh = true), width, height)
                    }
                }
            }
        }
    }

    @Test fun forecastUsesFiveColumnsWhenWideAndTwoWhenNarrow() {
        for ((width, count) in listOf(360 to 5, 172 to 2)) {
            val host = render("forecast-hourly-$width", Kind.FORECAST, display, width, 224)
            val labels = host.labels().map { it.text.toString() }
            assertEquals(readings.hours.take(count).map { it.label }, labels.filter { Regex("[0-9]{2}:00").matches(it) })
            val day = render("forecast-daily-$width", Kind.FORECAST, display.copy(daily = true), width, 224)
            val dayLabels = day.labels().map { it.text.toString() }
            for (cell in readings.days.filter { it.offset != -1 }.take(count)) {
                assertTrue("high ${cell.value} at $width", cell.value.substringAfter(" / ") in dayLabels)
                assertTrue("low ${cell.value} at $width", cell.value.substringBefore(" / ") + "°" in dayLabels)
            }
        }
    }

    @Test fun liveFacesShowEachCityAtTheSameInstantAndFollowItsCalendar() {
        android.provider.Settings.System.putString(context.contentResolver, android.provider.Settings.System.TIME_12_24, "24")
        fun checkClock(city: String, zone: String, instant: String, expectedTime: String, expectedDate: String): AppWidgetHostView {
            val epoch = java.time.Instant.parse(instant).toEpochMilli()
            android.os.SystemClock.setCurrentTimeMillis(epoch)
            val weather = if (zone == "Asia/Seoul") readings else {
                val fixture = File(project, "../core-domain/src/test/resources/corpus/inputs/vc-newyork.json").readText()
                WidgetReadings(WeatherConverter.convert(Json.parseToJsonElement(fixture))!!, "C", YesterdayText("", ""))
            }
            val host = render("local-$zone-$expectedTime".replace("/", "-").replace(":", ""), Kind.CLOCK,
                display.copy(title = city, readings = weather, style = WidgetStyle.BLUE, timeZoneId = zone), 360, 200)
            val clock = host.findViewById<TextClock>(R.id.widget_clock_time)
            val date = host.findViewById<TextClock>(R.id.widget_clock_date)
            assertEquals(zone, clock.timeZone)
            assertEquals(zone, date.timeZone)
            assertEquals(expectedTime, clock.text.toString())
            assertEquals(expectedDate, date.text.toString())
            return host
        }
        checkClock("서울", "Asia/Seoul", "2026-03-08T04:59:00Z", "13:59", "2026. 3. 8.")
        val beforeMidnight = checkClock("뉴욕", "America/New_York", "2026-03-08T04:59:00Z", "23:59", "2026. 3. 7.")
        shadowOf(Looper.getMainLooper()).idleFor(1, java.util.concurrent.TimeUnit.MINUTES)
        assertEquals("00:00", beforeMidnight.findViewById<TextClock>(R.id.widget_clock_time).text.toString())
        assertEquals("2026. 3. 8.", beforeMidnight.findViewById<TextClock>(R.id.widget_clock_date).text.toString())
        checkClock("뉴욕", "America/New_York", "2026-03-08T05:00:00Z", "00:00", "2026. 3. 8.")
        checkClock("뉴욕", "America/New_York", "2026-03-08T06:59:00Z", "01:59", "2026. 3. 8.")
        checkClock("뉴욕", "America/New_York", "2026-03-08T07:00:00Z", "03:00", "2026. 3. 8.")
        val unknown = render("local-unavailable", Kind.CLOCK, display.copy(timeZoneId = null), 360, 200)
        assertTrue(unknown.descendants.none { it is TextClock })
        assertTrue(unknown.labels().any { it.text.toString() == "–" })
    }

    @Test fun blueHourDateAndLiveTimeShareTheirRightEdge() {
        for (format in listOf("12", "24")) {
            android.provider.Settings.System.putString(context.contentResolver, android.provider.Settings.System.TIME_12_24, format)
            val host = render("clock-blue-$format", Kind.CLOCK, display.copy(style = WidgetStyle.BLUE), 360, 200)
            val dateLabel = host.findViewById<TextClock>(R.id.widget_clock_date)
            val clock = host.findViewById<TextClock>(R.id.widget_clock_time)
            fun textEnd(label: TextView) = host.boundsOf(label).left + label.compoundPaddingLeft + label.layout.getLineRight(0)
            val gap = abs(textEnd(dateLabel) - textEnd(clock))
            assertTrue("$format-hour date and clock text ends differ by $gap px", gap <= dp(1))
        }
    }

    @Test fun allThreeClockStylesFitAndShowTheSameForecast() {
        WidgetStyle.entries.forEach { style ->
            val host = render("clock-$style", Kind.CLOCK, display.copy(style = style), 360, 200)
            assertTrue(host.labels().any { it.text.toString() == readings.degrees })
            assertTrue(host.labels().any { it.text.toString() == readings.hours.first().label })
        }
    }

    @Test fun expiredPromptIsCenteredWithoutAnOrphanCharacterOrWeather() {
        val host = render("expired", Kind.FORECAST, Display(message = R.string.widget_display_expired), 172, 224)
        val prompt = host.labels().single()
        assertEquals(context.getString(R.string.widget_display_expired_card), prompt.text.toString())
        val bounds = host.boundsOf(prompt)
        assertTrue("prompt $bounds must be centered in ${host.width}×${host.height}",
            abs(bounds.exactCenterX() - host.width / 2f) <= dp(3) && abs(bounds.exactCenterY() - host.height / 2f) <= dp(3))
        val lines = prompt.layout
        for (line in 0 until lines.lineCount) {
            val words = prompt.text.subSequence(lines.getLineStart(line), lines.getLineEnd(line)).trim()
            assertTrue("orphan line '$words'", words.length >= 2)
        }
    }

    private fun AppWidgetHostView.refreshIcons() = descendants.filter {
        it.contentDescription == context.getString(R.string.widget_refresh_action)
    }.toList()

    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).roundToInt()
    private fun AppWidgetHostView.boundsOf(view: View) = Rect(0, 0, view.width, view.height).also { offsetDescendantRectToMyCoords(view, it) }
    private fun AppWidgetHostView.labels() = descendants.filterIsInstance<TextView>().filter { it.text.isNotEmpty() }.toList()

    private fun render(name: String, kind: Kind, data: Display, width: Int, height: Int): AppWidgetHostView {
        val remote = runBlocking {
            withTimeout(15_000) {
                GlanceRemoteViews().compose(context, DpSize(width.dp, height.dp)) { Panel(context, kind, data) }.remoteViews
            }
        }
        val host = AppWidgetHostView(context)
        host.setPadding(0, 0, 0, 0)
        host.addView(remote.apply(context, host), ViewGroup.LayoutParams(-1, -1))
        val w = dp(width)
        val h = dp(height)
        val window = FrameLayout(context)
        window.addView(host, FrameLayout.LayoutParams(w, h))
        activity.get().setContentView(window)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("$name host is attached to the window", host.isAttachedToWindow)
        host.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        host.layout(0, 0, w, h)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        host.draw(Canvas(bitmap))
        val out = File(project, "../../reports/verification/android-widgets/layout-jvm").apply { mkdirs() }
        File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()

        val labels = host.labels()
        assertTrue("$name has visible text", labels.isNotEmpty())
        val card = Rect(0, 0, w, h)
        for (label in labels) {
            val bounds = host.boundsOf(label)
            assertTrue("$name: '${label.text}' at $bounds outside $card", !bounds.isEmpty && card.contains(bounds))
            val layout = label.layout
            assertTrue("$name: '${label.text}' clipped vertically: layout ${layout.height}, bounds $bounds", layout.height <= label.height)
            for (line in 0 until layout.lineCount) assertEquals("$name: '${label.text}' ellipsized", 0, layout.getEllipsisCount(line))
        }
        if (data.message == null && width >= 130 && height >= 100) {
            val header = host.boundsOf(labels.single { it.text.toString() == data.title })
            val stampText = context.getString(R.string.widget_refresh_stamp, data.shortTime)
            val timestamp = host.boundsOf(labels.single { it.text.toString() == stampText })
            assertTrue("$name: location and update time belong at the top", header.top <= dp(22) && timestamp.top <= dp(24))
            assertTrue("$name: header text overlaps timestamp", header.right <= timestamp.left)
            val end = host.refreshIcons().firstOrNull()?.let { host.boundsOf(it).right } ?: timestamp.right
            assertTrue("$name: timestamp or refresh button must be right aligned", end >= w - dp(29))
            for (label in labels.filter { it.text.toString() != stampText && it.text.toString() != data.title }) {
                assertTrue("$name: '${label.text}' overlaps header", host.boundsOf(label).top >= header.bottom)
            }
        }
        return host
    }
}
