import GoogleMobileAds
import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

extension HostedShellTests {
    @MainActor struct NativeAdScreenTests {
        /// A deterministic asset set for layout checks. The SDK never receives an impression or click from these fixtures.
        final class LayoutInventory: ForecastNativeInventory {
            var enabled = true
            let generation = 0
            var hasFreshCreative = true
            private var assigned: [ShellTab: ForecastCreative] = [:]
            func assignedCreative(for tab: ShellTab) -> ForecastCreative? { assigned[tab] }
            func assignCreative(to tab: ShellTab) -> ForecastCreative? {
                guard hasFreshCreative else { return nil }
                hasFreshCreative = false
                let creative = ForecastCreative(headline: "Test placement", advertiser: "Sample advertiser",
                    body: "A sample creative for the weather guide.", action: "Learn more", icon: nil) { adView in
                    guard let media = adView.mediaView else { return }
                    let artwork = UIImageView(image: UIImage(systemName: "cloud.sun.fill"))
                    artwork.tintColor = .systemIndigo
                    artwork.backgroundColor = .systemIndigo.withAlphaComponent(0.10)
                    artwork.contentMode = .scaleAspectFit
                    artwork.frame = media.bounds
                    artwork.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    media.addSubview(artwork)
                }
                assigned[tab] = creative
                return creative
            }
        }

        private final class CachedInventory: ForecastNativeInventory {
            let enabled = true
            let generation = 0
            let cache: ForecastNativeCache
            init(_ cache: ForecastNativeCache) { self.cache = cache }
            func assignCreative(to tab: ShellTab) -> ForecastCreative? { cache.assignCreative(to: tab) }
            func assignedCreative(for tab: ShellTab) -> ForecastCreative? { cache.assignedCreative(for: tab) }
        }

        @Test func returningToHourlyReusesTheRegisteredViewAndLeavesTheSpareForDaily() async throws {
            let inventory = CachedInventory(ForecastNativeCache())
            let hourly = try #require(LayoutInventory().assignCreative(to: .forecast))
            let daily = try #require(LayoutInventory().assignCreative(to: .dailyforecast))
            inventory.cache.store(hourly)
            let shell = ShellFixture.shell()
            shell.select(.forecast)
            let hosted = try HostedView(ShellFrame(model: shell, insets: PlacesScreenshotTests.insets, content: { tab in
                TabContent(page: AnyView(ScrollView { ForecastNativeSlot(tab: tab, theme: .light) }))
            }).environment(\.forecastNativeAds, inventory), size: CGSize(width: 393, height: 798))
            defer { hosted.close() }
            try await hosted.settle()
            #expect(hosted.elements().contains { $0 === hourly.registeredView })
            shell.tapTab(.air)
            try await hosted.settle()
            #expect(shell.selected == .air)
            inventory.cache.store(daily)
            #expect(!hosted.elements().contains { $0 is ForecastCreativeView })
            shell.tapTab(.forecast)
            try await hosted.settle()
            #expect(hosted.elements().contains { $0 === hourly.registeredView })
            #expect(inventory.cache.hasSpare)
            shell.tapTab(.dailyforecast)
            try await hosted.settle()
            #expect(hosted.elements().contains { $0 === daily.registeredView })
            #expect(!inventory.cache.hasSpare)
        }

        @Test func rapidTabVisitsCoalesceLoadsAndBackOffAfterNoFill() async throws {
            var now = ContinuousClock.now
            var loaders: [AdLoader] = []
            let ads = ForecastNativeAds(unitID: AdsSettings.testNativeUnit, request: { Request() },
                                        now: { now }, send: { loader, _ in loaders.append(loader) },
                                        track: { _, _ in true })
            ads.setEnabled(true)
            for tab in ShellTab.allCases { #expect(ads.assignCreative(to: tab) == nil) }
            #expect(loaders.isEmpty, "SDK requests are outside synchronous tab navigation")
            try #require(await AirLiveTests.wait(3) { !loaders.isEmpty })
            let first = try #require(loaders.first)
            #expect(loaders.count == 1)
            ads.adLoader(first, didFailToReceiveAdWithError: NSError(domain: "native-test", code: 1))
            now += .seconds(59)
            for tab in ShellTab.allCases { #expect(ads.assignCreative(to: tab) == nil) }
            await Task.yield()
            #expect(loaders.count == 1)
            now += .seconds(1)
            _ = ads.assignCreative(to: .dailyforecast)
            _ = ads.assignCreative(to: .forecast)
            #expect(await AirLiveTests.wait(3) { loaders.count == 2 })
            ads.setEnabled(false)
            ads.setEnabled(true)
            ads.setEnabled(false)
            await Task.yield()
            #expect(loaders.count == 2, "revocation cancels queued demand")
        }

        @Test func cachedCardsExpireFromLoadTimeAndConsentClearsEveryPlacement() throws {
            var now = ContinuousClock.now
            let cache = ForecastNativeCache(now: { now })
            let source = CachedInventory(cache)
            let placement = ForecastNativePlacement()
            for tab in ShellTab.allCases {
                let asset = try #require(LayoutInventory().assignCreative(to: tab))
                cache.store(asset)
                #expect(cache.assignCreative(to: tab) === asset)
            }
            placement.reached(source, tab: .forecast)
            #expect(placement.creative(for: source) != nil)
            #expect(!cache.needsSpare)
            now += .seconds(55 * 60 - 1)
            #expect(cache.assignCreative(to: .forecast) != nil)
            now += .seconds(1)
            #expect(cache.needsSpare)
            #expect(placement.creative(for: source) == nil, "foreground expiration also clears a retained visit")
            #expect(cache.assignCreative(to: .forecast) == nil)
            let fresh = try #require(LayoutInventory().assignCreative(to: .forecast))
            cache.store(fresh)
            #expect(cache.assignCreative(to: .forecast) === fresh)
            cache.store(try #require(LayoutInventory().assignCreative(to: .dailyforecast)))
            cache.clear()
            #expect(cache.assignCreative(to: .forecast) == nil && !cache.hasSpare)
        }

        @Test func reopeningSavedListDoesNotInsertALateCreative() async throws {
            let source = LayoutInventory()
            source.hasFreshCreative = false
            let f = try await PlacesScreenshotTests.fixture("list", language: "ko-KR")
            f.shell.select(.search)
            let hosted = try HostedView(ShellFrame(model: f.shell, insets: PlacesScreenshotTests.insets,
                content: { f.places.content($0) }).environment(\.forecastNativeAds, source),
                size: CGSize(width: 393, height: 798))
            defer { hosted.close() }
            try await hosted.settle()
            let originalVisit = f.shell.adVisit
            f.places.modeTapped()
            try await hosted.settle()
            source.hasFreshCreative = true
            f.places.modeTapped()
            try await hosted.settle()
            #expect(originalVisit == f.shell.adVisit)
            #expect(source.hasFreshCreative)
            #expect(!hosted.elements().contains { $0 is ForecastCreativeView })
        }

        @Test func readingAShortDailyDetailDoesNotRequireTheChartToDisappear() {
            // At the bottom of a short daily forecast the chart remains 230 pt above the detail in view.
            // Coordinates are relative to the first detail block and its first 90 pt are visible.
            let viewport = CGRect(x: 0, y: -230, width: 393, height: 320)
            var progress = ForecastDetailRead()
            let visible = ForecastDetailRead.reachesDetail(height: 90, viewport: viewport)
            let launch = progress.observeDetail(visible)
            let horizontal = progress.drag(CGSize(width: -120, height: -6))
            let forward = progress.drag(CGSize(width: 3, height: -40))
            let duplicate = progress.observeDetail(visible)
            #expect(!launch && !horizontal && forward && !duplicate)

            var longer = ForecastDetailRead()
            let beforeDetails = longer.drag(CGSize(width: 0, height: -80))
            let stillOnChart = longer.observeDetail(ForecastDetailRead.reachesDetail(height: 120,
                viewport: CGRect(x: 0, y: -480, width: 393, height: 320)))
            let intoDetails = longer.observeDetail(ForecastDetailRead.reachesDetail(height: 120, viewport: viewport))
            #expect(!beforeDetails && !stillOnChart && intoDetails)
        }

        @Test func placementFollowsRenderedForecastAndAirContent() throws {
            let hourly = try WeatherScreenshotTests.content("kma-seoul-hourly")
            let daily = try WeatherScreenshotTests.content("kma-seoul-daily")
            let air = try AirScreenshotTests.content("kma-seoul")
            #expect(hourly.nativeAnchor == (hourly.page.hourlyAqi == nil ? .chart : .hourlyAqi))
            #expect(daily.nativeAnchor == .dayDetails)
            #expect(air.nativeAnchor == .chart)
            #expect(try AirScreenshotTests.content("kma-jeju-no-air").nativeAnchor == nil)
        }

        @Test func cardKeepsItsDisclosureAndAssetsAtNarrowWidths() throws {
            let asset = try #require(LayoutInventory().assignCreative(to: .forecast))
            let view = ForecastCreativeView()
            let locale = Locale(identifier: "ko_KR")
            func height(stacked: Bool, accessible: Bool) -> CGFloat {
                view.configure(asset, stacked: stacked, accessible: accessible, theme: .light, locale: locale)
                return view.systemLayoutSizeFitting(CGSize(width: 320, height: 0),
                    withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
            }
            let compact = height(stacked: false, accessible: false)
            let stacked = height(stacked: true, accessible: false)
            let large = height(stacked: false, accessible: true)
            #expect(compact > 120 && compact < stacked * 0.70)
            #expect(large > compact)
            #expect(ForecastCreativeView.disclosure(locale) == "광고")
            #expect(view.adChoicesView != nil && view.mediaView != nil && view.headlineView != nil)
            #expect(view.callToActionView?.accessibilityTraits.contains(.button) == true)
        }

        /// Use TW_NATIVE_CAPTURE=1 for the deterministic layout fixture or sdk for real Google test inventory.
        /// Both paths present the production card inside the production shell and screen hierarchy.
        @Test(.enabled(if: ["1", "sdk"].contains(ProcessInfo.processInfo.environment["TW_NATIVE_CAPTURE"] ?? "")))
        func captureTheFourTestAdPlacements() async throws {
            let live = ProcessInfo.processInfo.environment["TW_NATIVE_CAPTURE"] == "sdk"
            if live {
                await withCheckedContinuation { (completion: CheckedContinuation<Void, Never>) in
                    MobileAds.shared.start { _ in completion.resume() }
                }
            }
            let output = URL.temporaryDirectory.appending(path: live ? "native-ad-sdk" : "native-ad-fixture")
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            for tab in [ShellTab.forecast, .dailyforecast, .air, .search] {
                let source: any ForecastNativeInventory
                if live {
                    var inventory: ForecastNativeAds?
                    for unit in ["3986624511", "2521693316"] {
                        var failed = false
                        let ads = ForecastNativeAds(unitID: "ca-app-pub-3940256099942544/" + unit, request: { Request() },
                                                   track: { name, values in
                            if name == "ad_load_error" { failed = true }
                            print("NATIVE-CAPTURE \(name) \(values)")
                            return true
                        })
                        ads.setEnabled(true)
                        for _ in 0..<100 where !failed && !ads.hasFreshCreative {
                            try await Task.sleep(for: .milliseconds(200))
                        }
                        if ads.hasFreshCreative { inventory = ads; break }
                        ads.setEnabled(false)
                    }
                    source = try #require(inventory, "A ready Google test creative for \(tab)")
                } else {
                    source = LayoutInventory()
                }
                let places = try await PlacesScreenshotTests.fixture("list", language: "ko-KR")
                let shell = places.shell
                shell.select(tab)
                let tabContent: TodayWeather.TabContent
                switch tab {
                case .forecast, .dailyforecast:
                    let content = try WeatherScreenshotTests.content(tab == .forecast ? "kma-seoul-hourly" : "kma-seoul-daily")
                    tabContent = TabContent(title: content.page.title, page: AnyView(WeatherPageView(content: content, theme: .light)))
                case .air:
                    let content = try AirScreenshotTests.content("kma-seoul")
                    tabContent = TabContent(title: content.page.title, page: AnyView(AirPageView(content: content, theme: .light)))
                case .search:
                    tabContent = try #require(places.places.content(.search))
                }
                let size = CGSize(width: 393, height: 798)
                let view = ShellFrame(model: shell, insets: PlacesScreenshotTests.insets,
                                      content: { _ in tabContent }).environment(\.forecastNativeAds, source)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
                let hosted = try HostedView(view, size: size)
                defer { hosted.close(); (source as? ForecastNativeAds)?.setEnabled(false) }
                try await hosted.settle()
                let scroll = try #require(hosted.elements().compactMap { $0 as? UIScrollView }
                    .first { candidate in
                        let frame = candidate.convert(candidate.bounds, to: hosted.window)
                        return frame.height > 300 && frame.contains(CGPoint(x: size.width / 2, y: size.height / 2))
                    })
                func card() -> ForecastCreativeView? { hosted.elements().compactMap { $0 as? ForecastCreativeView }.first }
                for _ in 0..<35 where card() == nil {
                    let end: CGFloat = max(.zero, scroll.contentSize.height - scroll.bounds.height)
                    scroll.setContentOffset(CGPoint(x: 0, y: min(end, scroll.contentOffset.y + 140)), animated: false)
                    try await hosted.settle(100)
                }
                let creative = try #require(card(), "SDK card on \(tab)")
                let rect = creative.convert(creative.bounds, to: hosted.window)
                let end: CGFloat = max(.zero, scroll.contentSize.height - scroll.bounds.height)
                scroll.setContentOffset(CGPoint(x: 0, y: max(0, min(end, scroll.contentOffset.y + rect.midY - size.height / 2))), animated: false)
                try await hosted.settle(300)
                let frame = creative.convert(creative.bounds, to: hosted.window)
                #expect(frame.minY >= 0 && frame.maxY <= size.height)
                let image = UIGraphicsImageRenderer(bounds: hosted.window.bounds).image { _ in
                    hosted.window.drawHierarchy(in: hosted.window.bounds, afterScreenUpdates: true)
                }
                try image.pngData()?.write(to: output.appending(path: "\(tab.rawValue).png"))
                print("NATIVE-CAPTURE \(tab.rawValue) \(frame) \(output.path)")
            }
        }
    }
}
