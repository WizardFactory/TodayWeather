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
import net.wizardfactory.todayweather.core.storage.Place

/** Launcher updates and main-app visits share the same cache and per-place refresh. */
class WidgetRefresh(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getInt(MANUAL_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        refresh(applicationContext as TodayWeatherApp, inputData.getBoolean(DISPLAY_ONLY, false),
            manualId = id.takeUnless { it == AppWidgetManager.INVALID_APPWIDGET_ID },
            displayedPlaceKey = inputData.getString(DISPLAYED_PLACE))
        return Result.success()
    }

    companion object {
        private const val DISPLAY_ONLY = "display_only"
        private const val MANUAL_ID = "manual_widget_id"
        private const val DISPLAYED_PLACE = "displayed_place"
        private val INTERVAL = TimeUnit.HOURS.toMillis(1)

        internal suspend fun refresh(
            app: TodayWeatherApp,
            displayOnly: Boolean,
            weather: WeatherRepository = app.weather,
            manualId: Int? = null,
            displayedPlaceKey: String? = null,
            now: () -> Long = System::currentTimeMillis,
            redraw: suspend (Context, Int) -> Unit = ::redrawWidget,
        ) {
            val ids = installed(app)
            if (ids.isEmpty()) return
            // Publish the prompt or cached weather before any potentially slow network work.
            for (id in ids) redraw(app, id)
            if (displayOnly || !WidgetAccess.allowed(app)) return

            app.appState.state.filterNotNull().first()
            val targets = if (manualId == null) ids else ids.filter { it == manualId }
            for (id in targets) {
                if (!WidgetAccess.allowed(app)) break
                val state = app.appState.state.value ?: continue
                val options = WidgetOptions.read(app, id)
                if (options.manualRefresh != (manualId != null)) continue
                val place = WidgetOptions.resolve(state, options.placeKey) ?: continue
                if (manualId != null && WidgetOptions.key(place) != displayedPlaceKey) continue
                val cached = weather.cachedForWidget(place)
                if (cached != null && now() - cached.loadedAt < INTERVAL) continue
                // Disk cache reads may suspend while this widget is removed, reconfigured, or follows another place.
                val latestState = app.appState.state.value ?: continue
                if (id !in installed(app) || WidgetOptions.read(app, id) != options ||
                    WidgetOptions.resolve(latestState, options.placeKey) != place) continue
                withTimeoutOrNull(WidgetAccess.remainingMillis(app)) {
                    weather.loadFromWidget(place, latestState.units, AppLocale.systemTags()) {
                        WidgetAccess.allowed(app) && reserveAttempt(app, place, now())
                    }
                }
            }
            for (id in installed(app)) redraw(app, id)
        }

        // All widget workers run in this process. Commit before sending so concurrent taps,
        // a process restart, and failed responses observe the same per-place budget.
        @Synchronized
        private fun reserveAttempt(context: Context, place: Place, now: Long): Boolean {
            val attempts = context.getSharedPreferences("widget_weather_attempts", Context.MODE_PRIVATE)
            val keys = setOf(WeatherRepository.key(place), WeatherRepository.locationKey(place))
            if (keys.any { attempts.contains(it) && now - attempts.getLong(it, 0) < INTERVAL }) return false
            val edit = attempts.edit()
            // Do not keep a history of the user's past GPS coordinates.
            for ((oldKey, timestamp) in attempts.all) {
                if (timestamp is Long && now - timestamp >= INTERVAL) edit.remove(oldKey)
            }
            keys.forEach { edit.putLong(it, now) }
            return edit.commit()
        }

        fun enqueueManual(context: Context, id: Int, displayedPlaceKey: String?) {
            if (displayedPlaceKey == null || !WidgetAccess.allowed(context) || id !in installed(context)) return
            val request = OneTimeWorkRequestBuilder<WidgetRefresh>()
                .setInputData(workDataOf(MANUAL_ID to id, DISPLAYED_PLACE to displayedPlaceKey))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("weather-widget-manual-$id", ExistingWorkPolicy.KEEP, request)
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
