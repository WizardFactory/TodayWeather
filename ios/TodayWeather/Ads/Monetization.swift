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
///   Config, UMP with the Ads SDK (`AdsConsent`) and the banner (`TwAds`, `AdMobBanner`). A build without valid AdMob
///   identifiers (`AdsSettings`) requests no ads.
/// - Crashlytics collects crash reports with a configured Firebase app, independent of the analytics choice, as in
///   the Cordova build.
@MainActor
@Observable
final class Monetization {
    static let shared: Monetization = {
        let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "monetization")
        let settings = AdsSettings.current
        return Monetization(analytics: UsageAnalytics(sdk: FirebaseAnalyticsSdk(), records: AnalyticsConsentFiles.standard(),
                                                      trafficType: AdsSettings.trafficType(settings),
                                                      log: { log.notice("\($0, privacy: .public)") }),
                            settings: settings)
    }()

    /// The banner shows (the slot under the tab bar).
    private(set) var bannerShown = false

    @ObservationIgnored let analytics: UsageAnalytics
    @ObservationIgnored private let settings: AdsSettings?
    @ObservationIgnored private let openURL: @MainActor (URL) -> Void
    @ObservationIgnored private let clock = MainClock()
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "admob")
    @ObservationIgnored private(set) var banner: AdMobBanner?
    @ObservationIgnored private var twAds: TwAds?
    @ObservationIgnored private var consent: AdsConsent?
    @ObservationIgnored private var sessionStart: Int64?
    @ObservationIgnored private var shell: ShellModel?
    @ObservationIgnored private var width: CGFloat?

    /// `settings` nil: no ads. `openURL` opens the policy pages (the system browser).
    init(analytics: UsageAnalytics, settings: AdsSettings?,
         openURL: @escaping @MainActor (URL) -> Void = { UIApplication.shared.open($0) }) {
        self.analytics = analytics
        self.settings = settings
        self.openURL = openURL
    }

    /// Connects to the app's launch: each new shell gets the analytics choice, the menu rows and the screens. The
    /// previous `onShell` hook keeps running first.
    func connect(_ launch: AppLaunch) {
        let previous = launch.onShell
        launch.onShell = { [weak self] shell in
            previous(shell)
            self?.attach(shell)
        }
    }

    /// The app's window appeared: the session the banner delay counts from (`sessionStart` of TwAds).
    func uiStarted() {
        if sessionStart == nil { sessionStart = clock.nowMs }
        startAdsIfShown()
    }

    /// A page shows or hides the banner (`TwAds.setShowAds`; IN-10's start page).
    func setShowAds(_ show: Bool) {
        twAds?.setShowAds(show)
    }

    /// An analytics event of the schema (`Monetization.track`); IN-08, IN-10 and IN-11 report weather, place and
    /// location events through it.
    @discardableResult
    func track(_ name: String, _ params: [String: AnalyticsValue]) -> Bool {
        analytics.track(name, params)
    }

    /// The window's width changed (a rotation or a resized window): a new banner for the width
    /// (`orientationchange`).
    func windowWidthChanged(_ newWidth: CGFloat) {
        defer { width = newWidth }
        guard let old = width, abs(old - newWidth) >= 0.5 else { return }
        twAds?.refresh()
    }

    /// The banner for `ShellView(banner:)` while it shows.
    var bannerView: AnyView? {
        guard bannerShown, let banner, banner.view != nil else { return nil }
        return AnyView(BannerSlot(banner: banner))
    }

    /// A new shell: the stored analytics choice applies, and the privacy rows and the screens connect.
    func attach(_ shell: ShellModel) {
        self.shell = shell
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
        observeScreens(shell)
    }

    // MARK: Screens

    /// `$stateChangeSuccess` with the Cordova state names: S01 is `start`, the tabs `tab.<name>`.
    private func observeScreens(_ shell: ShellModel) {
        let screen = withObservationTracking {
            (shell.screen, shell.selected)
        } onChange: { [weak self, weak shell] in
            Task { @MainActor in
                guard let self, let shell, self.shell === shell else { return }
                self.observeScreens(shell)
            }
        }
        switch screen.0 {
        case .start: analytics.screen("start")
        case .tab: analytics.screen("tab.\(screen.1.rawValue)")
        }
        startAdsIfShown()
    }

    // MARK: Ads

    private func startAdsIfShown() {
        guard twAds == nil, let sessionStart, let shell, case .tab = shell.screen else { return }
        guard let settings else {
            log.notice("admob not_configured no_ads")
            return
        }
        let platform = GoogleAdsPlatform()
        let log = self.log
        let analytics = self.analytics
        let source: (any BannerConfigSource)? = AnalyticsGuard.firebaseConfigured ? FirebaseBannerConfigSource() : nil
        let config = RemoteBannerConfig(source: source, clock: clock, log: { log.notice("\($0, privacy: .public)") })
        let banner = AdMobBanner(unitID: settings.bannerUnit, platform: platform,
                                 track: { name, params in analytics.track(name, params) })
        let ads = TwAds(adapter: banner, config: config, clock: clock, sessionStart: sessionStart,
                        track: { name, params in analytics.track(name, params) },
                        log: { log.notice("\($0, privacy: .public)") })
        ads.onShownChange = { [weak self] in self?.bannerShown = $0 }
        let consent = AdsConsent(platform: platform, releaseAds: settings.releaseAds, clock: clock,
                                 track: { name, params in analytics.track(name, params) },
                                 log: { log.notice("\($0, privacy: .public)") },
                                 onReady: { [weak ads] status in
                                     analytics.setAdTrackingStatus(status.name)
                                     ads?.onAdapterReady()
                                 })
        self.banner = banner
        twAds = ads
        self.consent = consent
        consent.start()
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
        consent.openPrivacyOptions(onUnavailable: unavailable)
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
