import GoogleMobileAds
import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

/// The anchored banner and the native card switched through Remote Config (#3211), with the app's own `Monetization`:
/// real UMP, the Google Mobile Ads SDK and Google's iOS demo units, and fixed Remote Config values in place of Firebase.
/// Run with `TEST_RUNNER_TW_BANNER_CAPTURE=1` on a simulator with network and the tracking answer already stored (the
/// IDFA explainer would wait for an answer). Screenshots go to the test host's temporary directory (`banner-switches`).
extension HostedShellTests {
    @MainActor struct BannerSwitchSmokeTests {
        /// Remote Config answering with fixed values at once.
        final class FixedConfig: BannerConfigSource {
            let fixed: [String: String]
            init(_ fixed: [String: String]) { self.fixed = fixed }
            func setDefaults(_ defaults: [String: String], done: @escaping @MainActor (Bool) -> Void) { done(true) }
            func setSettings(fetchTimeoutSeconds: Double, minimumFetchIntervalSeconds: Double,
                             done: @escaping @MainActor (Bool) -> Void) { done(true) }
            func loadActivated(done: @escaping @MainActor (Bool) -> Void) { done(true) }
            func fetchAndActivate(done: @escaping @MainActor (Bool) -> Void) { done(true) }
            func observeFormatUpdates(_ notify: @escaping @MainActor () -> Void) {}
            func activateUpdate(done: @escaping @MainActor (Bool) -> Void) { done(false) }
            func values() -> [String: String] { fixed }
        }

        static let settings = AdsSettings(nativeUnit: AdsSettings.testNativeUnit, interstitialUnit: AdsSettings.testInterstitialUnit,
                                          bannerUnit: AdsSettings.testBannerUnit, releaseAds: false)

        @Test(.enabled(if: ProcessInfo.processInfo.environment["TW_BANNER_CAPTURE"] == "1"),
              arguments: ["banner", "native", "off"])
        func theSwitchesSelectTheFormat(_ mode: String) async throws {
            let output = URL.temporaryDirectory.appending(path: "banner-switches")
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            let analytics = UsageAnalytics(sdk: PrivacyRowsTests.Sdk(), records: PrivacyRowsTests.Records(), trafficType: "development",
                                           region: "KR")
            let monetization = Monetization(analytics: analytics, settings: Self.settings, openURL: { _ in })
            monetization.configSource = {
                FixedConfig(["tw_banner_enabled": mode == "off" ? "false" : "true", "tw_banner_delay_seconds": "0",
                             "tw_app_banner_enabled": mode == "native" ? "false" : "true",
                             "tw_native_enabled": mode == "banner" ? "false" : "true",
                             // All off: every format switch stays on, so only tw_banner_enabled can stop them.
                             "tw_interstitial_enabled": mode == "banner" ? "false" : "true"])
            }
            let shell = ShellFixture.shell()
            shell.select(.forecast)
            monetization.attach(shell)
            // The window the banner shows in, as `RootView` registers it.
            let window = UUID()
            monetization.bannerWindowAppeared(window)
            monetization.uiStarted()
            let content = try WeatherScreenshotTests.content("kma-seoul-hourly")
            let tab = TabContent(title: content.page.title, page: AnyView(WeatherPageView(content: content, theme: .light)))
            let size = CGSize(width: 393, height: 852)
            // UMP's update, the SDK start and a test banner's load.
            for _ in 0..<300 where !(mode == "banner" ? monetization.bannerShown : monetization.nativeAds?.enabled == true) {
                try await Task.sleep(for: .milliseconds(200))
            }
            if mode == "off" { try await Task.sleep(for: .seconds(10)) }
            // The native card: Google's iOS native demo unit, else (no fill, as seen for #3059) the layout fixture.
            var inventory: (any ForecastNativeInventory)? = monetization.nativeAds
            if mode == "native" {
                for _ in 0..<100 where monetization.nativeAds?.hasFreshCreative != true {
                    try await Task.sleep(for: .milliseconds(200))
                }
                if monetization.nativeAds?.hasFreshCreative != true { inventory = NativeAdScreenTests.LayoutInventory() }
                print("BANNER-CAPTURE native creative \(monetization.nativeAds?.hasFreshCreative == true ? "sdk" : "fixture")")
            }
            let hosted = try HostedView(BannerHostView(monetization: monetization, shell: shell, tab: tab, inventory: inventory),
                                        size: size)
            defer { hosted.close() }
            try await hosted.settle(500)
            if mode == "native" {
                let scroll = try #require(hosted.elements().compactMap { $0 as? UIScrollView }.first { candidate in
                    let frame = candidate.convert(candidate.bounds, to: hosted.window)
                    return frame.height > 300 && frame.contains(CGPoint(x: size.width / 2, y: size.height / 2))
                })
                func card() -> ForecastCreativeView? { hosted.elements().compactMap { $0 as? ForecastCreativeView }.first }
                for _ in 0..<35 where card() == nil {
                    let end: CGFloat = max(.zero, scroll.contentSize.height - scroll.bounds.height)
                    scroll.setContentOffset(CGPoint(x: 0, y: min(end, scroll.contentOffset.y + 140)), animated: false)
                    try await hosted.settle(100)
                }
                let creative = try #require(card(), "a native card in the hourly page")
                let rect = creative.convert(creative.bounds, to: hosted.window)
                let end: CGFloat = max(.zero, scroll.contentSize.height - scroll.bounds.height)
                scroll.setContentOffset(CGPoint(x: 0, y: max(0, min(end, scroll.contentOffset.y + rect.midY - size.height / 2))),
                                        animated: false)
                try await hosted.settle(300)
            }
            let slot = hosted.element("shell-banner")
            switch mode {
            case "banner":
                #expect(monetization.bannerShown && monetization.banner?.view != nil, "a Google test banner loaded and shows")
                #expect(monetization.nativeAds?.enabled == false, "tw_native_enabled false keeps native cards off")
                let frame = try #require(slot).accessibilityFrame
                let tabBar = try #require(hosted.element("shell-tab-forecast")).accessibilityFrame
                #expect(frame.minY >= tabBar.maxY - 0.5 && abs(frame.maxY - size.height) < 0.5, "under the tab bar: \(frame)")
            case "native":
                #expect(monetization.nativeAds?.enabled == true)
                #expect(monetization.interstitialEnabled, "the interstitial switch alone decides here")
                #expect(!monetization.bannerShown && monetization.banner?.view == nil, "no banner request")
                #expect(slot == nil, "no reserved strip")
            default:
                #expect(monetization.nativeAds?.enabled == false && !monetization.bannerShown && monetization.banner?.view == nil,
                        "tw_banner_enabled false: no format loads")
                #expect(!monetization.interstitialEnabled, "the interstitial switch is on, the all-ads gate keeps it off")
                #expect(slot == nil)
            }
            let image = UIGraphicsImageRenderer(bounds: hosted.window.bounds).image { _ in
                hosted.window.drawHierarchy(in: hosted.window.bounds, afterScreenUpdates: true)
            }
            try image.pngData()?.write(to: output.appending(path: "\(mode).png"))
            if mode == "banner" {
                // CODEX-3211-7: without a window the banner is destroyed and not requested; a window brings it back.
                monetization.bannerWindowDisappeared(window)
                #expect(!monetization.bannerShown && monetization.banner?.view == nil)
                monetization.bannerWindowAppeared(window)
                for _ in 0..<300 where !monetization.bannerShown { try await Task.sleep(for: .milliseconds(200)) }
                #expect(monetization.bannerShown, "a returning window loads a new banner")
            }
            print("BANNER-CAPTURE \(mode) shown=\(monetization.bannerShown) native=\(monetization.nativeAds?.enabled == true) \(output.path)")
        }
    }

    /// CODEX-3211-3: one banner view, so only the first open window shows it and its width decides the banner's.
    @MainActor struct BannerWindowTests {
        @Test func theFirstOpenWindowShowsTheBanner() {
            let analytics = UsageAnalytics(sdk: PrivacyRowsTests.Sdk(), records: PrivacyRowsTests.Records(),
                                           trafficType: "development", region: "KR")
            let monetization = Monetization(analytics: analytics, settings: nil, openURL: { _ in })
            let first = UUID(), second = UUID()
            monetization.windowWidthChanged(second, 700)
            monetization.bannerWindowAppeared(first)
            monetization.bannerWindowAppeared(second)
            monetization.windowWidthChanged(first, 400)
            #expect(monetization.showsBanner(in: first) && !monetization.showsBanner(in: second))
            #expect(monetization.bannerWindowWidth == 400)
            #expect(monetization.bannerView(for: second) == nil)
            monetization.bannerWindowDisappeared(first)
            #expect(monetization.showsBanner(in: second) && monetization.bannerWindowWidth == 700)
        }
    }

    /// The production shell frame with the app's banner and native inventory, as `RootView` gives them.
    private struct BannerHostView: View {
        let monetization: Monetization
        let shell: ShellModel
        let tab: TodayWeather.TabContent
        let inventory: (any ForecastNativeInventory)?

        var body: some View {
            ShellFrame(model: shell, insets: BannerLayoutTests.insets, content: { _ in tab }, banner: monetization.bannerView)
                .environment(\.forecastNativeAds, inventory)
                .environment(\.locale, Locale(identifier: "ko_KR"))
                .ignoresSafeArea()
        }
    }
}
