import CoreLocation
import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWStorage
import UIKit
@testable import TodayWeather

/// The IN-10 completion criterion on a simulator against production (#2959 AC2, read-only GETs to the legacy server and
/// the Places SDK with the private key): on a fresh install the app reaches S03 for the simulated position, and with
/// location denied, for a searched place. It drives the app as it launched (`AppLaunch.shared`, its own window, the real
/// CoreLocation and Places SDK) through its accessibility elements; ios/tools/start-production/run-start-check.sh
/// installs the app fresh, sets the simulator's position and its location permission, and runs one case:
/// `TW_PRODUCTION_START` (passed as `TEST_RUNNER_TW_PRODUCTION_START`) is `granted` or `denied`. Skipped otherwise and
/// in a build without the private server URL (CI). The page's state before and after, and the app's routes (no host),
/// go to the app's `tmp/start-production/`.
@MainActor
struct ProductionStartTests {
    nonisolated static let mode = ProcessInfo.processInfo.environment["TW_PRODUCTION_START"]
    nonisolated static let configured = !((Bundle.main.infoDictionary?["TWServerURL"] as? String) ?? "").isEmpty
    nonisolated static let granted = mode == "granted" && configured
    nonisolated static let denied = mode == "denied" && configured

    let out = FileManager.default.temporaryDirectory.appendingPathComponent("start-production", isDirectory: true)

    /// The app's window once S01 shows (a fresh install), with O01 closed.
    func startPage() async throws -> HostedView {
        let launch = AppLaunch.shared
        #expect(await HostedShellTests.AirLiveTests.wait(120) { launch.startPage != nil }, "S01 on a fresh install")
        let window = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow } ?? UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first)
        let app = try HostedView(appWindow: window)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        #expect(await HostedShellTests.AirLiveTests.wait(10) { launch.shell?.popups.first != nil }, "O01")
        try await app.settle(800)
        try snapshot(app, "o01")
        try app.tap("popup-button-0")
        try await app.settle(800)
        return app
    }

    /// S03 for the place: the shell on Hourly with the page applied.
    func expectHourly(_ app: HostedView, _ name: String) async throws -> String {
        let launch = AppLaunch.shared
        #expect(await HostedShellTests.AirLiveTests.wait(90) {
            if case .tab(let tab)? = launch.shell?.screen, tab == .forecast { return launch.weather?.pageContent != nil }
            return false
        }, "\(name): S03")
        // The page itself in the window, not the shell's empty default.
        #expect(await HostedShellTests.AirLiveTests.wait(30) { app.element("forecast-header") != nil }, "\(name): the Hourly page shows")
        try await app.settle(1500)
        try snapshot(app, "\(name)-s03")
        return launch.weather?.pageContent?.page.title ?? "-"
    }

    @Test(.enabled(if: granted)) func theSimulatedPositionReachesHourly() async throws {
        let app = try await startPage()
        try snapshot(app, "s01")
        try app.tap("start-location")
        let title = try await expectHourly(app, "granted")
        let state = try #require(AppLaunch.shared.holder.state)
        let current = try #require(state.places.first)
        #expect(current.currentPosition && !current.disable)
        #expect(state.placeIndex == 0)
        #expect(current.name != nil, "named from the geocode")
        try summary(["mode: granted", "title: \(title)", "place 0: \(current.name ?? "-") / \(current.address ?? "-")",
                     "location: \(current.location.map { "\($0.lat),\($0.long)" } ?? "-")",
                     "places: \(state.places.count), startVersion: \(String(describing: state.cordovaExtras["startVersion"]))"])
    }

    @Test(.enabled(if: denied)) func aSearchedPlaceReachesHourlyWithLocationDenied() async throws {
        let app = try await startPage()
        let launch = AppLaunch.shared
        let page = try #require(launch.startPage)
        try app.tap("start-location")
        // The denial message, no hang (#2871).
        #expect(await HostedShellTests.AirLiveTests.wait(30) { launch.shell?.popups.first?.title == "오류" }, "O04")
        let o04 = launch.shell?.popups.first.map { "\($0.lines) \($0.buttons.map(\.text))" } ?? "-"
        try await app.settle(800)
        try snapshot(app, "o04")
        try app.tap("popup-button-0")
        try await app.settle(500)
        // The word typed into the search box (its binding), then Google's predictions with the private key.
        page.change("London")
        #expect(await HostedShellTests.AirLiveTests.wait(30) { app.element("start-result-0") != nil }, "Places predictions")
        let predictions: [String]
        if case .predictions(_, let list)? = page.results { predictions = list.map(\.fullText) } else { predictions = [] }
        try await app.settle(800)
        try snapshot(app, "search")
        try app.tap("start-result-0")
        let title = try await expectHourly(app, "denied")
        let state = try #require(launch.holder.state)
        #expect(state.places.first?.disable == true, "the current position stays off")
        #expect(state.placeIndex == state.places.count - 1)
        try summary(["mode: denied", "location status: \(CLLocationManager().authorizationStatus.rawValue)", "O04: \(o04)",
                     "predictions: \(predictions.joined(separator: " | "))", "title: \(title)",
                     "place: \(state.places.last?.name ?? "-") / \(state.places.last?.address ?? "-")"])
    }

    private func snapshot(_ app: HostedView, _ name: String) throws {
        let renderer = UIGraphicsImageRenderer(bounds: app.window.bounds)
        let image = renderer.image { _ in app.window.drawHierarchy(in: app.window.bounds, afterScreenUpdates: true) }
        try #require(image.pngData()).write(to: out.appendingPathComponent("\(Self.mode ?? "-")-\(name).png"))
    }

    private func summary(_ lines: [String]) throws {
        try (lines.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("\(Self.mode ?? "-")-run.txt"),
                                                        atomically: true, encoding: .utf8)
        print("START-PRODUCTION \(out.path)\n" + lines.joined(separator: "\n"))
    }
}
