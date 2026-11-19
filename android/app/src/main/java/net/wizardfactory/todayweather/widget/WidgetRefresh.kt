package net.wizardfactory.todayweather.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import net.wizardfactory.todayweather.AppLocale
import net.wizardfactory.todayweather.TodayWeatherApp
import net.wizardfactory.todayweather.core.data.WeatherRepository

/** Launcher updates and main-app visits share the same cache and per-place refresh. */
class WidgetRefresh(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        refresh(applicationContext as TodayWeatherApp, inputData.getBoolean(DISPLAY_ONLY, false))
        return Result.success()
    }

    companion object {
        private const val DISPLAY_ONLY = "display_only"
        private val CACHE_INTERVAL = TimeUnit.MINUTES.toMillis(30)

        internal suspend fun refresh(
            app: TodayWeatherApp,
            displayOnly: Boolean,
            weather: WeatherRepository = app.weather,
            redraw: suspend (Context, Int) -> Unit = ::redrawWidget,
        ) {
            val ids = installed(app)
            if (ids.isEmpty()) return
            // Publish the prompt or cached weather before any potentially slow network work.
            for (id in ids) redraw(app, id)
            if (displayOnly || !WidgetAccess.allowed(app)) return

            val state = app.appState.state.filterNotNull().first()
            val places = ids.mapNotNull { id ->
                WidgetOptions.resolve(state, WidgetOptions.read(app, id).placeKey)
            }.distinct()
            for (place in places) {
                if (!WidgetAccess.allowed(app)) break
                val cached = weather.cached(place)
                if (cached != null && System.currentTimeMillis() - cached.loadedAt in 0 until CACHE_INTERVAL) continue
                // A slow request and its delayed retry attempts must also stop at expiry.
                withTimeoutOrNull(WidgetAccess.remainingMillis(app)) {
                    weather.load(place, state.units, AppLocale.systemTags(), force = false)
                }
            }
            for (id in installed(app)) redraw(app, id)
        }

        private fun installed(context: Context): List<Int> {
            val manager = AppWidgetManager.getInstance(context)
            return listOf(CurrentReceiver::class.java, ForecastReceiver::class.java, ClockReceiver::class.java, AirReceiver::class.java)
                .flatMap { manager.getAppWidgetIds(ComponentName(context, it)).toList() }
        }

        fun enqueue(context: Context) {
            if (installed(context).isEmpty()) return
            val work = WorkManager.getInstance(context)
            val remaining = WidgetAccess.remainingMillis(context)
            if (remaining > 0) {
                // This job must run offline too. Android may defer it during Doze.
                val expiry = OneTimeWorkRequestBuilder<WidgetRefresh>()
                    .setInputData(workDataOf(DISPLAY_ONLY to true))
                    .setInitialDelay(remaining, TimeUnit.MILLISECONDS)
                    .build()
                work.enqueueUniqueWork("weather-widget-expiry", ExistingWorkPolicy.REPLACE, expiry)
            }
            work.enqueueUniqueWork("weather-widget-refresh", ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<WidgetRefresh>().build())
        }
    }
}
