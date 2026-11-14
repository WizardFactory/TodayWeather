import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// A recorder of the URLs the app hands to the system (test code only).
@MainActor
final class RecordingOpener: URLOpening {
    private(set) var opened: [URL] = []
    func open(_ url: URL) { opened.append(url) }
}

/// A fixed user agent (test code only).
@MainActor
struct FixedUserAgent: UserAgentProviding {
    let text: String
    func userAgent() async -> String { text }
}

/// The JavaScriptCore golden of the settings and the Cordova iOS capture's observations, read from the repository's
/// Core/Tests/TWDataTests/Golden (the app-hosted tests run on the simulator of the Mac that has the checkout).
enum SettingsGoldenFiles {
    static let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Core/Tests/TWDataTests/Golden")

    static func json(_ name: String) throws -> JSONValue {
        try JSONValue.parse(Data(contentsOf: directory.appendingPathComponent(name)))
    }
}

/// The settings pages and the menu's hand-offs in the app (IN-12, #2961): the menu rows open S07, S08 and About, a
/// choice applies at once, the back button returns, and each hand-off opens the Cordova iOS app's target.
extension HostedShellTests {
@MainActor
struct SettingsTests {
    @MainActor
    struct Fixture {
        let shell: ShellModel
        let settings: SettingsScreens
        let opener = RecordingOpener()
        let clock = SettingsClock()

        init(languages: [String] = ["ko-KR"], userAgent: String = "UA", deviceId: String = "DEVICE", mailTo: String = "feedback@example.com",
             version: String = "2.0.0") {
            shell = ShellFixture.shell(languages: languages)
            let repository = WeatherRepository(baseURL: nil, cacheDirectory: nil)
            let session = WeatherSession(repository: repository, holder: shell.holder, acceptLanguage: { "ko-KR,ko;q=0.9" },
                                         clock: clock)
            settings = SettingsScreens(shell: shell, actions: SettingsActions(holder: shell.holder, session: session, push: nil),
                                       opener: opener,
                                       mail: FeedbackMail(to: mailTo, version: version, deviceId: { deviceId },
                                                          userAgent: FixedUserAgent(text: userAgent)))
        }

        func view() -> some View { ShellView(model: shell, page: settings.pageView) }
    }

    @Test func menuRowsOpenThePagesAndAChoiceAppliesAtOnce() async throws {
        let f = Fixture()
        let hosted = try HostedView(f.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-units")
        try await hosted.settle(500)
        #expect(!f.shell.menuOpen, "단위설정 closes the menu")
        #expect(f.settings.pages == [.units])
        #expect(hosted.element("settings-units") != nil)
        try hosted.tap("settings-row-temperatureUnit")
        try await hosted.settle()
        #expect(f.settings.pages == [.units, .list("temperatureUnit")])
        #expect(hosted.element("settings-list-temperatureUnit") != nil)
        try hosted.tap("settings-row-F")
        try await hosted.settle()
        #expect(f.shell.holder.state?.units.temperatureUnit == "F", "applied at once")
        #expect(f.settings.content(.list("temperatureUnit")).rows.map(\.checked) == [false, true])
        try hosted.tap("settings-back")
        try await hosted.settle()
        #expect(f.settings.pages == [.units])
        #expect(f.settings.content(.units).rows.first?.value == "F")
        try hosted.tap("settings-back")
        try await hosted.settle()
        #expect(f.settings.pages.isEmpty)
        #expect(hosted.element("shell-tab-forecast") != nil)

        // The theme list from the menu; the shell takes the theme at once.
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-theme")
        try await hosted.settle(500)
        #expect(f.settings.pages == [.list("theme")])
        try hosted.tap("settings-row-dark")
        try await hosted.settle()
        #expect(f.shell.theme == .dark)
        #expect(f.shell.menuValue(.theme) == .key("LOC_DARK_THEME"))
        try hosted.tap("settings-back")
        try await hosted.settle()
        #expect(f.settings.pages.isEmpty)
    }

    /// S03's standard row (`goUnitsPage`) opens S07 through the same hook.
    @Test func theWeatherPageOpensTheUnitsPage() {
        let f = Fixture()
        f.shell.onMenuRow(.units)
        #expect(f.settings.pages == [.units])
    }

    /// 널스쿨 풍향 keeps the menu open; 응원리뷰쓰기 closes it; both open the Cordova iOS targets.
    @Test func theWindMapAndTheStoreOpenTheirPages() async throws {
        let golden = try SettingsGoldenFiles.json("settings.json")
        let f = Fixture()
        let hosted = try HostedView(f.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-nullschoolWind")
        #expect(f.shell.menuOpen, "the wind map keeps the menu open")
        try hosted.tap("shell-menu-rateApp")
        #expect(!f.shell.menuOpen)
        let menu = (golden["menu"]?.arrayValue ?? []).filter { $0["lang"]?.stringValue == "ko" }
        let wind = menu.first { $0["row"]?.stringValue == "nullschool" }?["trace"]?[0]?[1]?.stringValue
        let store = menu.first { $0["row"]?.stringValue == "openMarket" }?["trace"]?[1]?[1]?.stringValue
        #expect(f.opener.opened.map(\.absoluteString) == [try #require(wind), try #require(store)])
    }

    /// 의견보내기: the `mailto:` link the Cordova iOS app navigated to, as its WKWebView parsed it (the capture), with the
    /// golden's address, version, device UUID and user agent.
    @Test(arguments: [("ko-KR", "ko"), ("en-US", "en")])
    func theFeedbackMailIsTheCordovaLink(language: String, lang: String) async throws {
        let golden = try SettingsGoldenFiles.json("settings.json")
        let capture = try SettingsGoldenFiles.json("settings-capture.json")
        let device = try #require(golden["device"])
        let f = Fixture(languages: [language], userAgent: try #require(golden["ua"]?.stringValue),
                        deviceId: try #require(device["uuid"]?.stringValue), mailTo: try #require(golden["config"]?["mailTo"]?.stringValue),
                        version: try #require(device["version"]?.stringValue))
        f.shell.openMenu()
        f.shell.chooseMenuRow(.sendFeedback)
        #expect(!f.shell.menuOpen, "the menu closes first")
        for _ in 0..<100 where f.opener.opened.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        let raw = (golden["menu"]?.arrayValue ?? []).first { $0["lang"]?.stringValue == lang && $0["row"]?.stringValue == "sendMail" }?["location"]?
            .stringValue
        let href = (capture["mail"]?.arrayValue ?? []).first { $0["raw"]?.stringValue == raw }?["href"]?.stringValue
        #expect(f.opener.opened.map(\.absoluteString) == [try #require(href, "WebKit's URL for \(lang)")])
    }

    /// The user agent the mail carries: a WKWebView's, the one the Cordova build reported on the same runtime.
    @Test func theWebViewUserAgentIsTheCordovaOne() async throws {
        let capture = try SettingsGoldenFiles.json("settings-capture.json")
        let agent = await WebViewUserAgent().userAgent()
        #expect(agent == capture["userAgent"]?.stringValue)
    }

    /// About (O10) over the menu, in Korean and English, with the Cordova texts; OK closes it and the menu stays.
    @Test(arguments: [("ko-KR", "ko"), ("en-US", "en")])
    func aboutOpensInEveryLanguage(language: String, lang: String) async throws {
        let golden = try SettingsGoldenFiles.json("settings.json")
        let alert = try #require((golden["menu"]?.arrayValue ?? [])
            .first { $0["lang"]?.stringValue == lang && $0["row"]?.stringValue == "openInfo" }?["trace"]?[0]?[1])
        let f = Fixture(languages: [language])
        let hosted = try HostedView(f.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-about")
        try await hosted.settle()
        #expect(f.shell.menuOpen, "About opens over the menu")
        let popup = try #require(f.shell.popups.first)
        #expect(popup.title == alert["title"]?.stringValue)
        #expect(popup.lines.joined(separator: "<br>") == alert["template"]?.stringValue)
        #expect(popup.buttons.map(\.text) == [alert["okText"]?.stringValue ?? ""])
        #expect(popup.buttons.first?.style == .positive, "$ionicPopup.alert's button-positive")
        #expect(hosted.element("popup") != nil)
        try hosted.tap("popup-button-0")
        try await hosted.settle()
        #expect(f.shell.popups.isEmpty)
        #expect(f.shell.menuOpen)
    }

    /// At the largest text size (`xxxLarge`, #2948) in every catalog on the 375 pt iPhone SE: S07 and every S08 list keep
    /// their rows inside the window's width (labels and values wrap; the list scrolls).
    @Test(arguments: ["ko", "en", "de", "ja", "zh-CN", "zh-TW"])
    func pagesFitTheLargestTextSize(catalog: String) async throws {
        let languages = ["ko": "ko-KR", "en": "en-US", "de": "de-DE", "ja": "ja-JP", "zh-CN": "zh-CN", "zh-TW": "zh-TW"]
        let f = Fixture(languages: [try #require(languages[catalog])])
        #expect(f.shell.locale.catalog == catalog)
        let hosted = try HostedView(f.view(), size: CGSize(width: 375, height: 667), dynamicType: .xxxLarge)
        defer { hosted.close() }
        for page in [SettingsPage.units] + (SettingLists.units + SettingLists.settings).map(SettingsPage.list) {
            while !f.settings.pages.isEmpty { f.settings.back() }
            switch page {
            case .units: f.settings.openUnits()
            case .list(let name): f.settings.openList(name)
            }
            try await hosted.settle(200)
            let rows = f.settings.content(page).rows
            for row in rows {
                let element = try #require(hosted.element("settings-row-\(row.id)"), "\(catalog) \(page) \(row.id)")
                let frame = element.accessibilityFrame
                #expect(frame.minX >= -0.5 && frame.maxX <= 375.5, "\(catalog) \(page) \(row.id) \(frame)")
                #expect(frame.height >= 55, "\(catalog) \(page) \(row.id) grows with the text")
            }
        }
    }

    /// The version row shows the bundle's version (`Util.version` from cordova-plugin-app-version) and does nothing.
    @Test func theVersionRow() {
        let environment = AppLaunch.Environment.system
        #expect(environment.version == Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String)
        let f = Fixture(version: environment.version)
        #expect(f.shell.menuValue(.version) == .text("1.1.2"), "the fixture's shell version")
        f.shell.openMenu()
        f.shell.chooseMenuRow(.version)
        #expect(f.shell.menuOpen && f.opener.opened.isEmpty && f.settings.pages.isEmpty)
    }
}
}

/// A clock for the session in these tests: no timer fires (the refresh interval stays manual or far away).
final class SettingsClock: AppClock, @unchecked Sendable {
    var now: Date { Date(timeIntervalSince1970: 1_794_614_400) }
    func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: .seconds(3600))
    }
}
