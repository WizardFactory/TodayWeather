package net.wizardfactory.todayweather.ui.chart

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import java.io.File
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.AirQuality
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.air.AirScope
import net.wizardfactory.todayweather.core.domain.air.AirSeries
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.ui.air.AirChartView
import net.wizardfactory.todayweather.ui.air.AirColors
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.Zoomed
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Verifies [PreparedChartCache] reuse across tab visits, 1-entry-per-kind bound, invalidation on every key axis,
 * and activity-scoped provision from [AppContent] (#3232).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h900dp-xhdpi")
class PreparedChartCacheTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    private fun seoulConverted(): JsonObject =
        WeatherConverter.convert(Json.parseToJsonElement(File(inputs, "kma-seoul.json").readText()))!!

    private fun seoulAirScope(metrics: ChartMetrics): AirScope {
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val city = cityRecord(seoul, WeatherEntry(WeatherRepository.merge(null, seoulConverted()), 0))
        return AirScope(metrics, "airkorea", TimeZone.getTimeZone("Asia/Seoul")).apply { open(city, null, 1, false) }
    }

    @Test
    fun chartsReusePreparedDataAcrossTabVisits() {
        val converted = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = chartTexts(rule.activity)
        val hourly = HourlyChart.build(converted, metrics, texts, "mm", "m/s")
        val daily = DailyChart.build(converted, metrics, texts, "mm")
        val airScope = seoulAirScope(metrics)
        val airHour = forecastTexts(rule.activity)["LOC_HOUR"]
        val cache = PreparedChartCache()
        val images = ForecastChartImages(rule.activity)
        var tab by mutableStateOf(0)
        var visit by mutableStateOf(0)

        rule.setContent {
            CompositionLocalProvider(LocalForecastChartImages provides images, LocalPreparedCharts provides cache) {
                Box(Modifier.width(384.dp)) {
                    Zoomed {
                        when (tab) {
                            0 -> HourlyChartView(hourly, expanded = false, onToggleExpanded = {})
                            1 -> DailyChartView(daily)
                            2 -> {
                                // Simulate a fresh AirScope creating a new AirSeries instance with equal slots on each visit.
                                val freshSeries = AirSeries(airScope.airChart!!.data.toList(), airScope.airChart!!.maxValue)
                                AirChartView(freshSeries, airScope.standard, airHour, AirColors.of(Theme.LIGHT))
                            }
                        }
                    }
                }
            }
        }

        rule.waitForIdle()
        rule.onRoot().captureToImage()
        assertEquals(1, cache.hourlyPrepares)
        assertEquals(0, cache.dailyPrepares)
        assertEquals(0, cache.airPrepares)

        // Visit Daily, then Air, then cycle back across all three tabs twice, drawing on every visit.
        for (nextTab in listOf(1, 2, 0, 1, 2, 0)) {
            rule.runOnIdle {
                tab = nextTab
                visit++
            }
            rule.waitForIdle()
            rule.onRoot().captureToImage()
        }

        assertEquals("hourly prepared once across visits", 1, cache.hourlyPrepares)
        assertEquals("daily prepared once across visits", 1, cache.dailyPrepares)
        assertEquals("air prepared once across visits", 1, cache.airPrepares)
    }

    @Test
    fun cacheInvalidatesOnEveryKeyDimensionAndStaysBoundedToOneEntryPerKind() {
        val converted = seoulConverted()
        val metrics = ChartMetrics(384.0, 832.0)
        val texts = chartTexts(rule.activity)
        val hourlyA = HourlyChart.build(converted, metrics, texts, "mm", "m/s")
        val hourlyB = HourlyChart.build(converted, metrics, texts, "mm", "m/s")
        val dailyA = DailyChart.build(converted, metrics, texts, "mm")
        val dailyB = DailyChart.build(converted, metrics, texts, "mm")
        val airScope = seoulAirScope(metrics)
        val series = airScope.airChart!!
        val cache = PreparedChartCache()
        val imagesA = ForecastChartImages(rule.activity)
        val imagesB = ForecastChartImages(rule.activity)
        val d1 = Density(2f, 1f)
        val d2 = Density(2.6f, 1f)
        val dFont = Density(2f, 1.3f)
        val resolverA = createFontFamilyResolver(rule.activity)
        val resolverB = createFontFamilyResolver(rule.activity)

        // Hourly: hit, expand/collapse reuse, key invalidations, 1-entry bound.
        val h0 = cache.hourly(hourlyA, false, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA)
        assertNull(h0.detailSvg)
        assertSame(h0, cache.hourly(hourlyA, false, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA))
        assertEquals(1, cache.hourlyPrepares)

        val hExpanded = cache.hourly(hourlyA, true, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA)
        assertNotNull(hExpanded.detailSvg)
        assertSame("expand reuses main chartSvg", h0.chartSvg, hExpanded.chartSvg)
        assertSame("expand reuses legend", h0.legend, hExpanded.legend)
        assertEquals(1, cache.hourlyPrepares)
        assertEquals(1, cache.hourlyDetailPrepares)

        val hCollapsed = cache.hourly(hourlyA, false, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA)
        assertNull("collapse releases detailSvg", hCollapsed.detailSvg)
        assertSame(h0.chartSvg, hCollapsed.chartSvg)
        assertEquals(1, cache.hourlyPrepares)

        assertNotSame(hCollapsed, cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), d1, LayoutDirection.Ltr, resolverA, imagesA))
        assertEquals(2, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), d2, LayoutDirection.Ltr, resolverA, imagesA)
        assertEquals(3, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Ltr, resolverA, imagesA)
        assertEquals(4, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Rtl, resolverA, imagesA)
        assertEquals(5, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Rtl, resolverB, imagesA)
        assertEquals(6, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        assertEquals(7, cache.hourlyPrepares)
        // Bounded to 1 hourly entry: switching to hourlyB evicts hourlyA, so returning to hourlyA prepares again.
        cache.hourly(hourlyB, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        assertEquals(8, cache.hourlyPrepares)
        cache.hourly(hourlyA, false, ChartColors.of(Theme.DARK, false), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        assertEquals(9, cache.hourlyPrepares)

        // Daily: hit, key invalidations, 1-entry bound.
        val da0 = cache.daily(dailyA, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA)
        assertSame(da0, cache.daily(dailyA, ChartColors.LIGHT, d1, LayoutDirection.Ltr, resolverA, imagesA))
        assertEquals(1, cache.dailyPrepares)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), d1, LayoutDirection.Ltr, resolverA, imagesA)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), d2, LayoutDirection.Ltr, resolverA, imagesA)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Ltr, resolverA, imagesA)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Rtl, resolverA, imagesA)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Rtl, resolverB, imagesA)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        cache.daily(dailyB, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        cache.daily(dailyA, ChartColors.of(Theme.DARK, true), dFont, LayoutDirection.Rtl, resolverB, imagesB)
        assertEquals(9, cache.dailyPrepares)

        // Air: hit, key invalidations (width, height, standard, hour, colors, density, fontScale, layoutDirection, resolver), 1-entry bound.
        val a0 = cache.air(series, airScope.standard, "시", 384.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA)
        assertSame(a0, cache.air(AirSeries(series.data.toList(), series.maxValue), airScope.standard, "시", 384.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA))
        assertEquals(1, cache.airPrepares)
        cache.air(series, airScope.standard, "시", 360.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA)
        cache.air(series, airScope.standard, "h", 360.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.DARK), d1, LayoutDirection.Ltr, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.DARK), d2, LayoutDirection.Ltr, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.DARK), dFont, LayoutDirection.Ltr, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.DARK), dFont, LayoutDirection.Rtl, resolverA)
        cache.air(series, AirQuality.standard("airnow"), "h", 360.0, 100.0, AirColors.of(Theme.DARK), dFont, LayoutDirection.Rtl, resolverB)
        // Bounded to 1 air entry: switching back to 384.0 rebuilds.
        cache.air(series, airScope.standard, "시", 384.0, 100.0, AirColors.of(Theme.LIGHT), d1, LayoutDirection.Ltr, resolverA)
        assertEquals(10, cache.airPrepares)
    }

    @Test
    fun airChartViewExposesChartTagAndReactsToWidthChange() {
        val metrics = ChartMetrics(384.0, 832.0)
        val airScope = seoulAirScope(metrics)
        val cache = PreparedChartCache()
        var widthDp by mutableStateOf(384.dp)

        rule.setContent {
            CompositionLocalProvider(LocalPreparedCharts provides cache) {
                Box(Modifier.width(widthDp)) {
                    Zoomed {
                        AirChartView(airScope.airChart!!, airScope.standard, "시", AirColors.of(Theme.LIGHT))
                    }
                }
            }
        }
        rule.waitForIdle()
        rule.onNodeWithTag(AirTags.CHART).assertExists().captureToImage()
        assertEquals(1, cache.airPrepares)

        rule.runOnIdle { widthDp = 360.dp }
        rule.waitForIdle()
        rule.onNodeWithTag(AirTags.CHART).captureToImage()
        assertEquals(2, cache.airPrepares)
    }

    @Test
    fun appContentProvidesPreparedChartCacheToTheWholeShell() {
        val state = AppState().closeStart()
        val memory = object : StateAccess {
            override fun current() = state
            override fun change(update: (AppState) -> AppState) = Unit
        }
        val repository = WeatherRepository("https://fixture.invalid", null, HttpGet { _, _ -> error("No request expected") }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        var seen: PreparedChartCache? = null
        rule.setContent {
            val host = WeatherTabHost(forecastTexts(rule.activity), PhotoLoader(rule.activity), {}, {}, {}, {})
            AppContent(state, emptyMap(), emptySet(), false, session, host, "test", onExit = {}, banner = { seen = LocalPreparedCharts.current })
        }
        rule.waitForIdle()
        assertNotNull("the shell sees no activity-scoped PreparedChartCache", seen)
    }
}
