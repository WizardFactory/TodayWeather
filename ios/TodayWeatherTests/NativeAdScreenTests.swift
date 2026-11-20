import GoogleMobileAds
import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

extension HostedShellTests {
    @MainActor struct NativeAdScreenTests {
        @Test func placementFollowsRenderedForecastAndAirContent() throws {
            let hourly = try WeatherScreenshotTests.content("kma-seoul-hourly")
            let daily = try WeatherScreenshotTests.content("kma-seoul-daily")
            let air = try AirScreenshotTests.content("kma-seoul")
            #expect(hourly.nativeAnchor == (hourly.page.hourlyAqi == nil ? .chart : .hourlyAqi))
            #expect(daily.nativeAnchor == .dayDetails)
            #expect(air.nativeAnchor == .chart)
            #expect(try AirScreenshotTests.content("kma-jeju-no-air").nativeAnchor == nil)
        }

        /// Opt-in capture of Google test inventory on this simulator. Network availability is separate from hermetic tests.
        @Test(.enabled(if: ProcessInfo.processInfo.environment["TW_NATIVE_CAPTURE"] == "1"))
        func captureTheFourTestAdPlacements() async throws {
            await withCheckedContinuation { (completion: CheckedContinuation<Void, Never>) in
                MobileAds.shared.start { _ in completion.resume() }
            }
            let output = URL.temporaryDirectory.appending(path: "native-ad-screens")
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            for tab in [ShellTab.forecast, .dailyforecast, .air, .search] {
                let ads = ForecastNativeAds(unitID: "ca-app-pub-3940256099942544/3986624511",
                                            request: { Request() }, track: { name, values in
                    print("NATIVE-CAPTURE \(name) \(values)")
                    return true
                })
                ads.setEnabled(true)
                for _ in 0..<120 where !ads.hasFreshCreative { try await Task.sleep(for: .milliseconds(250)) }
                try #require(ads.hasFreshCreative, "Google test inventory ready for \(tab)")
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
                                      content: { _ in tabContent }).environment(\.forecastNativeAds, ads)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
                let hosted = try HostedView(view, size: size)
                defer { hosted.close(); ads.setEnabled(false) }
                try await hosted.settle()
                let scroll = try #require(hosted.elements().compactMap { $0 as? UIScrollView }
                    .filter { $0.bounds.height > 300 && !$0.isHidden }.max { $0.bounds.height < $1.bounds.height })
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
