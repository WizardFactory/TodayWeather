package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.location.LocationManagerCompat
import androidx.core.os.LocaleListCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.StartupPage
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.forecast.rememberWeatherTab
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell

/**
 * The launcher activity. It keeps the Cordova component name (`net.wizardfactory.todayweather/.MainActivity`),
 * so home-screen shortcuts of the Cordova app open it. The splash screen stays until the Cordova data migration
 * has finished, and entry intents wait for it too.
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as TodayWeatherApp
    private lateinit var opened: OpenedModel
    private var resumedBefore = false

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // The shell paints the Cordova status bar (#111111, config.xml) under light icons.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        splash.setKeepOnScreenCondition { !app.migration.isCompleted }
        opened = ViewModelProvider(this)[OpenedModel::class.java]
        if (savedInstanceState == null) app.entryIntents.submit(intent)
        val session = opened.session
        setContent {
            val state by app.appState.state.collectAsState()
            state?.let { s ->
                val entries by app.weather.weather.collectAsState()
                val loading by app.weather.loading.collectAsState()
                val retry by session.retry.collectAsState()
                val context = LocalContext.current
                val host = remember(context) {
                    WeatherTabHost(
                        texts = forecastTexts(context),
                        photos = opened.photoLoader,
                        readCache = { app.weather.cached(it) },
                        onPrevious = session::previous,
                        onNext = session::next,
                        onExpand = { expand -> app.appState.change { it.copy(expandShortChart = expand) } },
                        onLocationGlyph = ::switchToLocationSettings,
                        locationEnabled = ::isLocationEnabled,
                    )
                }
                AppContent(s, entries, loading, retry, session, host, BuildConfig.VERSION_NAME, onExit = ::finish)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Cordova's `resume`: each return to the foreground reloads the selected place if the gate allows.
        if (resumedBefore) opened.session.reload(WeatherSession.Sender.RESUME)
        resumedBefore = true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        app.entryIntents.submit(intent)
    }

    /** `isLocationEnabled()`: the device's location service. */
    private fun isLocationEnabled(): Boolean =
        LocationManagerCompat.isLocationEnabled(getSystemService(LocationManager::class.java))

    /** `switchToLocationSettings()`: with location off, the device's location settings, and the place loads again on return. */
    private fun switchToLocationSettings() {
        if (isLocationEnabled()) return
        runCatching { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
        app.appState.current()?.let { s -> s.places.getOrNull(s.placeIndex)?.let(app.weather::invalidate) }
    }
}

/**
 * The app's screens over the saved [state]: the shell with the weather tabs (#2887) and the retry confirmation. The
 * other tabs and the menu's pages come with their sub-issues (AN-09, AN-10, AN-12, AN-13, AN-15).
 */
@Composable
fun AppContent(
    state: AppState,
    entries: Map<String, WeatherEntry>,
    loading: Set<String>,
    retry: Boolean,
    session: WeatherSession,
    host: WeatherTabHost,
    version: String,
    onExit: () -> Unit,
) {
    val theme = Theme.of(state.settings.theme)
    TodayWeatherShell(
        ShellState(
            theme = theme,
            region = AppLocale.region(),
            startupTab = StartupPage.tab(state.settings.startupPage),
            version = version,
            menuValues = mapOf(
                MenuRow.STARTUP_PAGE to stringResource(startupPageLabel(state.settings.startupPage)),
                MenuRow.REFRESH_INTERVAL to stringResource(refreshIntervalLabel(state.settings.refreshInterval)),
                MenuRow.THEME to stringResource(themeLabel(state.settings.theme)),
                // Off until the opt-in of AN-15 (AnalyticsGuard keeps collection off).
                MenuRow.ANALYTICS to stringResource(R.string.LOC_ANALYTICS_DISABLED),
            ),
        ),
        // The selected Hourly, Daily or Air tab reloads the selected place (`reloadEvent` "tab").
        onRefresh = { session.reload(WeatherSession.Sender.TAB) },
        onMenuRow = {}, // AN-12, AN-13 and AN-15 open the pages
        onExit = onExit,
    ) { tab ->
        when (tab) {
            Tab.HOURLY, Tab.DAILY -> rememberWeatherTab(tab, state, entries, loading, theme, host)
            else -> TabContent() // AN-09 and AN-10
        }
    }
    if (retry) RetryDialog(onClose = session::closeRetry, onRetry = session::confirmRetry)
}

/** Labels of the menu values (controller.settingctrl.js L207-L282). */
internal fun startupPageLabel(value: String) = when (value) {
    "1" -> R.string.LOC_DAILY_FORECAST
    "2" -> R.string.LOC_SAVED_LOCATIONS
    "3" -> R.string.LOC_AIR_INFORMATION
    else -> R.string.LOC_HOURLY_FORECAST
}

internal fun refreshIntervalLabel(value: String) = when (value) {
    "30" -> R.string.LOC_30_MINUTES
    "60" -> R.string.LOC_1_HOUR
    "180" -> R.string.LOC_3_HOURS
    "360" -> R.string.LOC_6_HOURS
    "720" -> R.string.LOC_12_HOURS
    else -> R.string.LOC_MANUAL
}

internal fun themeLabel(value: String) = when (value) {
    "photo" -> R.string.LOC_WEATHER_PHOTO_THEME
    "dark" -> R.string.LOC_DARK_THEME
    "old" -> R.string.LOC_OLD_THEME
    else -> R.string.LOC_LIGHT_THEME
}

/**
 * Created once per app open, like the Cordova app's web page: kept across configuration changes, new after the
 * activity finished or the process ended. While the app is open the photo feed loads, as `loadCities` loads it at
 * the start, and again when a network comes back (the `online` event) until a load succeeds; the weather pages'
 * loading (TabCtrl) starts with a load of the selected place (`reloadEvent` "init").
 */
class OpenedModel(app: Application) : AndroidViewModel(app) {
    private val twApp = app as TodayWeatherApp
    private val connectivity = app.getSystemService(ConnectivityManager::class.java)
    private val online = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            loadPhotos()
        }
    }

    val photoLoader = PhotoLoader(app)

    val session = WeatherSession(twApp.weather, viewModelScope, twApp.appState, ::languages, { twApp.photos.photos })

    init {
        twApp.onOpened()
        loadPhotos()
        connectivity.registerDefaultNetworkCallback(online)
        viewModelScope.launch {
            twApp.migration.await()
            val state = twApp.appState.state.first { it != null }!!
            // The cached weather first, as Cordova showed the saved cities while it loaded.
            state.places.getOrNull(state.placeIndex)?.let { twApp.weather.cached(it) }
            session.reload(WeatherSession.Sender.INIT)
        }
    }

    private fun loadPhotos() {
        twApp.appScope.launch { if (twApp.photos.load() != null) session.photosLoaded() }
    }

    override fun onCleared() {
        connectivity.unregisterNetworkCallback(online)
    }
}

/** The device's languages for `Accept-Language`, as the WebView sent them. */
private fun languages(): List<String> = LocaleListCompat.getAdjustedDefault().toLanguageTags().split(",").filter { it.isNotEmpty() }
