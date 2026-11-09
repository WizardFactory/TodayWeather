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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.location.LocationManagerCompat
import androidx.core.os.LocaleListCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.wizardfactory.todayweather.core.data.SettingsActions
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.settings.About
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.domain.settings.SettingLists
import net.wizardfactory.todayweather.core.domain.shell.StartupPage
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.ui.air.rememberAirTab
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.forecast.rememberWeatherTab
import net.wizardfactory.todayweather.ui.settings.SettingsRoutes
import net.wizardfactory.todayweather.ui.settings.SettingsScreen
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell
import net.wizardfactory.todayweather.ui.shell.rememberShellNavigation

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
                val handoffs = remember(context) {
                    // The user agent may load the WebView the first time: the mail is built off the main thread.
                    MenuHandoffs(openSystem = { url -> Handoff.openSystem(this, url) }, sendFeedback = {
                        lifecycleScope.launch { Handoff.openLink(this@MainActivity, withContext(Dispatchers.Default) { Handoff.feedbackMail(this@MainActivity) }) }
                    })
                }
                AppContent(s, entries, loading, retry, session, host, BuildConfig.VERSION_NAME, onExit = ::finish, settings = opened.settings, handoffs = handoffs)
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
 * The app's screens over the saved [state]: the shell with the weather tabs (#2887), the Air tab (#2888), the settings
 * pages over the tabs and the menu's hand-offs and About popup (#2891), and the retry confirmation. The Locations tab and
 * the menu's other pages come with their sub-issues (AN-10, AN-13, AN-15).
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
    settings: SettingsActions? = null,
    handoffs: MenuHandoffs = MenuHandoffs(),
) {
    val theme = Theme.of(state.settings.theme)
    val navigation = rememberShellNavigation(StartupPage.tab(state.settings.startupPage))
    // `?code=` of /tab/air: the pollutant S03 or S04 opened S05 on. The weather tabs keep it in the URL (`$location.path`),
    // so S05 opens on it again; the Locations tab replaces the URL (`href="#/tab/search"`) and clears it.
    var airCode by rememberSaveable { mutableStateOf<String?>(null) }
    // The settings pages open over the tabs (SettingsRoutes), last on top; a saved route this version does not have is
    // dropped. About is a popup over the menu (O10).
    var saved by rememberSaveable { mutableStateOf(listOf<String>()) }
    val pages = saved.filter(SettingsRoutes::known)
    fun open(route: String) { saved = saved.filter(SettingsRoutes::known) + route }
    fun back() { saved = saved.filter(SettingsRoutes::known).dropLast(1) }
    var about by rememberSaveable { mutableStateOf(false) }
    val applies by session.applies.collectAsState()
    val texts = host.texts
    val openUnits = { open(SettingsRoutes.UNITS) }
    TodayWeatherShell(
        ShellState(
            theme = theme,
            region = AppLocale.region(),
            startupTab = StartupPage.tab(state.settings.startupPage),
            version = version,
            menuValues = mapOf(
                MenuRow.STARTUP_PAGE to texts[SettingLists.startupPageLabel(state.settings.startupPage)],
                MenuRow.REFRESH_INTERVAL to texts[SettingLists.refreshIntervalLabel(state.settings.refreshInterval)],
                MenuRow.THEME to texts[SettingLists.themeLabel(state.settings.theme)],
                // Off until the opt-in of AN-15 (AnalyticsGuard keeps collection off).
                MenuRow.ANALYTICS to stringResource(R.string.LOC_ANALYTICS_DISABLED),
            ),
        ),
        // The selected Hourly, Daily or Air tab reloads the selected place (`reloadEvent` "tab").
        onRefresh = { session.reload(WeatherSession.Sender.TAB) },
        // SettingCtrl's `clickMenu` and `settingRadio`: the rows that leave the menu close it first (`toggleLeft`).
        onMenuRow = { row ->
            when (row) {
                MenuRow.UNITS -> {
                    navigation.menuOpen = false
                    openUnits()
                }
                MenuRow.STARTUP_PAGE, MenuRow.REFRESH_INTERVAL, MenuRow.THEME -> {
                    val name = when (row) {
                        MenuRow.STARTUP_PAGE -> "startupPage"
                        MenuRow.REFRESH_INTERVAL -> "refreshInterval"
                        else -> "theme"
                    }
                    navigation.menuOpen = false
                    settings?.opened(name)
                    open(SettingsRoutes.list(name))
                }
                MenuRow.NULLSCHOOL_WIND -> handoffs.openSystem(Handoffs.NULLSCHOOL)
                MenuRow.SEND_FEEDBACK -> {
                    navigation.menuOpen = false
                    handoffs.sendFeedback()
                }
                MenuRow.RATE -> {
                    navigation.menuOpen = false
                    handoffs.openSystem(Handoffs.STORE)
                }
                MenuRow.ABOUT -> about = true
                else -> {} // AN-13 and AN-15
            }
        },
        onExit = onExit,
        navigation = navigation,
        onSelect = { tab -> if (tab == Tab.LOCATIONS) airCode = null },
        overlay = {
            pages.lastOrNull()?.let { route ->
                SettingsScreen(route, state, theme, texts, onBack = ::back,
                    onUnit = { name -> open(SettingsRoutes.list(name)) },
                    onChoose = { name, value -> settings?.choose(name, value) })
            }
        },
    ) { tab ->
        when (tab) {
            Tab.HOURLY, Tab.DAILY -> rememberWeatherTab(tab, state, entries, loading, theme, host, onAirInfo = { code ->
                // `goAirInfoPage(code)`: /tab/air?code=.
                airCode = code
                navigation.selected = Tab.AIR
            }, onUnits = openUnits)
            Tab.AIR -> rememberAirTab(state, entries, loading, theme, host, airCode, applies, onWeather = { navigation.selected = Tab.HOURLY },
                onUnits = openUnits)
            else -> TabContent() // AN-10
        }
    }
    if (about) About { texts[it] }.let { a -> IonicAlert(a.title, a.lines, a.ok, onClose = { about = false }) }
    if (retry) RetryDialog(onClose = session::closeRetry, onRetry = session::confirmRetry)
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

    val session = WeatherSession(twApp.weather, viewModelScope, twApp.appState, ::languages, { twApp.photos.photos }, ::loadPhotos)

    /** The settings pages' changes; a unit change posts the push list again in the app's scope (`Push.updateUnits`). */
    val settings = SettingsActions(twApp.appState, session) { twApp.appScope.launch(Dispatchers.IO) { twApp.push.updateUnits() } }

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
