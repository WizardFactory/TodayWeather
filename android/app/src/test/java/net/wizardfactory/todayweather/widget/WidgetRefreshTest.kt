package net.wizardfactory.todayweather.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import net.wizardfactory.todayweather.TodayWeatherApp
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Runs the worker's refresh against a bound provider and the real app state, with a recording HTTP transport. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 34])
class WidgetRefreshTest {
    @Test fun aBoundWidgetRedrawsWithoutFetchingUntilTheMainAppReopens() = runBlocking {
        withTimeout(20_000) {
            val app = ApplicationProvider.getApplicationContext<TodayWeatherApp>()
            androidx.startup.AppInitializer.getInstance(app).initializeComponent(androidx.work.WorkManagerInitializer::class.java)
            val city = Place(false, false, name = "Seoul", location = Location(37.56, 126.98))
            app.appState.state.filterNotNull().first()
            app.appState.change { it.copy(places = listOf(city), placeIndex = 0) }
            val id = 57
            val manager = AppWidgetManager.getInstance(app)
            val providerInfo = AppWidgetProviderInfo().apply { provider = ComponentName(app, CurrentReceiver::class.java) }
            shadowOf(manager).addBoundWidget(id, providerInfo)
            WidgetOptions.save(app, id, WidgetOptions(placeKey = WidgetOptions.key(city)))

            val calls = AtomicInteger()
            val repository = WeatherRepository("https://weather.invalid", null,
                HttpGet { _, _ -> calls.incrementAndGet(); error("offline") }, io = Dispatchers.Unconfined)
            val renders = mutableListOf<Pair<Int, Boolean>>()
            suspend fun refresh(displayOnly: Boolean = false) = WidgetRefresh.refresh(app, displayOnly, repository) { context, widgetId ->
                renders += widgetId to WidgetAccess.allowed(context)
            }

            val expired = System.currentTimeMillis() - WidgetAccess.visitWindow
            app.getSharedPreferences("widget_access", Context.MODE_PRIVATE).edit().putLong("last_visit", expired).commit()
            refresh()
            assertEquals(listOf(id to false), renders)
            assertEquals(expired, WidgetAccess.lastVisit(app))
            assertEquals(0, calls.get())

            WidgetAccess.mainAppOpened(app)
            renders.clear()
            refresh(displayOnly = true)
            assertEquals(listOf(id to true), renders)
            assertEquals(0, calls.get())
            refresh()
            refresh()
            assertEquals("A failed widget fetch consumes the one-hour attempt", 1, calls.get())
        }
    }

    @Test fun manualTapTargetsOnlyTheDisplayedPlaceAndSharesTheHourlyBudget() = runBlocking {
        withTimeout(20_000) {
            val app = ApplicationProvider.getApplicationContext<TodayWeatherApp>()
            val seoul = Place(false, false, name = "Seoul", location = Location(37.56, 126.98))
            val current = seoul.copy(currentPosition = true)
            val jeju = Place(false, false, name = "Jeju", location = Location(33.5, 126.5))
            app.appState.state.filterNotNull().first()
            app.appState.change { it.copy(places = listOf(current, seoul, jeju), placeIndex = 0) }
            var time = System.currentTimeMillis()
            app.getSharedPreferences("widget_access", Context.MODE_PRIVATE).edit().putLong("last_visit", time).commit()

            val manager = AppWidgetManager.getInstance(app)
            fun bind(id: Int, place: Place, manual: Boolean) {
                val info = AppWidgetProviderInfo().apply { provider = ComponentName(app, CurrentReceiver::class.java) }
                shadowOf(manager).addBoundWidget(id, info)
                WidgetOptions.save(app, id, WidgetOptions(placeKey = WidgetOptions.key(place), manualRefresh = manual))
            }
            bind(1, seoul, true)
            bind(2, jeju, false)
            bind(3, jeju, true)
            bind(4, seoul, true)
            bind(5, current, true)
            val origins = mutableListOf<String>()
            val started = CompletableDeferred<Unit>()
            val done = CompletableDeferred<Unit>()
            val transport = HttpGet { url, _ ->
                origins += url.substringAfter("/coord/").substringBefore("?")
                if ("37.56" in url && !started.isCompleted) {
                    started.complete(Unit)
                    done.await()
                }
                error("offline")
            }
            // New repository on every run: a failed response has no cache and no in-memory gate to reuse.
            suspend fun refresh(id: Int? = null, place: Place? = null) =
                WidgetRefresh.refresh(app, false, WeatherRepository("https://weather.invalid", null, transport),
                    manualId = id, displayedPlaceKey = place?.let(WidgetOptions::key), now = { time }) { _, _ -> }

            refresh()
            assertEquals(listOf("33.5,126.5"), origins)
            refresh(3, jeju)
            refresh(1, jeju) // Stale action after the widget was reconfigured.
            refresh(2, jeju) // Auto widget.
            refresh(99, seoul) // Provider no longer installed.
            assertEquals(1, origins.size)

            val first = async { refresh(5, current) }
            started.await()
            refresh(4, seoul)
            done.complete(Unit)
            first.await()
            val nearby = current.copy(location = Location(37.5601, 126.98))
            app.appState.change { it.copy(places = listOf(nearby, seoul, jeju)) }
            refresh(5, nearby) // Moving GPS coordinates cannot bypass a failed current-position attempt.
            time += 3_599_999
            refresh(4, seoul)
            assertEquals(listOf("33.5,126.5", "37.56,126.98"), origins)
            time++
            refresh(4, seoul)
            assertEquals(listOf("33.5,126.5", "37.56,126.98", "37.56,126.98"), origins)
        }
    }
}
