import FirebaseCrashlytics
import Foundation
import os
import SwiftUI
import TWDomain
import TWResources
import UIKit

/// Ads, usage analytics and crash reporting of the app (IN-15, #2964): the Cordova `Monetization`, `TwAds` and the
/// emi AdMob adapter, connected to the shell (IN-07).
///
/// - Usage analytics (`UsageAnalytics`) applies the stored choice when the shell is created (after the Cordova
///   migration, after `AnalyticsGuard` turned collection off); the menu's 선택적 이용 통계 row changes it.
/// - The ads start when the shell first shows a tab, as TabCtrl's `TwAds.init()` (S01 comes first, IN-10): Remote
///   Config and UMP gate native cards and forecast interstitials. A build without valid AdMob
///   identifiers (`AdsSettings`) requests no ads.
/// - Crashlytics collects crash reports with a configured Firebase app, independent of the analytics choice, as in
///   the Cordova build.
@MainActor
@Observable
final class Monetization {
    static let shared: Monetization = {
        let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "monetization")
        let settings = AdsSettings.current
        // The choice is handed back to a fallback Cordova build at every write (IN-17).
        return Monetization(analytics: UsageAnalytics(sdk: FirebaseAnalyticsSdk(), records: HandBackConsentRecords.app,
                                                      trafficType: AdsSettings.trafficType(settings),
                                                      log: { log.notice("\($0, privacy: .public)") }),
                            settings: settings)
    }()

    private(set) var nativeAds: ForecastNativeAds?
    @ObservationIgnored private var interstitial: ForecastInterstitial?
    @ObservationIgnored let analytics: UsageAnalytics
    @ObservationIgnored private let settings: AdsSettings?
    @ObservationIgnored private let openURL: @MainActor (URL) -> Void
    @ObservationIgnored private let clock = MainClock()
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "admob")
    @ObservationIgnored private var consent: AdsConsent?
    @ObservationIgnored private var config: RemoteBannerConfig?
    @ObservationIgnored private var platform: GoogleAdsPlatform?
    @ObservationIgnored private var windowStarted = false
    @ObservationIgnored private var privacyFormOpen = false
    @ObservationIgnored private var previousPersonalization: Bool?
    @ObservationIgnored private var readVisit: ShellModel.AdVisit?
    @ObservationIgnored private weak var shell: ShellModel?

    /// `settings` nil: no ads. `openURL` opens the policy pages (the system browser).
    init(analytics: UsageAnalytics, settings: AdsSettings?, interstitial: ForecastInterstitial? = nil,
         openURL: @escaping @MainActor (URL) -> Void = { UIApplication.shared.open($0) }) {
        self.analytics = analytics
        self.settings = settings
        self.interstitial = interstitial
        self.openURL = openURL
    }

    /// Connects to the app's launch: each new shell gets the analytics choice, the menu rows and the screens. The
    /// previous `onShell` hook keeps running first.
    func connect(_ launch: AppLaunch) {
        pageScreen = { [weak launch] in launch?.pageScreen }
        let previous = launch.onShell
        launch.onShell = { [weak self] shell in
            previous(shell)
            self?.attach(shell, observeInitialScreen: false)
        }
        let initial = launch.onInitialScreen
        launch.onInitialScreen = { [weak self] shell in
            initial(shell)
            self?.observeScreens(shell)
        }
    }

    func uiStarted() {
        windowStarted = true
        startAdsIfShown()
    }

    /// An analytics event of the schema (`Monetization.track`): the weather path's `weather_fetch` and `weather_load`
    /// (`AppLaunch.weatherTelemetry`); IN-10 and IN-11 add the place and location events.
    @discardableResult
    func track(_ name: String, _ params: [String: AnalyticsValue]) -> Bool {
        analytics.track(name, params)
    }

    func chartRead(_ tab: ShellTab) {
        guard let shell, shell.selected == tab, pageScreen() == nil else { return }
        readVisit = shell.adVisit
    }

    /// The Cordova state name of the page over the tabs (IN-12's settings pages, IN-13's nationwide pages), nil while
    /// the tabs show; `connect` reads it from the app's launch (`AppLaunch.pageScreen`).
    var pageScreen: @MainActor () -> String? = { nil }

    /// A new shell: the stored analytics choice applies, and the privacy rows and the screens connect.
    func attach(_ shell: ShellModel, observeInitialScreen: Bool = true) {
        self.shell = shell
        readVisit = nil
        shell.onForecastTap = { [weak self, weak shell] destination in
            guard let self, let shell, UIApplication.shared.applicationState == .active,
                  !shell.menuOpen, shell.popups.isEmpty, self.pageScreen() == nil else { return false }
            self.refreshEligibility()
            let visit = shell.adVisit
            return self.interstitial?.handleIntent(from: shell.selected, to: destination,
                                                   readPastChart: self.readVisit == visit) { [weak shell] in
                guard let shell, shell.adVisit == visit, self.pageScreen() == nil else { return }
                shell.select(destination)
            } ?? false
        }
        if AnalyticsGuard.firebaseConfigured {
            // Crash reports, as the Cordova build's Crashlytics plugin collected them (on by default, independent of
            // the analytics choice); Crashlytics itself starts with `FirebaseApp.configure()`.
            _ = Crashlytics.crashlytics()
        }
        analytics.start()
        shell.analyticsAllowed = analytics.choice
        analytics.onChoiceChange = { [weak shell] in shell?.analyticsAllowed = $0 }
        let previous = shell.onMenuRow
        shell.onMenuRow = { [weak self, weak shell] row in
            guard let self, let shell else { return previous(row) }
            switch row {
            case .analytics: chooseAnalytics(shell)
            case .adPrivacy: openAdPrivacy(shell)
            case .privacyPolicy: openPolicy("privacy", shell)
            case .terms: openPolicy("terms", shell)
            default: previous(row)
            }
        }
        if observeInitialScreen { observeScreens(shell) }
    }

    // MARK: Screens

    /// `$stateChangeSuccess` with the Cordova state names: S01 is `start`, the tabs `tab.<name>`, a settings page over
    /// the tabs `units` or `setting-radio` (IN-12; the Android `screenName`).
    private func observeScreens(_ shell: ShellModel) {
        let screen = withObservationTracking {
            (shell.screen, shell.selected, pageScreen())
        } onChange: { [weak self, weak shell] in
            Task { @MainActor in
                guard let self, let shell, self.shell === shell else { return }
                self.observeScreens(shell)
            }
        }
        switch screen.0 {
        case .start: analytics.screen("start")
        case .tab: analytics.screen(screen.2 ?? "tab.\(screen.1.rawValue)")
        }
        startAdsIfShown()
        if case .tab = screen.0, screen.2 == nil {
            interstitial?.markVisible(screen.1)
        } else {
            readVisit = nil
        }
    }

    // MARK: Ads

    private func startAdsIfShown() {
        guard consent == nil, windowStarted, let shell, case .tab = shell.screen, let settings else { return }
        let platform = GoogleAdsPlatform()
        let analytics = self.analytics
        let log = self.log
        let source: (any BannerConfigSource)? = AnalyticsGuard.firebaseConfigured ? FirebaseBannerConfigSource() : nil
        let config = RemoteBannerConfig(source: source, clock: clock, log: { log.notice("\($0, privacy: .public)") })
        self.platform = platform
        self.config = config
        let trackAd: (String, [String: AnalyticsValue]) -> Bool = { name, params in
            if name == "ad_lifecycle", case let .text(format) = params["ad_format"],
               case let .text(action) = params["action"] {
                log.notice("\(format, privacy: .public) \(action, privacy: .public)")
            }
            return analytics.track(name, params)
        }
        nativeAds = ForecastNativeAds(unitID: settings.nativeUnit, request: { platform.makeRequest() },
                                      track: trackAd)
        interstitial = ForecastInterstitial(unitID: settings.interstitialUnit, request: { platform.makeRequest() },
                                            track: { name, params in _ = trackAd(name, params) })
        if pageScreen() == nil { interstitial?.markVisible(shell.selected) }
        config.onChange = { [weak self] in self?.refreshEligibility() }
        let consent = AdsConsent(platform: platform, releaseAds: settings.releaseAds, clock: clock,
                                 track: { name, params in analytics.track(name, params) },
                                 log: { log.notice("\($0, privacy: .public)") },
                                 onReady: { [weak self] status in
                                     analytics.setAdTrackingStatus(status.name)
                                     self?.refreshEligibility()
                                 })
        self.consent = consent
        config.load()
        consent.start()
    }

    /// A changed ATT/TCF choice invalidates previously loaded creatives even when ads remain permitted.
    func refreshEligibility() {
        guard let platform, let config, let consent else { return }
        let (tracking, record) = platform.privacyState()
        let personalized = AdRequestRule.personalized(tracking, record)
        if previousPersonalization != personalized {
            nativeAds?.setEnabled(false)
            interstitial?.setEnabled(false)
            previousPersonalization = personalized
        }
        let allowed = consent.permitsRequests && config.ready && !privacyFormOpen
        nativeAds?.setEnabled(allowed && config.nativeEnabled)
        interstitial?.setEnabled(allowed && config.interstitialEnabled)
    }

    // MARK: Menu rows

    /// 선택적 이용 통계: the Ionic popup with 거부 / 철회 and 동의; a choice that could not be saved shows
    /// `LOC_PRIVACY_SAVE_FAILED`. The menu stays open.
    private func chooseAnalytics(_ shell: ShellModel) {
        let catalog = Catalog(code: shell.locale.catalog)
        let choose: (Bool) -> Void = { [weak self, weak shell] value in
            guard let self, let shell, !self.analytics.setCollectionEnabled(value) else { return }
            shell.show(Popup(title: "TodayWeather", lines: [catalog("LOC_PRIVACY_SAVE_FAILED")],
                             buttons: [.init(text: catalog("LOC_OK"), style: .positive)]))
        }
        shell.show(Popup(title: catalog("LOC_ANALYTICS_CHOICE"), lines: [catalog("LOC_ANALYTICS_DETAIL")],
                         buttons: [.init(text: catalog("LOC_ANALYTICS_DENY"), action: { choose(false) }),
                                   .init(text: catalog("LOC_ANALYTICS_ALLOW"), action: { choose(true) })]))
    }

    /// 광고 개인정보 선택: UMP's privacy options form, or `LOC_AD_PRIVACY_UNAVAILABLE`.
    private func openAdPrivacy(_ shell: ShellModel) {
        let unavailable: @MainActor () -> Void = { [weak shell] in
            guard let shell else { return }
            let catalog = Catalog(code: shell.locale.catalog)
            shell.show(Popup(title: "TodayWeather", lines: [catalog("LOC_AD_PRIVACY_UNAVAILABLE")],
                             buttons: [.init(text: catalog("LOC_OK"), style: .positive)]))
        }
        guard let consent else {
            log.notice("privacy ad_choices not_started form_unavailable")
            return unavailable()
        }
        privacyFormOpen = true
        refreshEligibility()
        consent.openPrivacyOptions(onDismiss: { [weak self] in
            self?.privacyFormOpen = false
            self?.refreshEligibility()
        }, onUnavailable: unavailable)
    }

    /// 개인정보처리방침 and 이용약관 in the browser, in the app's language (B13 of AN-15).
    private func openPolicy(_ kind: String, _ shell: ShellModel) {
        guard let url = Self.policyURL(kind, catalog: shell.locale.catalog) else { return }
        openURL(url)
    }

    /// `https://todayweather.ai/mobile/<kind>.html` for Korean, `.ja.html` for Japanese, `.en.html` otherwise.
    static func policyURL(_ kind: String, catalog: String) -> URL? {
        let suffix = switch catalog {
        case "ko": ""
        case "ja": ".ja"
        default: ".en"
        }
        return URL(string: "https://todayweather.ai/mobile/\(kind)\(suffix).html")
    }
}
