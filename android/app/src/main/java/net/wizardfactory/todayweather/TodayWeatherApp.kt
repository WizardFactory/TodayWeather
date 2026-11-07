package net.wizardfactory.todayweather

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaMigrator

class TodayWeatherApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The Cordova data migration, started on every launch; it does nothing after the first one. */
    lateinit var migration: Deferred<AppState>
        private set

    override fun onCreate() {
        super.onCreate()
        migration = appScope.async(Dispatchers.IO) { CordovaMigrator(this@TodayWeatherApp).migrateIfNeeded() }
    }
}
