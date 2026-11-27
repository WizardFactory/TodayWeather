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
/// - Usage analytics (`UsageAnalytics`) applies the stored choice, else the default of the device region (on outside the
///   EEA, the United Kingdom and Switzerland, 2026-11-24), when the shell is created (after the Cordova migration, after
///   `AnalyticsGuard` turned collection off); the menu's 이용 통계 row changes it.
/// - The ads start when the shell first shows a tab, as TabCtrl's `TwAds.init()` (S01 comes first, IN-10): Remote
///   Config and UMP gate native cards, forecast interstitials and the anchored banner under the tab bar (#3211,
///   `tw_app_banner_enabled`). `tw_banner_enabled` gates every format. A build without valid AdMob identifiers
///   (`AdsSettings`) requests no ads; one without a banner unit requests no banner.
/// - Events carry `traffic_type`: `development` for test units, else `internal` for builds with a provisioning profile
///   (Xcode, ad hoc) or TestFlight's receipt, and `production` for App Store installs (#3228, `InstallSource`).
/// - Crashlytics collects crash reports with a configured Firebase app, independent of the analytics choice, as in
///   the Cordova build.
@MainActor
@Observable
final class Monetization {
    static let shared: Monetization = {
        let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "monetization")
        let settings = AdsSettings.current
        let install = InstallSource.read()
        let trafficType = AdsSettings.trafficType(settings, install: install)
        log.notice("""
            traffic_type \(trafficType, privacy: .public) (provisioning profile \(install.provisioned, privacy: .public), \
            sandbox receipt \(install.sandboxReceipt, privacy: .public))
            """)
        // The choice is handed back to a fallback Cordova build at every write (IN-17). Without a stored choice the
        // device's region setting decides (not the app's language; `AnalyticsRegion`).
        return Monetization(analytics: UsageAnalytics(sdk: FirebaseAnalyticsSdk(), records: HandBackConsentRecords.app,
                                                      trafficType: trafficType,
                                                      region: Locale.current.region?.identifier,
                                                      log: { log.notice("\($0, privacy: .public)") }),
                            settings: settings)
    }()

    private(set) var nativeAds: ForecastNativeAds?
    /// The anchored banner shows (the slot under the tab bar, #3211).
    private(set) var bannerShown = false
    @ObservationIgnored private(set) var banner: AdMobBanner?
    @ObservationIgnored private var twAds: TwAds?
    @ObservationIgnored private var sessionStart: Int64?
    /// The windows that can show the banner, in the order they appeared; the first one shows it (CODEX-3211-3: one
    /// `BannerView` cannot be in two iPad windows).
    private var bannerWindows: [UUID] = []
    @ObservationIgnored private var windowWidths: [UUID: CGFloat] = [:]
    /// The width the current banner was requested for (the owner window's).
    @ObservationIgnored private var width: CGFloat?
    @ObservationIgnored private var interstitial: ForecastInterstitial?
    @ObservationIgnored let analytics: UsageAnalytics
    @ObservationIgnored private let settings: AdsSettings?
    @ObservationIgnored var readTracking: @MainActor () -> TrackingStatus = { GoogleAdsPlatform.trackingStatus }
    /// Remote Config of the ads: Firebase's with a configured app, else none (the defaults). Tests give fixed values.
    @ObservationIgnored var configSource: @MainActor () -> (any BannerConfigSource)? = {
        AnalyticsGuard.firebaseConfigured ? FirebaseBannerConfigSource() : nil
    }
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
        // The banner's `tw_banner_delay_seconds` counts from the window's appearance (`sessionStart` of TwAds).
        if sessionStart == nil { sessionStart = clock.nowMs }
        startAdsIfShown()
    }

    /// A window's root appeared; the first window still open shows the banner.
    func bannerWindowAppeared(_ window: UUID) {
        if !bannerWindows.contains(window) { bannerWindows.append(window) }
        ownerWidthChanged()
        refreshEligibility()
    }

    func bannerWindowDisappeared(_ window: UUID) {
        bannerWindows.removeAll { $0 == window }
        windowWidths[window] = nil
        ownerWidthChanged()
        // CODEX-3211-7: without a window nothing can show the banner, so it is not requested.
        refreshEligibility()
    }

    /// A window's width changed (a rotation or a resized window): a new banner for the showing window's width
    /// (`orientationchange`).
    func windowWidthChanged(_ window: UUID, _ newWidth: CGFloat) {
        windowWidths[window] = newWidth
        ownerWidthChanged()
    }

    /// The width of the window that shows the banner.
    var bannerWindowWidth: CGFloat? { bannerWindows.first.flatMap { windowWidths[$0] } }

    private func ownerWidthChanged() {
        guard let newWidth = bannerWindowWidth else { return }
        defer { width = newWidth }
        guard let old = width, abs(old - newWidth) >= 0.5 else { return }
        twAds?.refresh()
    }

    /// The forecast interstitial may load and show now (tests).
    var interstitialEnabled: Bool { interstitial?.enabled == true }

    /// Whether `window` is the one that shows the banner.
    func showsBanner(in window: UUID) -> Bool { bannerWindows.first == window }

    /// The banner for `ShellView(banner:)` of `window` while it shows there; nil reserves no space.
    func bannerView(for window: UUID) -> AnyView? {
        showsBanner(in: window) ? bannerView : nil
    }

    /// The banner while it shows; nil reserves no space.
    var bannerView: AnyView? {
        guard bannerShown, let banner, banner.view != nil else { return nil }
        return AnyView(BannerSlot(banner: banner))
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

    func refreshTrackingStatus() {
        shell?.trackingStatus = readTracking()
    }

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
        shell.onMenuOpen = { [weak self] in self?.refreshTrackingStatus() }
        analytics.onChoiceChange = { [weak shell] in shell?.analyticsAllowed = $0 }
        let previous = shell.onMenuRow
        shell.onMenuRow = { [weak self, weak shell] row in
            guard let self, let shell else { return previous(row) }
            switch row {
            case .analytics: chooseAnalytics(shell)
            case .adPrivacy: openAdPrivacy(shell)
            case .trackingPermission:
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
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
        refreshTrackingStatus()
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
        let source = configSource()
        platform.onTrackingRead = { [weak shell] status in
            if shell?.trackingStatus != status { shell?.trackingStatus = status }
        }
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
                                            track: { name, params in _ = trackAd(name, params) },
                                            chance: { [weak config] in
                                                config?.interstitialChance ?? RemoteBannerConfig.defaultInterstitialChance
                                            })
        if pageScreen() == nil { interstitial?.markVisible(shell.selected) }
        if let unit = settings.bannerUnit {
            // AdMobBanner logs its own lifecycle lines; TwAds' show and hide go through `trackAd`.
            let banner = AdMobBanner(unitID: unit, platform: platform, track: { name, params in analytics.track(name, params) },
                                     width: { [weak self] in self?.bannerWindowWidth })
            let ads = TwAds(adapter: banner, config: config, clock: clock, sessionStart: sessionStart ?? clock.nowMs,
                            track: { name, params in _ = trackAd(name, params) },
                            log: { log.notice("\($0, privacy: .public)") })
            ads.onShownChange = { [weak self] in self?.bannerShown = $0 }
            self.banner = banner
            twAds = ads
        }
        config.onChange = { [weak self] in
            self?.twAds?.configChanged()
            self?.refreshEligibility()
        }
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
            // The banner's request carries the old choice too: a new one loads with the current choice.
            twAds?.setPermitted(false)
            previousPersonalization = personalized
        }
        let permitted = consent.permitsRequests && !privacyFormOpen
        // The banner has its own switch and delay (TwAds); it shares this consent and privacy-form gate, and needs a
        // window to show in.
        twAds?.setPermitted(permitted && !bannerWindows.isEmpty)
        // `tw_banner_enabled` gates every format, as on Android (#3211).
        let allowed = permitted && config.ready && config.policy.enabled
        nativeAds?.setEnabled(allowed && config.nativeEnabled)
        interstitial?.setEnabled(allowed && config.interstitialEnabled)
    }

    // MARK: Menu rows

    /// 이용 통계: the Ionic popup. Where analytics is on by default (2026-11-24) it says so and offers 끄기 and 켜기;
    /// in the EEA, the United Kingdom, Switzerland and an unknown region it asks for consent as before, with 거부 / 철회
    /// and 동의. Off writes "false", on writes "true"; a choice that could not be saved shows `LOC_PRIVACY_SAVE_FAILED`.
    /// The menu stays open. The native texts come from `ios/Support/native-strings.json`.
    private func chooseAnalytics(_ shell: ShellModel) {
        let catalog = Catalog(code: shell.locale.catalog)
        let choose: (Bool) -> Void = { [weak self, weak shell] value in
            guard let self, let shell, !self.analytics.setCollectionEnabled(value) else { return }
            shell.show(Popup(title: "TodayWeather", lines: [catalog("LOC_PRIVACY_SAVE_FAILED")],
                             buttons: [.init(text: catalog("LOC_OK"), style: .positive)]))
        }
        let onByDefault = analytics.collectsByDefault
        let (detail, off, on) = onByDefault
            ? ("LOC_ANALYTICS_DETAIL_ON_BY_DEFAULT", "LOC_ANALYTICS_TURN_OFF", "LOC_ANALYTICS_TURN_ON")
            : ("LOC_ANALYTICS_DETAIL", "LOC_ANALYTICS_DENY", "LOC_ANALYTICS_ALLOW")
        shell.show(Popup(title: catalog("LOC_ANALYTICS_CHOICE"), lines: [catalog(detail)],
                         buttons: [.init(text: catalog(off), action: { choose(false) }),
                                   .init(text: catalog(on), action: { choose(true) })]))
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
