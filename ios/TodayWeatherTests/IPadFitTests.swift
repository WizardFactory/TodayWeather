import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// IN-18 AC4 (#2967): on iPad windows nothing is cut, in both orientations, after a window resize and at the largest
/// decided text size (`xxxLarge`, Dynamic Type as decided on #2948). The app is composed as it launches (`AppLaunch`,
/// `RootView`) over a server double with the captured answers, and walked through every screen and the main dialogs it
/// reaches without the SDKs: O01 over S01, S01, S03 (and its expanded chart), S04, S05, S02 and its edit mode, S09 with
/// O14 and O12, the menu S06, S07, S08, About O10, and for region KR S10, S11 and S12.
///
/// The window gets `xxxLarge` both in SwiftUI's environment and as the hosting controller's trait, so UIKit's metrics
/// see it too. In each state every accessibility element with an identifier that shows in the window must lie inside it:
/// across its whole width (rows that scroll sideways, as the Cordova tables did, are exempt: the air detail and station
/// cells and S11's pollutant tabs), and from its top; popups and the time picker also above the window's bottom (the
/// pages scroll, so their content may continue below). Each state's window is drawn to the app's
/// `tmp/ipad-fit/<language>-<window>-<state>.png` for a visual check.
///
/// iPadOS 26.5 rejects a programmatic orientation change of the test host's scene (`UISceneErrorDomain` 101, see
/// `ShellFitTests`), so a rotation here is a change of the window's frame; `tools/ipad/run-ipad-check.sh` turns the
/// iPad simulator itself (`IPadUITests`).
extension HostedShellTests {
@MainActor
struct IPadFitTests {
    /// The iPad Pro 13-inch's screen in both orientations, Split View's third and half, and a small Stage Manager window.
    static let sizes: [(String, CGSize)] = [
        ("portrait", CGSize(width: 1032, height: 1376)), ("landscape", CGSize(width: 1376, height: 1032)),
        ("third", CGSize(width: 320, height: 1032)), ("half", CGSize(width: 678, height: 1032)),
        ("stage", CGSize(width: 500, height: 600)),
    ]

    /// Identifier prefixes of rows that scroll sideways.
    static let sideways = ["air-code-", "air-station-", "nation-tab-"]
    /// Identifiers of dialogs, which must fit the window whole.
    static let dialogs = ["popup", "picker"]

    /// The legacy server: the captured weather (kma-seoul), the geocode of 회현동, the nationwide answer and warnings.
    static func server() throws -> NationTests.Server {
        let seoul = try References.data("forecast-kma-seoul.input.json")
        let nation = try NationFixtures.body("nation"), special = try NationFixtures.body("special")
        return NationTests.Server { url in
            let path = url.path
            if path.hasPrefix("/geocode/") { return .answer(0, Data(StartServer.geocodeSeoul.utf8)) }
            if path.contains("/kma/special") { return .answer(0.05, special) }
            if path.contains("/nation/") { return .answer(0.2, nation) }
            return .answer(0.05, seoul)
        }
    }

    /// The app as it launches, in a window of `size` at `xxxLarge`, with the migration finished on a first launch (S01).
    @MainActor
    final class App {
        let launch: AppLaunch
        let hosted: HostedView
        let language: String
        var size: CGSize
        var window: String
        var checked: [String] = []

        init(language: String, size: (String, CGSize)) throws {
            launch = AppLaunch(store: MemoryStore(),
                               environment: .init(preferredLanguages: [language], photosURL: nil, version: "2.0.0",
                                                  serverURL: "https://server.test.invalid"),
                               weatherHTTP: try IPadFitTests.server(), weatherCache: nil,
                               location: { TestLocation(system: .authorizedWhenInUse) }, placeSearch: { nil })
            hosted = try HostedView(RootView(launch: launch), size: size.1, dynamicType: .xxxLarge)
            hosted.host.traitOverrides.preferredContentSizeCategory = .extraExtraExtraLarge
            self.language = language
            self.size = size.1
            window = size.0
            launch.migrationFinished(AppState(units: .defaults(region: AppLanguage.region([language]))))
        }

        /// Resizes the window and waits (up to 5 s) until the layout has followed: the pages start their visits again
        /// with the new sizes after the layout pass that reported them.
        func resize(_ to: (String, CGSize)) async throws {
            hosted.window.frame = CGRect(origin: .zero, size: to.1)
            size = to.1
            window = to.0
            try await hosted.settle(400)
            for _ in 0..<25 where !inside() { try await hosted.settle(200) }
            #expect(hosted.window.bounds.size == to.1)
        }

        /// Whether every identified element that shows lies across the window (the first part of `check`).
        private func inside() -> Bool {
            let bounds = CGRect(origin: .zero, size: size)
            return hosted.elements().allSatisfy { element in
                guard let id = HostedView.identifier(element), !id.isEmpty,
                      !IPadFitTests.sideways.contains(where: id.hasPrefix) else { return true }
                let frame = element.accessibilityFrame
                guard frame.width > 0, frame.height > 0, frame.intersects(bounds) else { return true }
                return frame.minX >= -0.5 && frame.maxX <= size.width + 0.5
            }
        }

        func wait(_ identifier: String, _ seconds: Double = 10) async throws -> Bool {
            let found = await HostedShellTests.AirLiveTests.wait(seconds) { self.hosted.element(identifier) != nil }
            try await hosted.settle(300)
            return found
        }

        func tap(_ identifier: String) async throws {
            try hosted.tap(identifier)
            try await hosted.settle(300)
        }

        /// Every element with an identifier that shows in the window is inside it (see the suite's note).
        func check(_ state: String) throws {
            let name = "\(language) \(window) \(state)"
            let bounds = CGRect(origin: .zero, size: size)
            var seen = 0
            for element in hosted.elements() {
                guard let id = HostedView.identifier(element), !id.isEmpty else { continue }
                let frame = element.accessibilityFrame
                guard frame.width > 0, frame.height > 0, frame.intersects(bounds) else { continue }
                seen += 1
                if !IPadFitTests.sideways.contains(where: id.hasPrefix) {
                    #expect(frame.minX >= -0.5 && frame.maxX <= size.width + 0.5, "\(name): \(id) \(frame) across the window")
                }
                #expect(frame.minY >= -0.5, "\(name): \(id) \(frame) below the window's top")
                if IPadFitTests.dialogs.contains(where: { id == $0 || id.hasPrefix($0 + "-") }) {
                    #expect(frame.maxY <= size.height + 0.5, "\(name): \(id) \(frame) above the window's bottom")
                }
            }
            #expect(seen > 0, "\(name): elements")
            checked.append(state)
            try snapshot(state)
        }

        private func snapshot(_ state: String) throws {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(bounds: hosted.window.bounds, format: format).pngData { _ in
                hosted.window.drawHierarchy(in: hosted.window.bounds, afterScreenUpdates: true)
            }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ipad-fit")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = "\(language)-\(window)-\(state)".replacingOccurrences(of: " ", with: "_")
            try image.write(to: directory.appendingPathComponent("\(file).png"))
        }

        func close() { hosted.close() }
    }

    /// Walks the app through every screen and main dialog, checking each in the current window. Ends on Hourly.
    static func walk(_ app: App, check: (String) async throws -> Void) async throws {
        // O01 over S01, then S01.
        #expect(try await app.wait("start-page"), "S01")
        try await check("O01")
        try await app.tap("popup-button-0")
        try await check("S01")
        // A shortcut adds 서울 and opens Hourly (S03).
        try await app.tap("start-shortcut-0")
        #expect(try await app.wait("forecast-header"), "\(app.window) S03")
        try await check("S03")
        // The expander row (a tap gesture, as the Cordova `ng-click` row): its action.
        app.launch.weather?.toggleExpanded()
        try await app.hosted.settle(400)
        try await check("S03-expanded")
        app.launch.weather?.toggleExpanded()
        try await app.hosted.settle(300)
        try await app.tap("shell-tab-dailyforecast")
        #expect(try await app.wait("forecast-header"), "\(app.window) S04")
        try await check("S04")
        try await app.tap("shell-tab-air")
        #expect(try await app.wait("air-header"), "\(app.window) S05")
        try await check("S05")
        try await app.tap("shell-tab-search")
        #expect(try await app.wait("places-list"), "\(app.window) S02")
        try await check("S02")
        try await app.tap("places-mode")
        try await check("S02-edit")
        try await app.tap("places-mode")
        // S09 from Hourly's bell, the picker O14 on the add row, and O12 for the unsaved defaults.
        try await app.tap("shell-tab-forecast")
        #expect(try await app.wait("forecast-bell"), "\(app.window) S03 bell")
        try await app.tap("forecast-bell")
        #expect(try await app.wait("alarms-page"), "\(app.window) S09")
        try await check("S09")
        if app.hosted.element("alarms-add") != nil {
            try await app.tap("alarms-add")
            #expect(try await app.wait("picker"), "\(app.window) O14")
            try await check("O14")
            try await app.tap("picker-close")
        }
        try await app.tap("alarms-back")
        #expect(try await app.wait("popup"), "\(app.window) O12")
        try await check("O12")
        // Save leaves S09 with the defaults stored (no Firebase here: nothing is asked or posted).
        try await app.tap("popup-button-1")
        #expect(await HostedShellTests.AirLiveTests.wait(5) { app.hosted.element("alarms-page") == nil }, "\(app.window) back from S09")
        try await app.hosted.settle(300)
        // The menu, S07, S08 and About.
        try await openMenu(app)
        try await check("S06")
        try await app.tap("shell-menu-units")
        #expect(try await app.wait("settings-row-temperatureUnit"), "\(app.window) S07")
        try await check("S07")
        try await app.tap("settings-row-temperatureUnit")
        try await check("S08")
        try await app.tap("settings-back")
        try await app.tap("settings-back")
        try await openMenu(app)
        try await app.tap("shell-menu-about")
        #expect(try await app.wait("popup"), "\(app.window) O10")
        try await check("O10")
        try await app.tap("popup-button-0")
        // S10, S11 and S12 for region KR.
        if app.launch.shell?.menuRows.contains(.nationalWeather) == true {
            for (row, state) in [("nationalWeather", "S10"), ("nationalAir", "S11"), ("specialWeather", "S12")] {
                try await openMenu(app)
                try await app.tap("shell-menu-\(row)")
                #expect(await HostedShellTests.AirLiveTests.wait(10) {
                    app.hosted.element("nation-back") != nil && app.hosted.element("nation-loading") == nil
                }, "\(app.window) \(state)")
                try await app.hosted.settle(400)
                try await check(state)
                try await app.tap("nation-back")
            }
        }
        try await app.tap("shell-tab-forecast")
    }

    static func openMenu(_ app: App) async throws {
        try await app.tap("shell-menu-button")
        #expect(try await app.hosted.menuInPlace(), "\(app.window) menu")
    }

    /// Each window size on its own, from the first launch through every screen, in Korean (with the Korea-only pages),
    /// English and German (the longest labels).
    @Test(arguments: ["ko-KR", "en-US", "de-DE"])
    func everyScreenFitsEachIPadWindow(language: String) async throws {
        for size in Self.sizes {
            let app = try App(language: language, size: size)
            defer { app.close() }
            try await Self.walk(app) { try app.check($0) }
            let expected = language == "ko-KR" ? 18 : 15
            #expect(app.checked.count == expected, "\(language) \(size.0): \(app.checked)")
        }
    }

    /// One app whose window turns and resizes on every screen, as a rotation and a Split View or Stage Manager resize
    /// change an iPad window: each state is checked in portrait, landscape, a third, a half and a small window, and back
    /// in portrait.
    @Test func everyScreenFollowsRotationAndResizing() async throws {
        let app = try App(language: "ko-KR", size: Self.sizes[0])
        defer { app.close() }
        try await Self.walk(app) { state in
            for size in Self.sizes + [Self.sizes[0]] {
                try await app.resize(size)
                try app.check("\(state)-live")
            }
        }
        #expect(app.checked.count == 18 * (Self.sizes.count + 1))
    }
}
}
