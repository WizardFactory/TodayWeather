import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

extension HostedShellTests {
@MainActor
struct TrackingSettingsTests {
    private final class SystemChoice {
        var status: TrackingStatus = .unavailable
        var opened: [URL] = []
    }

    @Test func everyStatusReachesTheMenuAndOnlyDeniedReachesTheWeatherPages() async throws {
        let fixture = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
        let shell = fixture.shell
        let choice = SystemChoice()
        let privacy = Monetization(analytics: UsageAnalytics(sdk: PrivacyRowsTests.Sdk(), records: PrivacyRowsTests.Records(),
                                                              trafficType: "development"),
                                   settings: nil, openURL: { choice.opened.append($0) })
        privacy.readTracking = { choice.status }
        privacy.attach(shell)
        let size = CGSize(width: 402, height: 874)
        let insets = ShellInsets(statusBar: 54, top: 8, bottom: 34, leading: 0, trailing: 0)
        let view = ShellFrame(model: shell, insets: insets, content: { tab in
            tab == .search ? fixture.places.content(tab) : fixture.weather.content(tab)
        })
        let host = try HostedView(view.ignoresSafeArea(), size: size)
        defer { host.close() }

        func scrollToEnd() async throws {
            try await host.settle()
            for case let scroll as UIScrollView in host.elements() where scroll.contentSize.height > scroll.bounds.height {
                let end = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
                scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: end), animated: false)
            }
            try await host.settle()
        }
        func capture(_ name: String) {
            let data = UIGraphicsImageRenderer(size: size).pngData { _ in
                host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
            }
            Attachment.record(data, named: "tracking-\(name).png")
        }
        for status in [TrackingStatus.denied, .authorized, .restricted, .notDetermined, .unavailable] {
            choice.status = status
            shell.openMenu()
            #expect(shell.trackingStatus == status)
            try await scrollToEnd()
            let row = host.element("shell-menu-trackingPermission")
            if status == .authorized || status == .denied {
                let keys = shell.menuRows
                let i = try #require(keys.firstIndex(of: .adPrivacy))
                #expect(keys[i + 1] == .trackingPermission)
                let label = try #require(row).accessibilityLabel
                #expect(label == (status == .denied ? "추적 허용 설정 · 허용 안 함" : "추적 허용 설정 · 허용됨"))
                capture("menu-\(status.name)")
                try host.tap("shell-menu-trackingPermission")
            } else {
                #expect(row == nil)
            }
            shell.closeMenu()
            for tab in [ShellTab.forecast, .dailyforecast, .air, .search] {
                shell.select(tab)
                let target = tab == .search ? "places-name-1" : tab == .air ? "air-header" : "forecast-header"
                try #require(await AirLiveTests.wait(5) { host.element(target) != nil })
                try await scrollToEnd()
                let button = host.element("tracking-open-settings")
                if status == .denied && tab != .search {
                    let frame = try #require(button).accessibilityFrame
                    #expect(!frame.isEmpty && host.window.bounds.contains(frame))
                    #expect(host.element("tracking-notice-text")?.accessibilityLabel == Catalog(code: "ko")("LOC_TRACKING_NOTICE"))
                    capture(tab.rawValue)
                    try host.tap("tracking-open-settings")
                } else {
                    #expect(button == nil)
                    #expect(host.element("tracking-notice-text") == nil)
                }
            }
            #expect(shell.popups.isEmpty)
        }
        #expect(choice.opened.map(\.absoluteString) == Array(repeating: UIApplication.openSettingsURLString, count: 5))
    }
}
}
