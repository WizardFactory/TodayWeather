package net.wizardfactory.todayweather

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import net.wizardfactory.todayweather.core.data.HttpPushTransport
import net.wizardfactory.todayweather.core.data.PushTransport
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaMigrator

/** The application and its dependencies. Device tests replace dependencies in a subclass (androidTest). */
open class TodayWeatherApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    open fun serverUrl(): String = BuildConfig.SERVER_URL
    open fun tokenSource(): TokenSource = FirebaseTokenSource(this)
    open fun pushTransport(): PushTransport = HttpPushTransport(serverUrl())

    /** The Cordova data migration, started on every launch; it does nothing after the first one. */
    lateinit var migration: Deferred<AppState>
        private set

    /** Push re-registration after the migration (gate G1, push part). */
    lateinit var pushStartup: Deferred<PushStartup.Outcome?>
        private set

    override fun onCreate() {
        super.onCreate()
        migration = appScope.async(Dispatchers.IO) { CordovaMigrator(this@TodayWeatherApp).migrateIfNeeded() }
        pushStartup = appScope.async(Dispatchers.IO) {
            PushStartup(this@TodayWeatherApp, serverUrl(), tokenSource(), pushTransport()).run(migration.await())
        }
    }
}
