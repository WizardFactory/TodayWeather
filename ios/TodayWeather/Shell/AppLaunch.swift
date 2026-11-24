import Foundation
import Network
import os
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit

/// An event that opens the app or brings it forward (IN-07, #2956). Each waits in `AppLaunch.entries` until the
/// Cordova migration has finished, then is handled in arrival order.
enum EntryEvent: Equatable, Sendable {
    /// The process started (a cold start).
    case launch
    /// The app came back to the foreground (a warm start, Cordova's `resume`).
    case resume
    /// A tap on a delivered notification; `cityIndex` as its payload carries it (a string). IN-04 and IN-14 submit it.
    case notification(cityIndex: String?)
    /// A URL that opened the app, including the configured weather widget's saved place.
    case link(URL)
}

/// The app's state and launch for the UI (IN-07): the single `AppStateHolder` (from the end of the migration on), the
/// queue of entry events, the shell's language and region, and the weather photo feed. `AppStartup` (IN-03) runs the
/// migration and calls `migrationFinished`; until then the launch screen stays and every entry event waits.
@MainActor
@Observable
final class AppLaunch {
    static let shared = AppLaunch(store: AppLaunch.standardStore(), environment: .system, handBack: AppHandBack.writer, sharesWidgets: true)

    /// The single owner of the app state for the UI; its `state` is nil until the migration has finished.
    let holder: AppStateHolder
    @ObservationIgnored let entries = EntryQueue<EntryEvent>()
    /// The language and region of the shell, from the system languages as the Cordova app chose them.
    let locale: ShellLocale
    /// The photo theme's feed (IN-08 shows the photos).
    @ObservationIgnored let photos: WeatherPhotoFeed
    /// The feed once loaded, for the weather pages (`window.weatherPhotos`).
    @ObservationIgnored private(set) var loadedPhotos: WeatherPhotos?
    /// The weather of the places (IN-08): requests to the legacy server (Info.plist `TWServerURL`, the private build
    /// input `TW_SERVER_URL`; without it nothing is requested), cached in `Library/Caches/weather`.
    @ObservationIgnored let repository: WeatherRepository
    /// The weather pages S03 and S04 (IN-08), created with the shell.
    private(set) var weather: WeatherScreens?
    /// The settings pages S07 and S08 and the menu's hand-offs (IN-12), created with the shell.
    private(set) var settings: SettingsScreens?
    /// The saved places S02 (IN-11), created with the shell.
    private(set) var places: PlacesScreens?
    /// The nationwide pages S10 and S11 and the warnings S12 (IN-13), created with the shell.
    private(set) var nation: NationScreens?
    /// S09, O06, O07 and the notification taps (IN-14), created with the shell.
    private(set) var alarms: AlarmsScreens?
    /// S01 while the start gate holds (IN-10), created with the shell; nil once it closed.
    private(set) var startPage: StartPage?
    @ObservationIgnored private let towns = BundledTownLoader()
    /// The device's location (IN-10), created with the shell.
    @ObservationIgnored private(set) var location: (any AppLocation)?
    /// O02 and O03's position variants over the weather pages (IN-10).
    @ObservationIgnored private var positionPopups: CurrentPositionPopups?
    /// Creates the device's location: CoreLocation in the app, a double in tests.
    @ObservationIgnored private let makeLocation: @MainActor () -> any AppLocation
    /// Google's place predictions for S01 (the private `TW_PLACES_API_KEY_IOS`); nil without the key.
    @ObservationIgnored private let makePlaceSearch: @MainActor () -> (any PlaceSearch)?
    /// The shell, created with the state; nil until the migration has finished.
    private(set) var shell: ShellModel?
    /// The place shown without being saved (#3180, #3097): the weather pages read the state through it; S02, push, the
    /// widgets and the store read the holder. Created with the shell.
    private(set) var unsaved: UnsavedPlaces?
    /// `link.todayweather.ai` links and S02's chosen results over `unsaved` (#3097), created with the shell.
    @ObservationIgnored private(set) var linkOpener: LinkOpener?
    /// A place link showed the tabs over S01 without closing it; the star closes it (specs/deeplink.md §6.2.3).
    @ObservationIgnored private var startBypassed = false
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "launch")
    @ObservationIgnored private var network: NWPathMonitor?
    @ObservationIgnored private var online = true
    /// Connects the screens to a new shell (its hooks: refresh, menu rows, entry events) before the held entry events
    /// are handled. IN-08 and later set it.
    @ObservationIgnored var onShell: (ShellModel) -> Void = { _ in }
    /// At cold start the queued widget or notification can replace the configured default before a tab is visible.
    @ObservationIgnored var onInitialScreen: (ShellModel) -> Void = { _ in }

    /// What the process reads from the system: the preferred languages and the photo feed's URL (Info.plist
    /// `TWWeatherPhotosURL`, the private build input `TW_WEATHER_PHOTOS_URL`).
    struct Environment {
        var preferredLanguages: [String]
        var photosURL: URL?
        var version: String
        /// The legacy server (Cordova `clientConfig.serverUrl`); nil without the private input.
        var serverURL: String? = nil
        /// The feedback address (Cordova `clientConfig.mailTo`, Info.plist `TWMailTo`); empty without the private input.
        var mailTo: String = ""

        static var system: Environment {
            let info = Bundle.main.infoDictionary ?? [:]
            let photos = (info["TWWeatherPhotosURL"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
            let server = (info["TWServerURL"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return Environment(preferredLanguages: Locale.preferredLanguages, photosURL: photos,
                               version: info["CFBundleShortVersionString"] as? String ?? "", serverURL: server,
                               mailTo: info["TWMailTo"] as? String ?? "")
        }
    }

    @ObservationIgnored let environment: Environment
    @ObservationIgnored private let weatherHTTP: any WeatherHTTP

    /// The page over the tabs in the shell's page slot: S09 (IN-14), a nationwide page (IN-13) or a settings page (IN-12);
    /// nil while none shows. The nationwide and settings pages open from the menu, which the page then covers, and S09
    /// from the tabs' bells, so one shows at a time.
    var pageView: ((ShellInsets) -> AnyView?)? {
        guard alarms != nil || nation != nil || settings != nil else { return nil }
        return { [weak self] insets in
            guard let self else { return nil }
            return alarms?.pageView(insets) ?? nation?.pageView(insets) ?? settings?.pageView(insets)
        }
    }

    /// The Cordova state of the page over the tabs (`screen_view`): `setting-push`, `nation`, `nation-air`, `kma-special`,
    /// `units` or `setting-radio`; nil while the tabs show.
    var pageScreen: String? {
        // S09 (IN-14) is the Cordova state `setting-push`.
        if alarms?.page != nil { return "setting-push" }
        return nation?.screenName ?? settings?.top.map(SettingsScreens.screenName)
    }

    /// `handBack` (IN-17) gets the state the migration produced and every state saved after it; nil writes no hand-back.
    init(store: any AppStateSaving, environment: Environment, handBack: HandBackWriter? = nil, sharesWidgets: Bool = false, http: any HTTPGetting = URLSessionGet(),
         weatherHTTP: any WeatherHTTP = URLSessionGet(), weatherCache: URL? = AppLaunch.weatherCache(),
         location: @escaping @MainActor () -> any AppLocation = { CoreLocationAccess() },
         placeSearch: @escaping @MainActor () -> (any PlaceSearch)? = { GooglePlaceSearch(key: GooglePlaceSearch.bundleKey) }) {
        let base = environment.serverURL
        var onSaved: (@Sendable (AppState) -> Void)?
        if handBack != nil || sharesWidgets {
            onSaved = { state in
                handBack?.write(state)
                if sharesWidgets { WidgetSharing.publish(state, base: base) }
            }
        }
        holder = AppStateHolder(store: store, onSaved: onSaved)
        self.environment = environment
        self.weatherHTTP = weatherHTTP
        makeLocation = location
        makePlaceSearch = placeSearch
        locale = ShellLocale(preferredLanguages: environment.preferredLanguages)
        photos = WeatherPhotoFeed(url: environment.photosURL, http: http)
        // `weather_fetch` and `weather_load` go to the usage analytics (IN-15; sent only while the user opted in).
        repository = WeatherRepository(baseURL: environment.serverURL, cacheDirectory: weatherCache, http: weatherHTTP,
                                       telemetry: AppLaunch.weatherTelemetry)
        if sharesWidgets { repository.onLoaded = WidgetSharing.received }
        // The process started: the first entry event, before any notification tap or link of this launch.
        entries.submit(.launch)
    }

    /// The weather path's analytics events, through `Monetization.track` (its schema and the opt-in decide what is sent).
    static let weatherTelemetry: WeatherTelemetry = { name, params in Monetization.shared.track(name, params) }

    /// The state file of the app (`AppStateStore.standard()`, the file the migration wrote).
    private static func standardStore() -> AppStateStore {
        if let store = try? AppStateStore.standard() { return store }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return AppStateStore(url: support.appendingPathComponent("TodayWeather/app_state.json"))
    }

    /// The migration has finished with `state`: the holder takes it over, the shell opens (S01 or the startup page's
    /// tab) and the entry events held so far are handled in order. Later calls change nothing.
    func migrationFinished(_ state: AppState) {
        guard shell == nil else { return }
        holder.load(state)
        let shell = ShellModel(holder: holder, locale: locale, version: environment.version)
        self.shell = shell
        let locale = self.locale
        // IN-10: the current position's lookup on the weather pages, `locationOn` reloading it.
        let location = makeLocation()
        self.location = location
        let unsaved = UnsavedPlaces(holder: holder)
        self.unsaved = unsaved
        shell.shownState = { [weak unsaved] in unsaved?.state }
        let session = WeatherSession(repository: repository, holder: unsaved, acceptLanguage: { locale.acceptLanguage },
                                     photos: { [weak self] in self?.loadedPhotos }, loadPhotos: { [weak self] in self?.loadPhotos() },
                                     telemetry: AppLaunch.weatherTelemetry, location: location)
        location.onLocationOn = { [weak session] in session?.reload(.locationOn) }
        let weather = WeatherScreens(session: session, shell: shell, screenSize: Self.screenSize())
        self.weather = weather
        let opener = LinkOpener(unsaved: unsaved, openPlace: { [weak session] in session?.openPlace($0, sender: .deeplink) },
                                reload: { [weak session] in session?.reload(.deeplink) })
        linkOpener = opener
        weather.isUnsaved = { [weak unsaved] in unsaved?.isSelected($0) ?? false }
        weather.onStar = { [weak self] in self?.star() }
        weather.onSearch = { [weak self] tab in self?.places?.openSearch(from: tab) }
        positionPopups = CurrentPositionPopups(session: session, shell: shell)
        places = makePlaces(shell, session: session, location: location, unsaved: unsaved)
        places?.onOpenPlace = { [weak opener] in opener?.show($0) }
        if case .start = shell.screen { startPage = makeStartPage(shell, location: location) }
        // A unit change posts the push list again through IN-04's registration (`AppPushUnits`).
        let mail = FeedbackMail(to: environment.mailTo, version: environment.version,
                                deviceId: { ((try? DeviceIdentity.deviceId()) ?? nil) ?? "undefined" }, userAgent: WebViewUserAgent())
        settings = SettingsScreens(shell: shell, actions: SettingsActions(holder: holder, session: session, push: AppPushUnits()),
                                   opener: SystemURLOpener(), mail: mail)
        // IN-13: the nationwide pages' rows; the rows it does not handle go on to the settings' hook.
        nation = NationScreens(shell: shell, source: NationSource(baseURL: environment.serverURL, http: weatherHTTP))
        let alarms = makeAlarms(shell, weather: weather)
        self.alarms = alarms
        // A notification's tap selects its place and reloads (IN-14); the weather pages handle the others.
        shell.onEntry = { [weak weather, weak alarms] event in
            if case .notification(let cityIndex) = event {
                if let weather { alarms?.notificationTapped(cityIndex, session: weather.session) }
            } else {
                weather?.handle(event)
            }
        }
        onShell(shell)
        entries.open { [weak self] event in self?.handle(event) }
        onInitialScreen(shell)
        // O06, 500 ms after the app opened over the tabs (`showAlertInfoEvent`); after S01 when it opened there.
        alarms.scheduleIntro()
    }

    /// S09 for a new shell (IN-14): the bells of the weather pages (the selected place) and of S02 (the row's place) open a
    /// visit; a save posts through IN-04's push service; the return starts the tabs' pages anew (`cache: false`).
    private func makeAlarms(_ shell: ShellModel, weather: WeatherScreens) -> AlarmsScreens {
        let holder = self.holder
        // S09 opened for a saved place selects it, the user's choice: an unsaved place gives way (CODEX-3190-15).
        let unsaved = self.unsaved
        let alarms = AlarmsScreens(shell: shell, makePage: {
            AlarmPage(holder: holder, notifications: UserNotificationAccess(available: FirebasePush.configured),
                      post: { index in AppStartup.shared.push?.postPlace(index) },
                      openSettings: { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } },
                      chosen: { [weak unsaved] in unsaved?.savedChosen() })
        }, postList: { AppStartup.shared.push?.postList() })
        weather.onBell = { [weak alarms, weak holder] in alarms?.open(fav: holder?.state?.placeIndex) }
        places?.onBell = { [weak alarms] index in alarms?.open(fav: index) }
        alarms.onClosed = { [weak self] in
            self?.places?.reopen()
            self?.weather?.reopen()
        }
        return alarms
    }

    /// A message that arrived while the app shows (O07, IN-14); nothing before the shell exists.
    func message(_ payload: JSONObject) {
        alarms?.showMessage(payload)
    }

    /// The process's UI started: the photo feed loads when the app opens and when a network comes back
    /// (`loadCities` and the `online` listener of app.js). A second call does nothing.
    func start() {
        guard network == nil else { return }
        loadPhotos()
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { path in
            let satisfied = path.status == .satisfied
            Task { @MainActor [weak self] in self?.networkChanged(satisfied: satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "net.wizardfactory.todayweather.network"))
        network = monitor
    }

    private func networkChanged(satisfied: Bool) {
        if satisfied && !online { loadPhotos() }
        online = satisfied
    }

    func loadPhotos() {
        let feed = photos
        Task { [weak self] in
            guard let loaded = await feed.load(), let self, loadedPhotos == nil else { return }
            loadedPhotos = loaded
            // `loadWeatherPhotos`: places without a photo get one; the photo theme's page takes the selected one's.
            weather?.session.photosLoaded()
        }
    }

    /// The weather cache, `Library/Caches/weather` (the Cordova app kept the weather with the city).
    nonisolated static func weatherCache() -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("weather")
    }

    /// `screen.width` and `screen.height` of the WebView: the screen in points, portrait.
    static func screenSize() -> CGSize {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let size = scene?.screen.bounds.size ?? CGSize(width: 393, height: 852)
        return CGSize(width: min(size.width, size.height), height: max(size.width, size.height))
    }

    private func handle(_ event: EntryEvent) {
        log.info("entry event \(String(describing: event), privacy: .private)")
        if case .link(let url) = event, let link = WidgetSharing.Link(url),
           let shell, case .tab = shell.screen, let state = holder.state {
            closeForLink()
            shell.select(.forecast)
            if let id = link.placeID, let index = state.places.firstIndex(where: { !$0.disable && WidgetSharing.id($0) == id }) {
                weather?.session.openPlace(index)
            } else {
                weather?.session.reload(.deeplink)
            }
            return
        }
        // `link.todayweather.ai` (#3097): Universal Links that the scene accepted (web browsing activities only).
        if case .link(let url) = event, url.scheme?.lowercased() == "https", let target = DeepLink.parse(url.absoluteString) {
            openLink(target)
            return
        }
        // `checkLocationMode` on each return to the foreground (app.js `resume`), IN-10.
        if event == .resume { location?.check() }
        shell?.handle(event)
    }

    /// A link closes the menu, the settings stack, a nationwide or warning page and the alarm page (an edited alarm keeps
    /// its normal save/discard confirmation), as the widget link does (specs/deeplink.md §6.2.1).
    private func closeForLink() {
        shell?.closeMenu()
        while settings?.top != nil { settings?.back() }
        if nation?.page != nil { nation?.closePage() }
        alarms?.page?.cancel()
    }

    /// A `link.todayweather.ai` link (specs/deeplink.md §6.2): `LinkOpener` selects the saved place or shows the place
    /// unsaved and loads it; then what covers the tabs closes and the route's tab (Air with its pollutant) or page opens.
    /// A place link over S01 shows the tabs without closing S01 (no `startVersion`); the star closes it. Links that change
    /// nothing (an unknown city, a page or `/open` over S01) leave the screens as they are.
    private func openLink(_ target: DeepLinkTarget) {
        guard let shell, let weather else { return }
        switch target {
        case .place, .coordinate:
            // An open retry confirmation (O03) stops every reload; the link's place loads instead (CODEX-3195-3).
            weather.session.closeRetry()
            weather.session.closePositionRetry()
        default:
            break
        }
        guard let route = linkOpener?.open(target) else { return }
        closeForLink()
        switch route {
        case .app:
            break
        case .page(let page):
            nation?.open(page == .nationWeather ? .nation : page == .nationAir ? .nationAir : .warnings)
        case .weather(let view, let pollutant, _, _):
            let tab: ShellTab = view == .daily ? .dailyforecast : view == .air ? .air : .forecast
            weather.openLinkTab(tab, pollutant: pollutant)
            if case .start = shell.screen {
                // S01 stays alive behind the tabs: an add it started still finishes and closes it (CODEX-3195-5).
                startBypassed = true
                shell.closeStart()
            }
        }
    }

    /// The star of the unsaved place (#3180): saved at once where it stands, with a short notice; over a bypassed S01 the
    /// add closes it as a first place does (O06 and held taps follow, as after S01).
    private func star() {
        guard let shell, unsaved?.add() != nil else { return }
        AppLaunch.weatherTelemetry("favorite_change", ["action": .text("add")])
        shell.showNotice(LinkTexts.of(locale.catalog).addedFavorite)
        if startBypassed {
            startBypassed = false
            if let weather { alarms?.startClosed(session: weather.session) }
        }
    }

    /// S01 for a new shell (IN-10): its adds through `StartFlow`, the Places search with the private key (else the
    /// bundled towns), and its close.
    private func makeStartPage(_ shell: ShellModel, location: any AppLocation) -> StartPage {
        let locale = self.locale
        let flow = StartFlow(holder: holder, repository: repository,
                             geocode: GeocodeClient(baseURL: environment.serverURL, http: weatherHTTP),
                             location: location, acceptLanguage: { locale.acceptLanguage }, telemetry: AppLaunch.weatherTelemetry)
        return StartPage(shell: shell, flow: flow, search: makePlaceSearch(), towns: towns, closed: { [weak self] in self?.startClosed() })
    }

    /// The Locations tab S02 (IN-11): a visit's page over the session, with bundled towns, optional Places predictions
    /// and the alarms' removal through IN-04's push service.
    private func makePlaces(_ shell: ShellModel, session: WeatherSession, location: any AppLocation,
                            unsaved: UnsavedPlaces) -> PlacesScreens {
        let locale = self.locale, repository = self.repository
        let geocode = GeocodeClient(baseURL: environment.serverURL, http: weatherHTTP)
        // S02 changes the saved places through the saved view, which keeps the place to return to while an unsaved place
        // is selected (CODEX-3190-2).
        let saved = unsaved.savedAccess
        return PlacesScreens(shell: shell, session: session, makePage: {
            PlacesPage(holder: saved, repository: repository, session: session, geocode: geocode, location: location,
                       acceptLanguage: { locale.acceptLanguage }, telemetry: AppLaunch.weatherTelemetry,
                       removeAlarms: { AppPushRemoval().removeCity($0) })
        }, search: makePlaceSearch(), towns: towns)
    }

    /// What the shell shows on a tab: S02 on the Locations tab (IN-11), the weather and air pages on the others.
    func tabContent(_ tab: ShellTab) -> TabContent? {
        tab == .search ? places?.content(tab) : weather?.content(tab)
    }

    /// StartCtrl's `close()` after an add (the flow stored `startVersion` and selected the new place): the shell opens Hourly whatever the startup page, and TabCtrl's `init` loads it (`reloadEvent
    /// 'init'`).
    private func startClosed() {
        guard let shell else { return }
        // S01 saved a place, the user's choice: an unsaved place a link showed over S01 gives way (CODEX-3190-19).
        unsaved?.savedChosen()
        shell.select(.forecast)
        shell.closeStart()
        startPage = nil
        weather?.session.reload(.initial)
        // A notification tap held while S01 showed, then O06's 500 ms (IN-14).
        if let weather { alarms?.startClosed(session: weather.session) }
    }
}

/// The shell's language as the Cordova app chooses it (V24): `navigator.language` of the WKWebView for the system's
/// preferred languages picks one of the six catalogs, `navigator.languages` gives the region (the Korea-only menu
/// rows), and the WebView's `Accept-Language` goes with the server requests (IN-08).
struct ShellLocale: Equatable {
    let preferredLanguages: [String]
    /// `navigator.language`.
    let webLanguage: String
    /// The catalog code (`en`, `ko`, …, `zh-TW`).
    let catalog: String
    /// `Util.region`.
    let region: String
    /// The `Accept-Language` header of the WKWebView's requests.
    let acceptLanguage: String

    init(preferredLanguages: [String]) {
        self.preferredLanguages = preferredLanguages
        webLanguage = AppLanguage.webLanguage(preferredLanguages)
        catalog = AppLanguage.catalog(webLanguage)
        region = AppLanguage.region(AppLanguage.webLanguages(preferredLanguages))
        acceptLanguage = AppLanguage.acceptLanguage(preferredLanguages)
    }
}

/// The push re-post of a unit change (IN-12) for the app's push service (IN-04), which `AppStartup` creates after the
/// shell; nothing is sent while it does not exist (no server URL, or the `Device-Id` not read yet).
struct AppPushUnits: PushUnitsUpdating {
    func updateUnits(_ state: AppState) {
        MainActor.assumeIsolated { AppStartup.shared.push }?.updateUnits(state)
    }
}
