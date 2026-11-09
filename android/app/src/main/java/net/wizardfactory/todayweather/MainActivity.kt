package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.wizardfactory.todayweather.ads.AdMobBanner
import net.wizardfactory.todayweather.ads.AdsConsent
import net.wizardfactory.todayweather.ads.BannerSlot
import net.wizardfactory.todayweather.ads.TwAds
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.core.data.SettingsActions
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.Telemetry
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.settings.About
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.domain.settings.SettingLists
import net.wizardfactory.todayweather.core.domain.shell.AppLanguage
import net.wizardfactory.todayweather.core.domain.shell.StartupPage
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.startShows
import net.wizardfactory.todayweather.location.AndroidLocationAccess
import net.wizardfactory.todayweather.location.LocationSwitch
import net.wizardfactory.todayweather.ui.air.rememberAirTab
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.forecast.rememberWeatherTab
import net.wizardfactory.todayweather.ui.nation.NationLoads
import net.wizardfactory.todayweather.ui.nation.NationRoutes
import net.wizardfactory.todayweather.ui.nation.NationScreen
import net.wizardfactory.todayweather.ui.settings.SettingsRoutes
import net.wizardfactory.todayweather.ui.settings.SettingsScreen
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.IonicPopup
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupButton
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell
import net.wizardfactory.todayweather.ui.shell.rememberShellNavigation
import net.wizardfactory.todayweather.ui.start.LocationRetryPopup
import net.wizardfactory.todayweather.ui.start.StartChoicePopup
import net.wizardfactory.todayweather.ui.start.StartPage
import net.wizardfactory.todayweather.ui.start.StartScreen

/**
 * The launcher activity. It keeps the Cordova component name (`net.wizardfactory.todayweather/.MainActivity`),
 * so home-screen shortcuts of the Cordova app open it. The splash screen stays until the Cordova data migration
 * has finished, and entry intents wait for it too. While the startup gate holds, the start page S01 shows instead of
 * the tabs (#2889); the tabs then open on Hourly.
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as TodayWeatherApp
    private lateinit var opened: OpenedModel
    private lateinit var banner: AdMobBanner
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
        app.location.attach(this)
        if (savedInstanceState == null) app.entryIntents.submit(intent)
        val session = opened.session
        // The banner belongs to this activity: a configuration change loads a new one at the new width (V21).
        banner = AdMobBanner(this, BuildConfig.BANNER_AD_UNIT, app.analytics::track)
        opened.ads.attach(banner)
        // UMP and the Ads SDK start with the tabs, after the start page (TabCtrl's `TwAds.init`).
        lifecycleScope.launch {
            app.appState.state.first { it != null && !it.startShows }
            opened.consent.start(this@MainActivity)
        }
        val privacy = PrivacyActions(app.analytics.choice, app.analytics::setCollectionEnabled) { onUnavailable ->
            opened.consent.openPrivacyOptions(this, onUnavailable)
        }
        setContent {
            val state by app.appState.state.collectAsState()
            // The start page closed in this app open: the tabs open on Hourly (`close()`).
            var afterStart by rememberSaveable { mutableStateOf(false) }
            state?.let { s ->
                if (s.startShows) {
                    LaunchedEffect(Unit) {
                        afterStart = true
                        app.analytics.screen("start")
                    }
                    StartScreen(opened.start, app.places, { app.towns.await() }, onExit = ::finish,
                        openAppSettings = { AndroidLocationAccess.openAppSettings(this) },
                        openLocationSettings = { AndroidLocationAccess.openLocationSettings(this) })
                    return@let
                }
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
                        onShare = WeatherShare(this, app.appState::current, { app.weather.weather.value }, session::openStartPopup)::share,
                    )
                }
                val handoffs = remember(context) {
                    // The user agent may load the WebView the first time: the mail is built off the main thread.
                    MenuHandoffs(openSystem = { url -> Handoff.openSystem(this, url) }, sendFeedback = {
                        lifecycleScope.launch { Handoff.openLink(this@MainActivity, withContext(Dispatchers.Default) { Handoff.feedbackMail(this@MainActivity) }) }
                    })
                }
                val shown by opened.ads.shown.collectAsState()
                AppContent(s, entries, loading, retry, session, host, BuildConfig.VERSION_NAME, onExit = ::finish, settings = opened.settings,
                    handoffs = handoffs, nation = opened.nation, privacy = privacy, banner = if (shown) ({ BannerSlot(banner) }) else null,
                    onScreen = app.analytics::screen, startTab = if (afterStart) Tab.HOURLY else null,
                    openAppSettings = { AndroidLocationAccess.openAppSettings(this) },
                    openLocationSettings = { AndroidLocationAccess.openLocationSettings(this) })
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Cordova's `resume`: each return to the foreground reloads the selected place if the gate allows.
        if (resumedBefore) opened.session.reload(WeatherSession.Sender.RESUME)
        resumedBefore = true
        banner.resume()
    }

    override fun onPause() {
        banner.pause()
        super.onPause()
    }

    override fun onDestroy() {
        app.location.detach(this)
        opened.consent.stop(this)
        opened.ads.detach(banner)
        banner.destroy()
        super.onDestroy()
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
 * The app's screens over the saved [state]:
 * - the shell with the weather tabs (#2887) and the Air tab (#2888);
 * - over the tabs, the settings pages, the menu's hand-offs and About popup (#2891), and the nationwide and warning
 *   pages (#2892);
 * - the menu's privacy rows, the banner under the tab bar and the routes reported to analytics (#2894);
 * - the retry confirmation, the current position's confirmation (O03 `forecast`) and, with no enabled place, the start
 *   choice O02 that a weather page, a weather or Air tab tapped or a share opens (#2889).
 * The Locations tab comes with AN-11.
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
    nation: NationLoads? = null,
    privacy: PrivacyActions? = null,
    /** The banner while it shows (AN-15). */
    banner: (@Composable () -> Unit)? = null,
    /** The route shown, as the Cordova state names it (`$stateChangeSuccess`, `screen_view`). */
    onScreen: (String) -> Unit = {},
    /** The tab to open on instead of the startup page: Hourly after the start page (`close()`). */
    startTab: Tab? = null,
    /** `switchToSettings()` and `switchToLocationSettings()` of the current position's confirmation. */
    openAppSettings: () -> Unit = {},
    openLocationSettings: () -> Unit = {},
) {
    val theme = Theme.of(state.settings.theme)
    val navigation = rememberShellNavigation(startTab ?: StartupPage.tab(state.settings.startupPage))
    // `?code=` of /tab/air: the pollutant S03 or S04 opened S05 on. The weather tabs keep it in the URL (`$location.path`),
    // so S05 opens on it again; the Locations tab replaces the URL (`href="#/tab/search"`) and clears it.
    var airCode by rememberSaveable { mutableStateOf<String?>(null) }
    // The settings pages (SettingsRoutes) and the nationwide and warning pages (NationRoutes) open over the tabs, last on
    // top; a saved route this version does not have is dropped. About is a popup over the menu (O10).
    val known = { route: String -> SettingsRoutes.known(route) || NationRoutes.known(route) }
    var saved by rememberSaveable { mutableStateOf(listOf<String>()) }
    val pages = saved.filter(known)
    fun open(route: String) { saved = saved.filter(known) + route }
    fun back() {
        pages.lastOrNull()?.takeIf(NationRoutes::known)?.let { nation?.close(it) }
        saved = saved.filter(known).dropLast(1)
    }
    // A nationwide or warning page sends its request when it opens (`clickMenu`: close the menu, then the page).
    fun openNation(route: String) {
        navigation.menuOpen = false
        nation?.open(route)
        open(route)
    }
    val nationPages by (nation?.pages ?: remember { MutableStateFlow(emptyMap()) }).collectAsState()
    var about by rememberSaveable { mutableStateOf(false) }
    // 선택적 이용 통계's popup and the privacy alerts (`showAlert('TodayWeather', …)`), by their message.
    var analyticsPopup by rememberSaveable { mutableStateOf(false) }
    var privacyAlert by rememberSaveable { mutableStateOf<Int?>(null) }
    val analyticsChoice by (privacy?.choice ?: remember { MutableStateFlow(false) }).collectAsState()
    val applies by session.applies.collectAsState()
    val locating by session.locating.collectAsState()
    val startPopup by session.startPopup.collectAsState()
    val autoSearch by session.autoSearch.collectAsState()
    val positionRetry by session.positionRetry.collectAsState()
    fun openLocations() {
        airCode = null
        navigation.selected = Tab.LOCATIONS
    }
    // O02's answer: the current position on Hourly, or the Locations tab.
    fun started(currentPosition: Boolean) = if (currentPosition) navigation.selected = Tab.HOURLY else openLocations()
    val screen = pages.lastOrNull()?.let(::screenName) ?: "tab.${navigation.selected.state}"
    LaunchedEffect(screen) { onScreen(screen) }
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
                MenuRow.ANALYTICS to stringResource(if (analyticsChoice) R.string.LOC_ANALYTICS_ALLOWED else R.string.LOC_ANALYTICS_DISABLED),
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
                MenuRow.SPECIAL_WEATHER -> openNation(NationRoutes.WARNINGS)
                MenuRow.NATIONAL_WEATHER -> openNation(NationRoutes.NATION)
                MenuRow.NATIONAL_AIR -> openNation(NationRoutes.NATION_AIR)
                // The privacy rows leave the menu open.
                MenuRow.ANALYTICS -> analyticsPopup = true
                MenuRow.AD_PRIVACY -> privacy?.openAdPrivacy?.invoke { privacyAlert = R.string.LOC_AD_PRIVACY_UNAVAILABLE }
                MenuRow.PRIVACY_POLICY, MenuRow.TERMS ->
                    handoffs.openSystem(Handoffs.policyPage(if (row == MenuRow.TERMS) "terms" else "privacy", AppLanguage.catalog(AppLocale.systemTags().firstOrNull())))
                MenuRow.VERSION -> {}
            }
        },
        banner = banner,
        onExit = onExit,
        navigation = navigation,
        onSelect = { tab -> if (tab == Tab.LOCATIONS) airCode = null },
        // `doTabForecast`: with no enabled place a weather or Air tab asks how to start instead.
        onTabTap = { tab ->
            val none = tab != Tab.LOCATIONS && PlaceIndex.enabledCount(state.places.map { it.disable }) == 0
            if (none) session.openStartPopup()
            none
        },
        overlay = {
            pages.lastOrNull()?.let { route ->
                if (NationRoutes.known(route)) {
                    // A page restored after the process ended has not sent its request in this one.
                    LaunchedEffect(route) { nation?.ensure(route) }
                    NationScreen(route, nationPages[route], theme, AppLocale.region(), state.units, texts, onBack = ::back)
                } else {
                    SettingsScreen(route, state, theme, texts, onBack = ::back,
                        onUnit = { name -> open(SettingsRoutes.list(name)) },
                        onChoose = { name, value -> settings?.choose(name, value) })
                }
            }
        },
        popups = {
            if (about) About { texts[it] }.let { a -> IonicAlert(a.title, a.lines, a.ok, onClose = { about = false }) }
            if (analyticsPopup) {
                // `chooseAnalytics`: back closes it without a choice.
                fun choose(value: Boolean) {
                    analyticsPopup = false
                    if (privacy?.setAnalytics?.invoke(value) == false) privacyAlert = R.string.LOC_PRIVACY_SAVE_FAILED
                }
                IonicPopup(stringResource(R.string.LOC_ANALYTICS_CHOICE), listOf(stringResource(R.string.LOC_ANALYTICS_DETAIL)),
                    listOf(PopupButton(stringResource(R.string.LOC_ANALYTICS_DENY)) { choose(false) },
                        PopupButton(stringResource(R.string.LOC_ANALYTICS_ALLOW)) { choose(true) }),
                    onBack = { analyticsPopup = false })
            }
            privacyAlert?.let { message -> IonicAlert("TodayWeather", listOf(stringResource(message)), stringResource(R.string.LOC_OK), onClose = { privacyAlert = null }) }
            if (startPopup) {
                StartChoicePopup(autoSearch, onChoose = session::chooseAutoSearch, onOk = { started(session.startChoice(ok = true)) },
                    onBack = { started(session.startChoice(ok = false)) })
            }
            positionRetry?.let { confirm ->
                LocationRetryPopup(confirm, onBack = session::closePositionRetry) { button ->
                    when (button) {
                        RetryButton.CLOSE -> session.closePositionRetry()
                        RetryButton.SEARCH -> {
                            session.searchInsteadOfPosition()
                            openLocations()
                        }
                        RetryButton.APP_SETTINGS -> {
                            session.closePositionRetry()
                            openAppSettings()
                        }
                        RetryButton.LOCATION_SETTINGS -> {
                            session.closePositionRetry()
                            openLocationSettings()
                        }
                        RetryButton.RETRY -> session.confirmPositionRetry()
                    }
                }
            }
        },
    ) { tab ->
        when (tab) {
            Tab.HOURLY, Tab.DAILY -> rememberWeatherTab(tab, state, entries, loading, theme, host, onAirInfo = { code ->
                // `goAirInfoPage(code)`: /tab/air?code=.
                airCode = code
                navigation.selected = Tab.AIR
            }, onUnits = openUnits, applies = applies, locating = locating, onNoPlace = session::openStartPopup)
            Tab.AIR -> rememberAirTab(state, entries, loading, theme, host, airCode, applies, onWeather = { navigation.selected = Tab.HOURLY },
                onUnits = openUnits)
            else -> TabContent() // AN-11
        }
    }
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
    private val telemetry = Telemetry { name, params -> twApp.analytics.track(name, params) }

    /** `window.updateCityInfo(index)`: a place's alarms follow its update, in the app's scope (`Push.updateCityInfo`). */
    private val cityUpdated: (Int) -> Unit = { index -> twApp.appScope.launch(Dispatchers.IO) { twApp.push.updateCity(index) } }

    val session = WeatherSession(twApp.weather, viewModelScope, twApp.appState, ::languages, { twApp.photos.photos }, ::loadPhotos,
        telemetry = telemetry, location = twApp.location, cityUpdated = cityUpdated)

    /** The start page's visit of this app open (S01, #2889). */
    val start: StartPage by lazy {
        StartPage(StartFlow(twApp.appState, twApp.weather, twApp.geocode, twApp.location, ::languages, telemetry, cityUpdated), viewModelScope)
    }

    /** `locationOn`: location services turned on while the app is open reload a selected current position. */
    private val locationSwitch = LocationSwitch(app) { session.reload(WeatherSession.Sender.LOCATION_ON) }

    /** The banner of this app open (TabCtrl's `TwAds.init`) and its Remote Config policy. */
    val ads = TwAds(viewModelScope, RemoteBannerConfig(twApp.remoteConfigSource(), viewModelScope), twApp.analytics::track, SystemClock::elapsedRealtime)

    /** UMP and the Ads SDK start of this app open. */
    val consent = AdsConsent(twApp.adsPlatform(), BuildConfig.RELEASE_ADS, twApp.analytics::track, ads::onSdkReady)

    /** The settings pages' changes; a unit change posts the push list again in the app's scope (`Push.updateUnits`). */
    val settings = SettingsActions(twApp.appState, session) { twApp.appScope.launch(Dispatchers.IO) { twApp.push.updateUnits() } }

    /** The open nationwide and warning pages' requests, kept across configuration changes while a page is open. */
    val nation = NationLoads(twApp.nation, viewModelScope, { twApp.appState.current()?.units }, ::languages)

    init {
        twApp.onOpened()
        twApp.analytics.onOpened()
        // `todayweather://N`: the place is selected and loads (`branchInit`, `reloadEvent 'deeplink'`), once the start page has closed.
        viewModelScope.launch { twApp.entryLinks.deliver(twApp.appState.state, ready = { !it.startShows }, open = session::openPlace) }
        loadPhotos()
        connectivity.registerDefaultNetworkCallback(online)
        locationSwitch.register()
        viewModelScope.launch {
            twApp.migration.await()
            var state = twApp.appState.state.first { it != null }!!
            // The start page hides the banner while it shows, and its close shows it again (`setShowAds`); the tabs' loading
            // starts after it (TabCtrl `init`).
            if (state.startShows) {
                ads.setShowAds(false)
                state = twApp.appState.state.first { it != null && !it.startShows }!!
                ads.setShowAds(true)
            }
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
        locationSwitch.unregister()
    }
}

/** The Cordova state name of a page over the tabs (`screen_view`). */
private fun screenName(route: String): String = when {
    route == SettingsRoutes.UNITS -> "units"
    SettingsRoutes.known(route) -> "setting-radio"
    else -> route // the nationwide and warning pages are named as their states
}

/** The device's languages for `Accept-Language`, as the WebView sent them. */
private fun languages(): List<String> = LocaleListCompat.getAdjustedDefault().toLanguageTags().split(",").filter { it.isNotEmpty() }
