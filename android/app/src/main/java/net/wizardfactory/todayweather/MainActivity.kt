package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.res.stringResource
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.domain.shell.StartupPage
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.AppStateStore
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell

/**
 * The launcher activity. It keeps the Cordova component name (`net.wizardfactory.todayweather/.MainActivity`),
 * so home-screen shortcuts of the Cordova app open it. The splash screen stays until the Cordova data migration
 * has finished, and entry intents wait for it too.
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as TodayWeatherApp

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // The shell paints the Cordova status bar (#111111, config.xml) under light icons.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        splash.setKeepOnScreenCondition { !app.migration.isCompleted }
        ViewModelProvider(this)[OpenedModel::class.java]
        if (savedInstanceState == null) app.entryIntents.submit(intent)
        setContent {
            val state by produceState<AppState?>(null) {
                app.migration.await()
                AppStateStore.get(app).data.collect { value = it }
            }
            state?.let { s ->
                TodayWeatherShell(
                    ShellState(
                        theme = Theme.of(s.settings.theme),
                        region = AppLocale.region(),
                        startupTab = StartupPage.tab(s.settings.startupPage),
                        version = BuildConfig.VERSION_NAME,
                        menuValues = mapOf(
                            MenuRow.STARTUP_PAGE to stringResource(startupPageLabel(s.settings.startupPage)),
                            MenuRow.REFRESH_INTERVAL to stringResource(refreshIntervalLabel(s.settings.refreshInterval)),
                            MenuRow.THEME to stringResource(themeLabel(s.settings.theme)),
                            // Off until the opt-in of AN-15 (AnalyticsGuard keeps collection off).
                            MenuRow.ANALYTICS to stringResource(R.string.LOC_ANALYTICS_DISABLED),
                        ),
                    ),
                    onRefresh = {}, // AN-08 reloads the weather
                    onMenuRow = {}, // AN-12, AN-13 and AN-15 open the pages
                    onExit = ::finish,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        app.entryIntents.submit(intent)
    }
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
 * the start, and again when a network comes back (the `online` event) until a load succeeds.
 */
class OpenedModel(app: Application) : AndroidViewModel(app) {
    private val twApp = app as TodayWeatherApp
    private val connectivity = app.getSystemService(ConnectivityManager::class.java)
    private val online = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            loadPhotos()
        }
    }

    init {
        twApp.onOpened()
        loadPhotos()
        connectivity.registerDefaultNetworkCallback(online)
    }

    private fun loadPhotos() {
        twApp.appScope.launch { twApp.photos.load() }
    }

    override fun onCleared() {
        connectivity.unregisterNetworkCallback(online)
    }
}
