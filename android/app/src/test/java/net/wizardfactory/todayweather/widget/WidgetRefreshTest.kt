package net.wizardfactory.todayweather.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.atomic.AtomicInteger
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
                HttpGet { _, _ -> calls.incrementAndGet(); "{}" }, io = Dispatchers.Unconfined)
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
            assertEquals(1, calls.get())
        }
    }
}
