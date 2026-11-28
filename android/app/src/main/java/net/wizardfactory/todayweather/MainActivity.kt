package net.wizardfactory.todayweather

import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.key
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.Flow
import net.wizardfactory.todayweather.core.domain.alarms.ForegroundMessage
import net.wizardfactory.todayweather.core.data.AlarmPage
import net.wizardfactory.todayweather.core.data.LinkOpener
import net.wizardfactory.todayweather.core.data.LinkPage
import net.wizardfactory.todayweather.core.data.LinkPreview
import net.wizardfactory.todayweather.core.data.LinkRequest
import net.wizardfactory.todayweather.core.data.LinkRoute
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.data.answerAlertIntro
import net.wizardfactory.todayweather.notify.PushMessage
import net.wizardfactory.todayweather.ui.alarms.AlarmsScreen
import net.wizardfactory.todayweather.ui.alarms.AlarmsHost
import net.wizardfactory.todayweather.ui.alarms.AlarmRoutes
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
import net.wizardfactory.todayweather.ads.NativeForecastAds
import net.wizardfactory.todayweather.ads.ForecastInterstitial
import net.wizardfactory.todayweather.widget.WidgetAccess
import net.wizardfactory.todayweather.widget.WidgetRefresh
import net.wizardfactory.todayweather.ads.AdsConsent
import net.wizardfactory.todayweather.ads.rememberNativeAdSlot
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.ads.AdMobBanner
import net.wizardfactory.todayweather.ads.BannerSlot
import net.wizardfactory.todayweather.ads.TwAds
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.SettingsActions
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.Telemetry
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.forecast.PlaceIndex
import net.wizardfactory.todayweather.core.domain.places.PlaceRows
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
import net.wizardfactory.todayweather.location.LocationGlyph
import net.wizardfactory.todayweather.location.LocationSwitch
import net.wizardfactory.todayweather.ui.air.rememberAirTab
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.chart.ForecastChartImages
import net.wizardfactory.todayweather.ui.chart.LocalForecastChartImages
import net.wizardfactory.todayweather.ui.chart.LocalPreparedCharts
import net.wizardfactory.todayweather.ui.chart.PreparedChartCache
import net.wizardfactory.todayweather.ui.forecast.ForecastCharts
import net.wizardfactory.todayweather.ui.forecast.rememberWeatherTab
import net.wizardfactory.todayweather.ui.nation.IonicLoading
import net.wizardfactory.todayweather.ui.nation.NationLoads
import net.wizardfactory.todayweather.ui.nation.NationRoutes
import net.wizardfactory.todayweather.ui.nation.NationScreen
import net.wizardfactory.todayweather.ui.settings.SettingsRoutes
import net.wizardfactory.todayweather.ui.settings.SettingsScreen
import net.wizardfactory.todayweather.ui.shell.AnalyticsPopup
import net.wizardfactory.todayweather.ui.shell.AnalyticsWithdrawalProgress
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.IonicPopup
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupButton
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.TabContent
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell
import net.wizardfactory.todayweather.ui.shell.enableShellSystemBars
import net.wizardfactory.todayweather.ui.shell.rememberShellNavigation
import net.wizardfactory.todayweather.ui.places.PlacesHost
import net.wizardfactory.todayweather.ui.places.rememberPlacesTab
import net.wizardfactory.todayweather.ui.start.LocationRetryPopup
import net.wizardfactory.todayweather.ui.start.locationText
import net.wizardfactory.todayweather.ui.start.StartChoicePopup
import net.wizardfactory.todayweather.ui.start.StartPage
import net.wizardfactory.todayweather.ui.start.StartScreen

/**
 * The launcher activity. It keeps the Cordova component name (`net.wizardfactory.todayweather/.MainActivity`),
 * so home-screen shortcuts of the Cordova app open it. The splash screen stays until the Cordova data migration
 * has finished, and entry intents wait for it too. While the startup gate holds, the start page S01 shows instead of
 * the tabs (#2889); the tabs then open on Hourly. A linked place shown without being saved covers S01 until it is added
 * or left (#3096).
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as TodayWeatherApp

    /** The weather pages' location glyph: with location off, a tap clears the selected place's gate so it loads on return. */
    private val locationGlyph by lazy {
        LocationGlyph(this) { opened.preview.current()?.let { s -> s.places.getOrNull(s.placeIndex)?.let(app.weather::invalidate) } }
    }
    private lateinit var opened: OpenedModel
    private lateinit var nativeAds: NativeForecastAds
    private lateinit var interstitial: ForecastInterstitial
    private lateinit var banner: AdMobBanner
    private var resumedBefore = false

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableShellSystemBars()
        splash.setKeepOnScreenCondition { !app.migration.isCompleted }
        opened = ViewModelProvider(this)[OpenedModel::class.java]
        app.location.attach(this)
        app.notifications.attach(this)
        if (savedInstanceState == null) app.entryIntents.submit(intent)
        val session = opened.session
        nativeAds = NativeForecastAds(this, BuildConfig.NATIVE_AD_UNIT, app.analytics::track)
        interstitial = ForecastInterstitial(this, BuildConfig.INTERSTITIAL_AD_UNIT, app.analytics::track) {
            opened.adConfig.interstitialChance
        }
        // The anchored banner (#3211) belongs to this activity: a configuration change loads a new one at the new width.
        banner = AdMobBanner(this, BuildConfig.BANNER_AD_UNIT, app.analytics::track)
        opened.ads.attach(banner)
        lifecycleScope.launch {
            combine(opened.consent.allowed, opened.adConfig.policy) { consent, config -> consent to config }
                .collectLatest { (consent, config) ->
                    val allow = consent && config.ready && config.policy.enabled
                    val delayMs = adDelayRemaining(config)
                    refreshNativeEligibility()
                    interstitial.setEnabled(false)
                    if (allow) {
                        delay(delayMs)
                        refreshNativeEligibility()
                        interstitial.setEnabled(config.interstitialEnabled)
                    }
                }
        }
        // UMP and the Ads SDK start with the tabs, after the start page (TabCtrl's `TwAds.init`).
        lifecycleScope.launch {
            app.appState.state.first { it != null && !it.startShows }
            opened.consent.start(this@MainActivity)
        }
        val privacy = PrivacyActions(
            choice = app.analytics.choice,
            setAnalytics = app.analyticsChoices::submit,
            optIn = app.analytics.optInRegion,
            saveFailure = app.analyticsChoices.saveFailure,
            consumeFailure = app.analyticsChoices::consumeFailure,
            onPopupOpened = app.analyticsChoices::onPopupOpened,
            savingWithdrawal = app.analyticsChoices.savingWithdrawal,
        ) { onUnavailable ->
            opened.consent.openPrivacyOptions(this, ::refreshNativeEligibility, onUnavailable)
        }
        setContent {
            val saved by app.appState.state.collectAsState()
            // The screens see a place shown without being saved as the last place of the list (LinkPreview).
            val unsaved by opened.preview.unsaved.collectAsState()
            val previewPlace = unsaved?.place
            val state = saved?.let { LinkPreview.overlay(it, unsaved) }
            val link by opened.links.requests.collectAsState()
            // The start page closed in this app open: the tabs open on Hourly (`close()`).
            var afterStart by rememberSaveable { mutableStateOf(false) }
            state?.let { s ->
                if (s.startShows && previewPlace == null) {
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
                        onLocationGlyph = locationGlyph::tap,
                        locationEnabled = locationGlyph::enabled,
                    )
                }
                val weatherShare = remember(context) { WeatherShare(this, opened.preview::current, { app.weather.weather.value }, session::openStartPopup) }
                val handoffs = remember(context) {
                    // The user agent may load the WebView the first time: the mail is built off the main thread.
                    MenuHandoffs(openSystem = { url -> Handoff.openSystem(this, url) }, sendFeedback = {
                        lifecycleScope.launch { Handoff.openLink(this@MainActivity, withContext(Dispatchers.Default) { Handoff.feedbackMail(this@MainActivity) }) }
                    })
                }
                val bannerShown by opened.ads.shown.collectAsState()
                AppContent(s, entries, loading, retry, session, host, BuildConfig.VERSION_NAME, onExit = ::finish, settings = opened.settings,
                    handoffs = handoffs, nation = opened.nation, privacy = privacy, banner = if (bannerShown) ({ BannerSlot(banner) }) else null,
                    nativeAd = { tab ->
                        rememberNativeAdSlot(nativeAds, tab, dark = Theme.of(s.settings.theme) == Theme.DARK)
                    },
                    onVisit = interstitial::recordVisible, onRepeatVisit = interstitial::handleTap,
                    onScreen = app.analytics::screen, startTab = if (afterStart) Tab.HOURLY else null,
                    openAppSettings = { AndroidLocationAccess.openAppSettings(this) },
                    openLocationSettings = { AndroidLocationAccess.openLocationSettings(this) }, places = opened.places,
                    alarms = opened.alarms, messages = app.foreground.messages, alertIntro = opened.alertIntro,
                    link = link, onLinkHandled = opened.links::handled, preview = previewPlace != null,
                    onAddPreview = {
                        // No confirmation: the star saves at once and says so (#3180).
                        if (opened.addPreview()) Toast.makeText(this, R.string.link_added_favorite, Toast.LENGTH_SHORT).show()
                    },
                    share = weatherShare::share)
            }
        }
    }

    private fun adDelayRemaining(config: RemoteBannerConfig.State): Long =
        (opened.adStart + config.policy.delaySeconds * 1000L - SystemClock.elapsedRealtime()).coerceAtLeast(0L)

    private fun refreshNativeEligibility() {
        // The banner has its own switch and delay (TwAds); it shares the consent and privacy-form gate.
        opened.ads.setPermitted(!isFinishing && !isDestroyed && opened.consent.nativeAllowed)
        val config = opened.adConfig.policy.value
        nativeAds.setEnabled(!isFinishing && !isDestroyed && opened.consent.nativeAllowed &&
            config.ready && config.policy.enabled && config.nativeEnabled && adDelayRemaining(config) == 0L)
    }

    override fun onResume() {
        super.onResume()
        refreshNativeEligibility()
        nativeAds.setForeground(true)
        banner.resume()
        WidgetAccess.mainAppOpened(this)
        // Cordova's `resume`: each return to the foreground reloads the selected place if the gate allows.
        if (resumedBefore) opened.session.reload(WeatherSession.Sender.RESUME)
        resumedBefore = true
        app.foreground.resumed = true
    }

    override fun onPause() {
        nativeAds.setForeground(false)
        banner.pause()
        app.foreground.resumed = false
        super.onPause()
    }

    override fun onDestroy() {
        app.location.detach(this)
        app.notifications.detach()
        opened.consent.stop(this)
        nativeAds.destroy()
        interstitial.destroy()
        opened.ads.detach(banner)
        banner.destroy()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        app.entryIntents.submit(intent)
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
 * - the saved places S02 in the Locations tab (#2890);
 * - S09 from the bells, the weather-alert introduction O06 and messages while the app shows (O07) (#2893);
 * - `link.todayweather.ai` links (#3096): [link] closes the menu and the pages over the tabs, then opens its tab or
 *   page;
 * - the weather header's search button and star (#3180): the button opens S02's search and returns to its tab; a
 *   chosen result or a linked place shows without being saved ([preview]: the last place of [state]), with a star in
 *   the bell's position that saves it ([onAddPreview]). It stays in the list while the user moves to saved places and
 *   back.
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
    /** The saved places S02 (#2890): its search and a visit's page; none, an empty Locations tab. */
    places: PlacesHost? = null,
    /** S09's visits from the bells (#2893); none, bells that do nothing. */
    alarms: AlarmsHost? = null,
    /** Messages while the app shows, as O07 (#2893). */
    messages: Flow<PushMessage>? = null,
    /** O06 for alarms of the legacy `pushData` (#2893). */
    alertIntro: AlertIntro? = null,
    nativeAd: (@Composable (Tab) -> (@Composable () -> Unit))? = null,
    onVisit: (Tab) -> Unit = {},
    onRepeatVisit: (Tab, () -> Unit) -> Boolean = { _, _ -> false },
    /** A link to apply once, then reported with [onLinkHandled]. */
    link: LinkRequest? = null,
    onLinkHandled: (Long) -> Unit = {},
    /**
     * The last place of [state] is shown without being saved. While it is selected a star stands in the bell's position
     * and saves it ([onAddPreview]); S02 does not list it.
     */
    preview: Boolean = false,
    onAddPreview: () -> Unit = {},
    /** The share button with the tab shared from and its pollutant; null: [host]'s. */
    share: ((WeatherView, String?) -> Unit)? = null,
) {
    val theme = Theme.of(state.settings.theme)
    val forecastCharts = remember { ForecastCharts() }
    val context = LocalContext.current.applicationContext
    // The activity's decoded asset images (#3224), provided around the shell so every tab, page and popup reads through them.
    val forecastImages = remember(context) { ForecastChartImages(context) }
    // The activity's draw-ready chart layouts and paths (#3232), kept across tab visits and rebuilt on activity recreation.
    val preparedCharts = remember { PreparedChartCache() }
    val navigation = rememberShellNavigation(startTab ?: StartupPage.tab(state.settings.startupPage))
    // `?code=` of /tab/air: the pollutant S03 or S04 opened S05 on. The weather tabs keep it in the URL (`$location.path`),
    // so S05 opens on it again; the Locations tab replaces the URL (`href="#/tab/search"`) and clears it.
    var airCode by rememberSaveable { mutableStateOf<String?>(null) }
    // The pollutant S05 shows, which a share from it sends; an Air link opens S05 anew on its pollutant (`airLinks`).
    var airShown by remember { mutableStateOf<String?>(null) }
    var airLinks by rememberSaveable { mutableIntStateOf(0) }
    // The settings pages (SettingsRoutes) and the nationwide and warning pages (NationRoutes) open over the tabs, last on
    // top; a saved route this version does not have is dropped. About is a popup over the menu (O10).
    val known = { route: String -> SettingsRoutes.known(route) || NationRoutes.known(route) || (alarms != null && AlarmRoutes.known(route)) }
    var saved by rememberSaveable { mutableStateOf(listOf<String>()) }
    val pages = saved.filter(known)
    fun open(route: String) { saved = saved.filter(known) + route }
    // Each return from the pages over the tabs starts the tabs' views anew (`cache: false`): S02 reads its bells again.
    var returns by rememberSaveable { mutableIntStateOf(0) }
    fun back() {
        pages.lastOrNull()?.takeIf(NationRoutes::known)?.let { nation?.close(it) }
        saved = saved.filter(known).dropLast(1)
        if (saved.none(known)) returns++
    }
    // A nationwide or warning page sends its request when it opens (`clickMenu`: close the menu, then the page).
    fun openNation(route: String) {
        navigation.menuOpen = false
        nation?.open(route)
        open(route)
    }
    val nationPages by (nation?.pages ?: remember { MutableStateFlow(emptyMap()) }).collectAsState()
    var about by rememberSaveable { mutableStateOf(false) }
    // A link closes the menu, About and every page over the tabs at once (an open nationwide page's request ends).
    fun closeForLink() {
        navigation.menuOpen = false
        about = false
        val over = saved.filter(known)
        if (over.isEmpty()) return
        over.filter(NationRoutes::known).forEach { nation?.close(it) }
        saved = emptyList()
        returns++
    }
    // 이용 통계's popup and the privacy alerts (`showAlert('TodayWeather', …)`), by their message.
    var analyticsPopup by rememberSaveable { mutableStateOf(false) }
    var privacyAlert by rememberSaveable { mutableStateOf<Int?>(null) }
    val saveFailure by (privacy?.saveFailure ?: remember { MutableStateFlow(null) }).collectAsState()
    val savingWithdrawal by (privacy?.savingWithdrawal ?: remember { MutableStateFlow(false) }).collectAsState()
    val activeSaveFailure = if (analyticsPopup || savingWithdrawal) null else saveFailure
    val analyticsChoice by (privacy?.choice ?: remember { MutableStateFlow(false) }).collectAsState()
    val applies by session.applies.collectAsState()
    val locating by session.locating.collectAsState()
    val startPopup by session.startPopup.collectAsState()
    val autoSearch by session.autoSearch.collectAsState()
    val positionRetry by session.positionRetry.collectAsState()
    // The tab the header's search button was pressed on (#3180): S02 opens in search mode and returns there.
    var searchFrom by rememberSaveable { mutableStateOf<String?>(null) }
    fun openLocations() {
        airCode = null
        searchFrom = null
        navigation.selected = Tab.LOCATIONS
    }
    fun openSearch() {
        searchFrom = navigation.selected.name
        navigation.selected = Tab.LOCATIONS
    }
    fun closeSearch() {
        searchFrom?.let { navigation.selected = Tab.valueOf(it) }
        searchFrom = null
    }
    // O02's answer: the current position on Hourly, or the Locations tab.
    fun started(currentPosition: Boolean) = if (currentPosition) navigation.selected = Tab.HOURLY else openLocations()
    // A visit of S02 while the Locations tab shows (`cache: false`): new each time it opens.
    val placesPage = if (navigation.selected == Tab.LOCATIONS && places != null) {
        key(returns) {
            val scope = rememberCoroutineScope()
            remember { places.newPage(scope) }
        }
    } else {
        null
    }
    // The bells open S09: the weather header's for the selected place (`goPushPage`), S02's for its row.
    // A place not saved has a star, which saves it, where a saved one has its bell; a share carries the tab shared from.
    val selectedIndex by rememberUpdatedState(state.placeIndex)
    val previewShown by rememberUpdatedState(preview && state.placeIndex == state.places.lastIndex)
    val addPreview by rememberUpdatedState(onAddPreview)
    val shareTab by rememberUpdatedState(navigation.selected)
    val sharePollutant by rememberUpdatedState(airShown ?: airCode)
    val bellHost = remember(host, alarms, share) {
        WeatherTabHost(host.texts, host.photos, host.readCache, host.onPrevious, host.onNext, host.onExpand,
            onBell = if (alarms == null) host.onBell else ({ open(AlarmRoutes.of(selectedIndex)) }),
            onShare = if (share == null) host.onShare else ({
                val view = when (shareTab) { Tab.DAILY -> WeatherView.DAILY; Tab.AIR -> WeatherView.AIR; else -> WeatherView.HOURLY }
                share(view, if (view == WeatherView.AIR) sharePollutant else null)
            }),
            onLocationGlyph = host.onLocationGlyph, locationEnabled = host.locationEnabled,
            onSearch = ::openSearch, unsaved = { previewShown }, onStar = { addPreview() })
    }
    // O07: one message at a time while the tabs show (Ionic's popups wait in a queue).
    val foregroundMessages = remember { mutableStateListOf<PushMessage>() }
    if (messages != null) LaunchedEffect(messages) { messages.collect { foregroundMessages += it } }
    // O06: 500 ms after the open, over the tabs, once per app open while the introduction is due.
    var intro by remember { mutableStateOf(false) }
    if (alertIntro != null && state.push.needsAlertIntro) {
        LaunchedEffect(Unit) {
            if (alertIntro.due()) {
                delay(500)
                intro = true
            }
        }
    }
    // `goPage()`: the startup page's tab with `reloadEvent 'search'`; a result of a search opened from a weather
    // header goes back to that tab (#3180).
    fun openFromPlaces(index: Int?) {
        navigation.selected = searchFrom?.let(Tab::valueOf) ?: PlaceRows.startTab(state.settings.startupPage)
        searchFrom = null
        session.openFromSearch(index)
    }
    // A link (specs/deeplink.md §6.2): the menu, About and the pages over the tabs close, then its tab or page opens.
    if (link != null) {
        LaunchedEffect(link.id) {
            when (val route = link.route) {
                is LinkRoute.Weather -> {
                    closeForLink()
                    airCode = if (route.view == WeatherView.AIR) route.pollutant else null
                    if (route.view == WeatherView.AIR) airLinks++
                    navigation.selected = when (route.view) {
                        WeatherView.HOURLY -> Tab.HOURLY
                        WeatherView.DAILY -> Tab.DAILY
                        WeatherView.AIR -> Tab.AIR
                    }
                }
                is LinkRoute.Page -> {
                    closeForLink()
                    openNation(when (route.page) {
                        LinkPage.NATION_WEATHER -> NationRoutes.NATION
                        LinkPage.NATION_AIR -> NationRoutes.NATION_AIR
                        LinkPage.WARNINGS -> NationRoutes.WARNINGS
                    })
                }
                LinkRoute.App -> closeForLink()
            }
            onLinkHandled(link.id)
        }
    }
    val screen = pages.lastOrNull()?.let(::screenName) ?: "tab.${navigation.selected.state}"
    LaunchedEffect(screen) { onScreen(screen) }
    val tabContentVisible = pages.isEmpty() && !navigation.menuOpen && !retry && !startPopup &&
        positionRetry == null && !about && !intro && !analyticsPopup && !savingWithdrawal && privacyAlert == null && activeSaveFailure == null && foregroundMessages.isEmpty()
    val selected = navigation.selected
    var forecastRead by remember(selected, state.placeIndex, tabContentVisible) { mutableStateOf(false) }
    LaunchedEffect(selected, tabContentVisible) { if (tabContentVisible) onVisit(selected) }
    val city = state.places.getOrNull(state.placeIndex)?.let(WeatherRepository::key)
    val placement = key(selected, city) { nativeAd?.invoke(selected) }
    var adHeightPx by remember(selected, city) { mutableIntStateOf(0) }
    val visibleAd: (@Composable () -> Unit)? = placement?.let { render ->
        {
            if (tabContentVisible) {
                Box(Modifier.onSizeChanged { adHeightPx = it.height }) { render() }
            } else {
                // Keep the reading position while the creative and its touch targets are covered.
                Spacer(Modifier.height(with(LocalDensity.current) { adHeightPx.toDp() }))
            }
        }
    }
    val texts = host.texts
    val openUnits = { open(SettingsRoutes.UNITS) }
    CompositionLocalProvider(
        LocalForecastChartImages provides forecastImages,
        LocalPreparedCharts provides preparedCharts,
    ) {
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
                    MenuRow.ANALYTICS to stringResource(if (analyticsChoice) R.string.analytics_on else R.string.analytics_off),
                ),
            ),
            // A pull bypasses the freshness gate for the selected place.
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
                    MenuRow.ANALYTICS -> {
                        privacy?.onPopupOpened?.invoke()
                        analyticsPopup = true
                    }
                    MenuRow.AD_PRIVACY -> privacy?.openAdPrivacy?.invoke { privacyAlert = R.string.LOC_AD_PRIVACY_UNAVAILABLE }
                    MenuRow.PRIVACY_POLICY, MenuRow.TERMS ->
                        handoffs.openSystem(Handoffs.policyPage(if (row == MenuRow.TERMS) "terms" else "privacy", AppLanguage.catalog(AppLocale.systemTags().firstOrNull())))
                    MenuRow.VERSION -> {}
                }
            },
            banner = banner,
            onExit = onExit,
            navigation = navigation,
            onSelect = { tab ->
                searchFrom = null
                if (tab == Tab.LOCATIONS) airCode = null
            },
            // `doTabForecast`: with no enabled place a weather or Air tab asks how to start instead.
            onTabTap = { tab ->
                val none = tab != Tab.LOCATIONS && PlaceIndex.enabledCount(state.places.map { it.disable }) == 0
                if (none) session.openStartPopup()
                none || (forecastRead && tabContentVisible && tab != navigation.selected &&
                    (navigation.selected == Tab.HOURLY || navigation.selected == Tab.DAILY) &&
                    (tab == Tab.HOURLY || tab == Tab.DAILY) &&
                    navigation.deferForecast(tab, onRepeatVisit))
            },
            overlay = {
                pages.lastOrNull()?.let { route ->
                    if (AlarmRoutes.known(route)) {
                        AlarmsScreen(route, returns, theme, alarms!!, onBack = ::back, openAppSettings = openAppSettings)
                    } else if (NationRoutes.known(route)) {
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
                if (intro && alertIntro != null) {
                    // `showAlertInfoEvent`: Close keeps the migrated alerts off, OK turns them on; back answers nothing (A22).
                    fun answer(enable: Boolean?) {
                        intro = false
                        if (enable != null) alertIntro.answer(enable)
                    }
                    IonicPopup(stringResource(R.string.LOC_WEATHER_ALERT), stringResource(R.string.LOC_ADDED_BAD_WEATHER_ALERT_FUNCTION).split('\n', limit = 2),
                        listOf(PopupButton(stringResource(R.string.LOC_CLOSE)) { answer(false) }, PopupButton(stringResource(R.string.LOC_OK), dark = true) { answer(true) }),
                        onBack = { answer(null) })
                }
                foregroundMessages.firstOrNull()?.let { message ->
                    // `notificationEvent`: the title and body as HTML, a break between them; OK closes it.
                    val lines = ForegroundMessage.template(message.title, message.body).split("<br>")
                        .map { AnnotatedString.fromHtml(it).text }
                    IonicPopup(stringResource(R.string.LOC_WEATHER), lines, listOf(PopupButton(stringResource(R.string.LOC_OK), dark = true) {
                        foregroundMessages.removeAt(0)
                    }), onBack = { foregroundMessages.removeAt(0) })
                }
                if (savingWithdrawal) {
                    AnalyticsWithdrawalProgress()
                } else if (analyticsPopup) {
                    // `chooseAnalytics`: back closes it without a choice.
                    fun choose(value: Boolean) {
                        analyticsPopup = false
                        privacy?.setAnalytics?.invoke(value)
                    }
                    AnalyticsPopup(privacy?.optIn ?: true, ::choose, onBack = { analyticsPopup = false })
                }
                activeSaveFailure?.let { failure ->
                    IonicAlert("TodayWeather", listOf(stringResource(failure.messageRes)), stringResource(R.string.LOC_OK),
                        onClose = { privacy?.consumeFailure?.invoke(failure.requestId) })
                }
                privacyAlert?.let { message -> IonicAlert("TodayWeather", listOf(stringResource(message)), stringResource(R.string.LOC_OK), onClose = { privacyAlert = null }) }
                if (startPopup) {
                    StartChoicePopup(autoSearch, onChoose = session::chooseAutoSearch, onOk = { started(session.startChoice(ok = true)) },
                        onBack = { started(session.startChoice(ok = false)) })
                }
                placesPage?.let { page ->
                    val loadingPlaces by page.loading.collectAsState()
                    val placesPopup by page.popup.collectAsState()
                    if (loadingPlaces) IonicLoading()
                    when (val shown = placesPopup) {
                        is StartFlow.Outcome.Alert -> IonicAlert(stringResource(R.string.LOC_ERROR), listOf(locationText(shown.message)),
                            stringResource(R.string.LOC_OK), onClose = page::closePopup)
                        is StartFlow.Outcome.Confirm -> LocationRetryPopup(shown.confirm, onBack = page::closePopup) { button ->
                            page.retryButton(button, openAppSettings, openLocationSettings)
                        }
                        else -> {}
                    }
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
                if (retry) RetryDialog(onClose = session::closeRetry, onRetry = session::confirmRetry)
            },
        ) { tab ->
            when (tab) {
                Tab.HOURLY, Tab.DAILY -> rememberWeatherTab(tab, state, entries, loading, theme, bellHost, forecastCharts, forecastImages, onAirInfo = { code ->
                    // `goAirInfoPage(code)`: /tab/air?code=.
                    airCode = code
                    navigation.selected = Tab.AIR
                }, onUnits = openUnits, applies = applies, locating = locating, onNoPlace = session::openStartPopup, nativeAd = visibleAd,
                    onForecastRead = { if (it == selected) forecastRead = true })
                Tab.AIR -> key(airLinks) {
                    rememberAirTab(state, entries, loading, theme, bellHost, airCode, applies, onWeather = { navigation.selected = Tab.HOURLY },
                        onUnits = openUnits, locating = locating, nativeAd = visibleAd, onShown = { airShown = it })
                }
                else -> placesPage?.let { page ->
                    // A new visit gets a new tab: its state and its opening run again.
                    key(page) {
                        // S02 lists the saved places: the unsaved place is not among them.
                        val savedOnly = if (preview) state.copy(places = state.places.dropLast(1)) else state
                        rememberPlacesTab(savedOnly, entries, theme, page, places!!, onSelect = ::openFromPlaces, onOpened = { openFromPlaces(null) },
                            onAlarm = { i -> if (alarms != null) open(AlarmRoutes.of(i)) }, nativeAd = visibleAd,
                            fromHeader = searchFrom != null, onBack = ::closeSearch, menuOpen = navigation.menuOpen)
                    }
                } ?: TabContent()
            }
        }
    }
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

    /**
     * A place a `link.todayweather.ai` link shows without saving it (#3096): the weather pages read and change the saved
     * state through it. Push, widgets and S02 keep the saved state.
     */
    val preview = LinkPreview(twApp.appState)

    /**
     * Refresh alarms and publish the newly cached weather to home-screen widgets after a place update; a linked place
     * not saved has neither.
     */
    private val cityUpdated: (Int) -> Unit = { index ->
        if (index < (twApp.appState.current()?.places?.size ?: 0)) {
            twApp.appScope.launch(Dispatchers.IO) { twApp.push.updateCity(index) }
            twApp.appScope.launch { WidgetRefresh.refresh(twApp, displayOnly = true) }
        }
    }

    val session = WeatherSession(twApp.weather, viewModelScope, preview, ::languages, { twApp.photos.photos }, ::loadPhotos,
        telemetry = telemetry, location = twApp.location, cityUpdated = cityUpdated)

    /** `link.todayweather.ai` links of this app open, applied in order (specs/deeplink.md §6.2). */
    val links = LinkOpener(twApp.appState.state, preview, openPlace = { session.openPlace(it.toDouble()) },
        reload = { session.reload(WeatherSession.Sender.DEEPLINK) },
        unblock = { session.closeRetry(); session.closePositionRetry() })

    /**
     * The star of a place shown without being saved: it is saved and selected (on S01, as its first place). True when
     * a place was saved.
     */
    fun addPreview(): Boolean {
        val index = preview.add() ?: return false
        telemetry.track("favorite_change", mapOf("action" to "add"))
        cityUpdated(index)
        return true
    }

    /**
     * S02's search and its visits (#2890); a deleted place's alarms go in the app's scope. S02 changes the saved places
     * through the preview's saved view, which keeps the place to return to while an unsaved place is selected.
     */
    val places = PlacesHost(twApp.places, { twApp.towns.await() }) { scope ->
        PlacesPage(preview.savedAccess, twApp.weather, session,
            StartFlow(preview.savedAccess, twApp.weather, twApp.geocode, twApp.location, ::languages, telemetry, cityUpdated), twApp.location, scope,
            removeAlarms = { index -> twApp.appScope.launch(Dispatchers.IO) { twApp.push.removeCity(index) } }, cityUpdated = cityUpdated, telemetry = telemetry,
            openPlace = { place -> links.show(place) })
    }

    /** S09's visits (#2893); a save changes the state at once and posts in the app's scope (`_postPushList` was not awaited). */
    val alarms = AlarmsHost { scope, openSettings ->
        // S09 opened for a saved place selects it, the user's choice: an unsaved place gives way (CODEX-3190-15).
        AlarmPage(twApp.appState, twApp.notifications, post = { index -> twApp.appScope.launch(Dispatchers.IO) { twApp.push.postPlace(index) } },
            openSettings = openSettings, scope = scope, chosen = preview::savedChosen)
    }

    /** O06 of this app open: shown once (`showAlertInfoEvent` after the start); OK's post goes in the app's scope. */
    val alertIntro = object : AlertIntro {
        private var shown = false
        override fun due(): Boolean = !shown.also { shown = true }
        override fun answer(enable: Boolean) {
            answerAlertIntro(twApp.appState, enable) { twApp.appScope.launch(Dispatchers.IO) { twApp.push.postList() } }
        }
    }

    /** The start page's visit of this app open (S01, #2889). */
    val start: StartPage by lazy {
        // S01's add selects the place it saves, the user's choice: an unsaved place shown over S01 by a link gives way
        // (CODEX-3190-19).
        StartPage(StartFlow(twApp.appState, twApp.weather, twApp.geocode, twApp.location, ::languages, telemetry, cityUpdated,
            chosen = preview::savedChosen), viewModelScope)
    }

    /** `locationOn`: location services turned on while the app is open reload a selected current position. */
    private val locationSwitch = LocationSwitch(app) { session.reload(WeatherSession.Sender.LOCATION_ON) }

    val adStart = SystemClock.elapsedRealtime()
    val adConfig = RemoteBannerConfig(twApp.remoteConfigSource(), viewModelScope).apply { load() }

    /** The anchored banner of this app open (#3211): `tw_app_banner_enabled`, under the all-ads policy and its delay. */
    val ads = TwAds(viewModelScope, adConfig, twApp.analytics::track, SystemClock::elapsedRealtime)
    val consent = AdsConsent(twApp.adsPlatform(), BuildConfig.RELEASE_ADS, twApp.analytics::track)

    /** The settings pages' changes; a unit change posts the push list again in the app's scope (`Push.updateUnits`). */
    val settings = SettingsActions(twApp.appState, session) { twApp.appScope.launch(Dispatchers.IO) { twApp.push.updateUnits() } }

    /** The open nationwide and warning pages' requests, kept across configuration changes while a page is open. */
    val nation = NationLoads(twApp.nation, viewModelScope, { twApp.appState.current()?.units }, ::languages)

    init {
        twApp.onOpened()
        twApp.analytics.onOpened()
        // `todayweather://N`: the place is selected and loads (`branchInit`, `reloadEvent 'deeplink'`), once the start page has closed.
        // An index from outside names saved places only: one past them is no place, never the unsaved one (CODEX-3190-3).
        viewModelScope.launch { twApp.entryLinks.deliver(twApp.appState.state, ready = { !it.startShows }) { session.openPlace(savedOnly(it)) } }
        // `link.todayweather.ai`: a place opens at once, also over S01; a page waits for S01 to close (LinkOpener).
        viewModelScope.launch { twApp.entryLinks.deliverTargets(twApp.appState.state, links::open) }
        // A notification tap: the place is selected and loads (`reloadEvent 'push'`), once the start page has closed.
        viewModelScope.launch {
            twApp.notificationTaps.deliver(twApp.appState.state, ready = { !it.startShows }) { session.openPlace(savedOnly(it), WeatherSession.Sender.PUSH) }
        }
        loadPhotos()
        connectivity.registerDefaultNetworkCallback(online)
        locationSwitch.register()
        viewModelScope.launch {
            twApp.migration.await()
            val state = twApp.appState.state.first { it != null && !it.startShows }!!
            // The cached weather first, as Cordova showed the saved cities while it loaded.
            state.places.getOrNull(state.placeIndex)?.let { twApp.weather.cached(it) }
            session.reload(WeatherSession.Sender.INIT)
        }
    }

    /** [index] when it names a saved place, else -1, which selects nothing and only loads (as an index past the list did). */
    private fun savedOnly(index: Double): Double = if (preview.isSaved(index)) index else -1.0

    private fun loadPhotos() {
        // The feed loads off the main thread; the places take their photos on it, where every other change of the
        // screens' state happens (CODEX-3190-1, -9).
        twApp.appScope.launch { if (twApp.photos.load() != null) withContext(Dispatchers.Main) { session.photosLoaded() } }
    }

    override fun onCleared() {
        connectivity.unregisterNetworkCallback(online)
        locationSwitch.unregister()
    }
}

/** The Cordova state name of a page over the tabs (`screen_view`). */
private fun screenName(route: String): String = when {
    AlarmRoutes.known(route) -> AlarmRoutes.SCREEN
    route == SettingsRoutes.UNITS -> "units"
    SettingsRoutes.known(route) -> "setting-radio"
    else -> route // the nationwide and warning pages are named as their states
}

/** The device's languages for `Accept-Language`, as the WebView sent them. */
internal fun languages(): List<String> = LocaleListCompat.getAdjustedDefault().toLanguageTags().split(",").filter { it.isNotEmpty() }

/** O06 of an app open: [due] once, then its answer (OK enables the migrated alerts). */
interface AlertIntro {
    fun due(): Boolean
    fun answer(enable: Boolean)
}
