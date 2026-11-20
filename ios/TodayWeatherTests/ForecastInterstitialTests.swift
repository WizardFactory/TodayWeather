import Foundation
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

@MainActor
struct ForecastInterstitialTests {
    @MainActor private final class Creative: ForecastInterstitialCreative {
        var callback: ((ForecastAdEvent) -> Void)?
        var presentations = 0
        func canPresent(from root: UIViewController) throws {}
        func present(from root: UIViewController, event: @escaping (ForecastAdEvent) -> Void) {
            presentations += 1
            callback = event
        }
    }

    @Test func drawsOnlyForReadyForegroundTapsAndIgnoresStaleInventory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var draws = 0
        let visits = ForecastAdVisits(directory: directory, localDay: { 20261120 }, draw: { draws += 1; return 0 })
        var now: TimeInterval = 1
        var foreground = true
        let root = UIViewController()
        var load: (@MainActor (Result<any ForecastInterstitialCreative, any Error>) -> Void)?
        var events: [String] = []
        var destinations: [ShellTab] = []
        let ads = ForecastInterstitial(visits: visits, load: { load = $0 },
                                       root: { foreground ? root : nil }, uptime: { now }, track: { name, params in
            guard params["ad_format"] == .text("interstitial") else { Issue.record("wrong format"); return }
            if case .text(let action) = params["action"] { events.append(action) }
            else { events.append(name) }
        })
        func tap(_ from: ShellTab, _ to: ShellTab, read: Bool = true) {
            let go = { destinations.append(to) }
            if !ads.handleIntent(from: from, to: to, readPastChart: read, navigate: go) { go() }
        }

        ads.markVisible(.forecast)
        tap(.forecast, .dailyforecast)
        ads.markVisible(.dailyforecast)
        #expect(events.isEmpty && draws == 0)
        ads.setEnabled(true)
        let stale = try #require(load)
        tap(.dailyforecast, .forecast)
        ads.setEnabled(false)
        let obsolete = Creative()
        stale(.success(obsolete))
        ads.setEnabled(true)
        let failedLoad = try #require(load)
        failedLoad(.failure(NSError(domain: "test", code: 1)))
        tap(.dailyforecast, .forecast)
        #expect(draws == 0 && obsolete.presentations == 0)
        #expect(events == ["request", "request", "failed", "ad_load_error"])

        now += 60
        ads.markVisible(.forecast)
        let loaded = Creative()
        load?(.success(loaded))
        tap(.dailyforecast, .forecast, read: false)
        foreground = false
        tap(.dailyforecast, .forecast)
        foreground = true
        #expect(draws == 0)
        let before = destinations.count
        tap(.dailyforecast, .forecast)
        tap(.dailyforecast, .forecast)
        #expect(loaded.presentations == 1 && draws == 1 && destinations.count == before)
        loaded.callback?(.showing)
        loaded.callback?(.impression)
        loaded.callback?(.dismissed)
        loaded.callback?(.failed(NSError(domain: "late", code: 2)))
        #expect(events.suffix(3) == ["show", "impression", "hide"])
        #expect(destinations.count == before + 1 && destinations.last == .forecast)
        #expect(!visits.available)
    }

    @Test func confirmedShowFailureNavigatesOnceAndRetainsOpportunity() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let visits = ForecastAdVisits(directory: directory, localDay: { 20261120 }, draw: { 0 })
        var arrivals = 0
        let creative = Creative()
        let ads = ForecastInterstitial(visits: visits, load: { $0(.success(creative)) },
                                       root: { UIViewController() }, uptime: { 0 }, track: { _, _ in })
        ads.markVisible(.dailyforecast)
        ads.setEnabled(true)
        #expect(ads.handleIntent(from: .forecast, to: .dailyforecast, readPastChart: true) { arrivals += 1 })
        creative.callback?(.failed(NSError(domain: "test", code: 2)))
        creative.callback?(.dismissed)
        #expect(arrivals == 1 && visits.available)
    }
}
