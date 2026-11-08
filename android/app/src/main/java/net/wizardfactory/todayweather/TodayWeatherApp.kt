package net.wizardfactory.todayweather

import android.app.Application
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import net.wizardfactory.todayweather.core.data.HttpPushTransport
import net.wizardfactory.todayweather.core.data.PushSync
import net.wizardfactory.todayweather.core.data.PushTransport
import net.wizardfactory.todayweather.core.data.WeatherPhotoFeed
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.core.storage.CordovaMigrator

/**
 * The application and its dependencies. Device tests replace dependencies in a subclass (androidTest).
 * Members are lazy because WorkManager can run a worker before [onCreate].
 */
open class TodayWeatherApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    open fun serverUrl(): String = BuildConfig.SERVER_URL
    open fun weatherPhotosUrl(): String = BuildConfig.WEATHER_PHOTOS_URL
    open fun tokenSource(): TokenSource = FirebaseTokenSource(this)
    open fun pushTransport(): PushTransport = HttpPushTransport(serverUrl())

    /** The Cordova data migration, started on every process start; it does nothing after the first one. */
    val migration: Deferred<AppState> by lazy { appScope.async(Dispatchers.IO) { migrate() } }

    protected open suspend fun migrate(): AppState = CordovaMigrator(this).migrateIfNeeded()

    /** Entry intents (launcher, notification taps), handled in order once the migration has finished. */
    val entryIntents: EntryIntents by lazy { EntryIntents(appScope, migration, ::onEntryIntent) }

    /** Handles an entry intent after the migration; notification taps are AN-14's work. */
    protected open fun onEntryIntent(intent: android.content.Intent) {}

    /** The weather photo feed of the photo theme, loaded once per process (AN-08 chooses each place's photo). */
    val photos: WeatherPhotoFeed by lazy { WeatherPhotoFeed(weatherPhotosUrl(), appScope) }

    /** The saved state as the screens see it, once the migration has finished. */
    val appState: AppStateHolder by lazy { AppStateHolder(AppStateStore.get(this), appScope, migration) }

    /** Each place's weather, cached in files so a cold start shows the last weather while it loads (#2887). */
    val weather: WeatherRepository by lazy { WeatherRepository(serverUrl(), File(filesDir, "weather")) }

    /** Push registrations (gate G1, push part), one at a time. */
    val push: PushSync by lazy {
        PushSync(AppStateStore.get(this), pushTransport()) { state -> pushContext(this, serverUrl(), state) }
    }

    /** The registration of the latest app open; null before the first. */
    @Volatile var opened: Deferred<PushSync.Outcome?>? = null
        private set

    /**
     * The app was opened ([MainActivity], not recreated for a configuration change): the Cordova `Push.init` of
     * every app start. A process started in the background (FCM, WorkManager) registers nothing.
     */
    fun onOpened(): Deferred<PushSync.Outcome?> = appScope.async(Dispatchers.IO) {
        migration.await()
        push.onStart { tokenSource().token() }
    }.also { opened = it }

    override fun onCreate() {
        super.onCreate()
        migration.start()
    }
}
