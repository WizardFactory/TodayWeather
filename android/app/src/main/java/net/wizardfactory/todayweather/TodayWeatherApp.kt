package net.wizardfactory.todayweather

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import net.wizardfactory.todayweather.ads.AdsPlatform
import net.wizardfactory.todayweather.ads.GoogleAdsPlatform
import net.wizardfactory.todayweather.analytics.Analytics
import net.wizardfactory.todayweather.analytics.AnalyticsSdk
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.analytics.FirebaseAnalyticsSdk
import net.wizardfactory.todayweather.analytics.FirebaseRemoteConfigSource
import net.wizardfactory.todayweather.analytics.RemoteConfigSource
import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.HttpPushTransport
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.data.PushSync
import net.wizardfactory.todayweather.core.data.PushTransport
import net.wizardfactory.todayweather.core.data.Telemetry
import net.wizardfactory.todayweather.core.data.WeatherPhotoFeed
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.CordovaMigrator
import net.wizardfactory.todayweather.location.AndroidLocationAccess
import net.wizardfactory.todayweather.search.BundledTowns
import net.wizardfactory.todayweather.search.GooglePlaceSearch
import net.wizardfactory.todayweather.search.PlaceSearch

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
    open fun analyticsSdk(): AnalyticsSdk = FirebaseAnalyticsSdk(this)
    open fun adsPlatform(): AdsPlatform = GoogleAdsPlatform(this)

    /** Remote Config of the banner policy; none without the Firebase configuration. */
    open fun remoteConfigSource(): RemoteConfigSource? =
        if (FirebaseApp.getApps(this).isEmpty()) null else FirebaseRemoteConfigSource(FirebaseRemoteConfig.getInstance())

    /**
     * Usage analytics after an opt-in (#2894), started by EarlyStartProvider before Firebase. Test-unit builds report
     * `development` traffic, release builds `production`, as the Cordova builds did.
     */
    val analytics: Analytics by lazy { Analytics(analyticsSdk(), ConsentStore(this), if (BuildConfig.RELEASE_ADS) "production" else "development") }

    /** The Cordova data migration, started on every process start; it does nothing after the first one. */
    val migration: Deferred<AppState> by lazy { appScope.async(Dispatchers.IO) { migrate() } }

    protected open suspend fun migrate(): AppState = CordovaMigrator(this).migrateIfNeeded()

    /** Entry intents (launcher, notification taps), handled in order once the migration has finished. */
    val entryIntents: EntryIntents by lazy { EntryIntents(appScope, migration, ::onEntryIntent) }

    /** The place indexes of `todayweather://N` links, for the open app's session (AN-16). */
    val entryLinks = EntryLinks()

    /** Handles an entry intent after the migration: links here; notification taps are AN-14's work. */
    protected open fun onEntryIntent(intent: android.content.Intent) {
        entryLinks.accept(intent)
    }

    /** The weather photo feed of the photo theme, loaded once per process (AN-08 chooses each place's photo). */
    val photos: WeatherPhotoFeed by lazy { WeatherPhotoFeed(weatherPhotosUrl(), appScope) }

    /** The saved state as the screens see it, once the migration has finished; the only writer of the store after it. */
    val appState: AppStateHolder by lazy { AppStateHolder(AppStateStore.get(this), appScope, migration) }

    /** Each place's weather, cached in files so a cold start shows the last weather while it loads (#2887). */
    val weather: WeatherRepository by lazy {
        WeatherRepository(serverUrl(), File(filesDir, "weather"), telemetry = Telemetry { name, params -> analytics.track(name, params) })
    }

    /** The geocoding of the start page (#2889). */
    val geocode: GeocodeClient by lazy { GeocodeClient(serverUrl()) }

    /** The device's location (#2889); the shown activity lends it the system's prompts. */
    val location: AndroidLocationAccess by lazy { AndroidLocationAccess(this) }

    /** Google's place predictions with the build's Places key; none without one (#2889). */
    open fun placeSearch(): PlaceSearch? = BuildConfig.PLACES_API_KEY.takeIf { it.isNotBlank() }?.let { GooglePlaceSearch(this, it) }

    val places: PlaceSearch? by lazy { placeSearch() }

    /** The bundled towns, read once when a search needs them: S01 searches them in a build without a Places key. */
    val towns: Deferred<TownSearch> by lazy { appScope.async(Dispatchers.IO, CoroutineStart.LAZY) { TownSearch(BundledTowns.load(this@TodayWeatherApp)) } }

    /** The requests of the nationwide and warning pages (#2892). */
    val nation: NationSource by lazy { NationSource(serverUrl()) }

    /** Push registrations (gate G1, push part), one at a time; their token is saved in turn with the screens' changes. */
    val push: PushSync by lazy {
        PushSync(appState.dataStore, pushTransport()) { state -> pushContext(this, serverUrl(), state) }
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
