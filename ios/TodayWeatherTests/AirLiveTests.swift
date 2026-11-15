import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The live air page in the shell, in a window (IN-09, #2958): a tap on a station cell and on a detail cell, as VoiceOver's
/// activation reaches them, switches the shown values. `ProductionAirTests` runs the same against the legacy server; it
/// runs only when asked (`TW_PRODUCTION_AIR`) in a build with the private server URL, never in CI.
extension HostedShellTests {
@MainActor
struct AirLiveTests {
    /// The shell with the weather and air pages over `http`, 회현동 selected, opening on the Air tab.
    static func shell(_ http: any WeatherHTTP, baseURL: String) -> (ShellModel, WeatherScreens) {
        let holder = AppStateHolder(store: MemoryStore())
        let seoul = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                          country: "KR", location: Location(lat: 37.56, long: 126.98))
        holder.load(AppState(places: [.currentPositionPlaceholder, seoul], placeIndex: 1, units: .defaults(region: "KR"),
                             settings: Settings(startupPage: "3", refreshInterval: "0", theme: "light"),
                             cordovaExtras: JSONObject([("startVersion", 1)])))
        let shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: ["ko-KR"]), version: "test")
        let repository = WeatherRepository(baseURL: baseURL, cacheDirectory: nil, http: http)
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" })
        let screens = WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852))
        return (shell, screens)
    }

    static func wait(_ seconds: Double, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    @Test func tapsOnTheCellsSwitchTheShownValues() async throws {
        let (shell, screens) = Self.shell(WeatherTabTests.Server(AirTabTests.byPlace()), baseURL: "https://server.test.invalid")
        #expect(shell.selected == .air, "the startup page Air")
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        screens.handle(.launch)
        #expect(await Self.wait(900) { screens.airContent?.page.stations?.count == 3 })
        try await hosted.settle()
        try hosted.tap("air-station-2")
        try await hosted.settle()
        #expect(screens.airScope?.stnIndex == 2)
        #expect(screens.airContent?.page.info?.first?.text.first?.text == "청계천로")
        try hosted.tap("air-code-pm10")
        try await hosted.settle()
        #expect(screens.airScope?.aqiCode == "pm10")
        #expect(screens.airContent?.page.main?.title == "미세먼지")
        #expect(screens.airContent?.page.stations?.map(\.selected) == [false, false, true], "the station stays")
    }
}

/// The IN-09 completion criterion on a simulator against production (read-only GETs): Seoul's stations show, and a tap
/// on another station changes the values. Enabled by `TW_PRODUCTION_AIR` (passed as `TEST_RUNNER_TW_PRODUCTION_AIR`) in an
/// app built with the private `TW_SERVER_URL` (Info.plist `TWServerURL`); otherwise skipped. The requests go through the
/// app's client (`URLSessionGet`); their paths (no host) and the page before and after the tap are written to the app's
/// `tmp/air-production/`.
@MainActor
struct ProductionAirTests {
    nonisolated static let enabled = ProcessInfo.processInfo.environment["TW_PRODUCTION_AIR"] != nil
        && !((Bundle.main.infoDictionary?["TWServerURL"] as? String) ?? "").isEmpty

    /// The app's own client, with each request's path and query recorded (the host is the private input).
    final class Recording: WeatherHTTP, @unchecked Sendable {
        private let lock = NSLock()
        private var log: [String] = []
        let client = URLSessionGet()
        var paths: [String] { lock.withLock { log } }

        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            let path = url.path + (url.query.map { "?" + $0 } ?? "")
            lock.withLock { log.append("GET \(path)") }
            return try await client.get(url, headers: headers)
        }
    }

    @Test(.enabled(if: enabled)) func seoulShowsItsStationsAndAnotherStationChangesTheValues() async throws {
        let server = try #require(Bundle.main.infoDictionary?["TWServerURL"] as? String)
        let http = Recording()
        let (shell, screens) = HostedShellTests.AirLiveTests.shell(http, baseURL: server)
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("air-production", isDirectory: true)
        try? FileManager.default.removeItem(at: out)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        screens.handle(.launch)
        #expect(await HostedShellTests.AirLiveTests.wait(60) { (screens.airContent?.page.stations?.count ?? 0) > 1 },
                "Seoul shows its stations")
        try await hosted.settle(800)
        let before = try #require(screens.airContent?.page)
        let stations = (before.stations ?? []).map(\.heading)
        try snapshot(hosted, out.appendingPathComponent("seoul-air-station-0.png"))
        try hosted.tap("air-station-1")
        try await hosted.settle(800)
        let after = try #require(screens.airContent?.page)
        try snapshot(hosted, out.appendingPathComponent("seoul-air-station-1.png"))
        #expect(screens.airScope?.stnIndex == 1)
        #expect(after.stations?.map(\.selected) == (0..<stations.count).map { $0 == 1 })
        // The shown observation is the second station's: its name in the info card, its value on the gauge.
        let shown = after.info?.first?.text.first?.text
        #expect(shown == stations[1], "the info card names the chosen station")
        #expect(shown != before.info?.first?.text.first?.text, "the values changed")
        let summary = [
            "stations: \(stations.joined(separator: ", "))",
            "station 0: info \(before.info?.first?.text.first?.text ?? "-"), main \(before.main?.value ?? "-"), gauge \(before.gauge.label)",
            "station 1: info \(shown ?? "-"), main \(after.main?.value ?? "-"), gauge \(after.gauge.label)",
            "requests (\(http.paths.count)):",
        ] + http.paths
        try (summary.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("run.txt"), atomically: true, encoding: .utf8)
        print("AIR-PRODUCTION \(out.path)\n" + summary.joined(separator: "\n"))
        #expect(http.paths.count == 1, "one read-only GET")
        #expect(http.paths.allSatisfy { $0.hasPrefix("GET /weather/v000903/coord/37.56,126.98?") })
    }

    private func snapshot(_ hosted: HostedView, _ url: URL) throws {
        let renderer = UIGraphicsImageRenderer(bounds: hosted.window.bounds)
        let image = renderer.image { _ in hosted.window.drawHierarchy(in: hosted.window.bounds, afterScreenUpdates: true) }
        try #require(image.pngData()).write(to: url)
    }
}
}
