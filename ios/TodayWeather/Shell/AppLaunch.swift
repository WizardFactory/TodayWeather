import Foundation
import Network
import os
import TWData
import TWDomain
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
    /// A link that opened the app (`onOpenURL`). The app registers no URL scheme yet: IN-16 decides whether the shipped
    /// 1.1.x app registered `todayweather://`.
    case link(URL)
}

/// The app's state and launch for the UI (IN-07): the single `AppStateHolder` (from the end of the migration on), the
/// queue of entry events, the shell's language and region, and the weather photo feed. `AppStartup` (IN-03) runs the
/// migration and calls `migrationFinished`; until then the launch screen stays and every entry event waits.
@MainActor
@Observable
final class AppLaunch {
    static let shared = AppLaunch(store: AppLaunch.standardStore(), environment: .system)

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
    /// The shell, created with the state; nil until the migration has finished.
    private(set) var shell: ShellModel?
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "launch")
    @ObservationIgnored private var network: NWPathMonitor?
    @ObservationIgnored private var online = true
    /// Connects the screens to a new shell (its hooks: refresh, menu rows, entry events) before the held entry events
    /// are handled. IN-08 and later set it.
    @ObservationIgnored var onShell: (ShellModel) -> Void = { _ in }

    /// What the process reads from the system: the preferred languages and the photo feed's URL (Info.plist
    /// `TWWeatherPhotosURL`, the private build input `TW_WEATHER_PHOTOS_URL`).
    struct Environment {
        var preferredLanguages: [String]
        var photosURL: URL?
        var version: String
        /// The legacy server (Cordova `clientConfig.serverUrl`); nil without the private input.
        var serverURL: String? = nil

        static var system: Environment {
            let info = Bundle.main.infoDictionary ?? [:]
            let photos = (info["TWWeatherPhotosURL"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
            let server = (info["TWServerURL"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return Environment(preferredLanguages: Locale.preferredLanguages, photosURL: photos,
                               version: info["CFBundleShortVersionString"] as? String ?? "", serverURL: server)
        }
    }

    @ObservationIgnored let environment: Environment

    init(store: any AppStateSaving, environment: Environment, http: any HTTPGetting = URLSessionGet(),
         weatherHTTP: any WeatherHTTP = URLSessionGet(), weatherCache: URL? = AppLaunch.weatherCache()) {
        holder = AppStateHolder(store: store)
        self.environment = environment
        locale = ShellLocale(preferredLanguages: environment.preferredLanguages)
        photos = WeatherPhotoFeed(url: environment.photosURL, http: http)
        repository = WeatherRepository(baseURL: environment.serverURL, cacheDirectory: weatherCache, http: weatherHTTP)
        // The process started: the first entry event, before any notification tap or link of this launch.
        entries.submit(.launch)
    }

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
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { locale.acceptLanguage },
                                     photos: { [weak self] in self?.loadedPhotos }, loadPhotos: { [weak self] in self?.loadPhotos() })
        let weather = WeatherScreens(session: session, shell: shell, screenSize: Self.screenSize())
        self.weather = weather
        shell.onEntry = { [weak weather] event in weather?.handle(event) }
        onShell(shell)
        entries.open { [weak self] event in self?.handle(event) }
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
        log.info("entry event \(String(describing: event), privacy: .public)")
        shell?.handle(event)
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
