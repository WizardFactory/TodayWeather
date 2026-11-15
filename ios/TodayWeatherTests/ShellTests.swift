import SwiftUI
import Testing
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The shell in a window (IN-07, #2956): tab switching and the reload of the selected tab, the startup page, opening and
/// closing the side menu, its rows, and closing a popup, driven through the views' accessibility elements as a tap
/// reaches them.
extension HostedShellTests {
@MainActor
struct ShellTests {
    @Test func tabsSwitchAndTheSelectedWeatherTabReloads() async throws {
        let shell = ShellFixture.shell()
        var refreshed: [ShellTab] = []
        var clock: Int64 = 100_000
        shell.now = { clock }
        shell.onRefresh = { refreshed.append($0) }
        let hosted = try HostedView(ShellView(model: shell), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        #expect(shell.selected == .forecast)
        try hosted.tap("shell-tab-dailyforecast")
        try await hosted.settle()
        #expect(shell.selected == .dailyforecast)
        #expect(refreshed.isEmpty, "a tab change is no reload")
        clock += 701
        try hosted.tap("shell-tab-dailyforecast")
        #expect(refreshed == [.dailyforecast])
        clock += 500
        try hosted.tap("shell-tab-dailyforecast")
        #expect(refreshed == [.dailyforecast], "a second tap within 700 ms does nothing")
        try hosted.tap("shell-tab-search")
        try await hosted.settle()
        #expect(shell.selected == .search)
        clock += 5_000
        try hosted.tap("shell-tab-search")
        #expect(refreshed == [.dailyforecast], "the saved-places tab does not reload")
        try hosted.tap("shell-tab-air")
        try await hosted.settle()
        #expect(shell.selected == .air)
        // The selected tab's glyph is the reload glyph; the others keep theirs.
        #expect(Glyphs.tab(.air, selected: true) == Glyphs.reload)
        #expect(Glyphs.tab(.search, selected: true) == Glyphs.star)
    }

    @Test(arguments: [("0", ShellTab.forecast), ("1", .dailyforecast), ("2", .search), ("3", .air), ("7", .forecast)])
    func theFirstTabFollowsTheStartupPage(page: String, tab: ShellTab) async throws {
        let shell = ShellFixture.shell(ShellFixture.state(startupPage: page))
        #expect(shell.screen == .tab(tab))
        let hosted = try HostedView(ShellView(model: shell), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        #expect(hosted.element("shell-page-\(tab.rawValue)") != nil, "\(page): the \(tab) page shows")
    }

    /// S01 while `startVersion` is missing, then the startup page's tab (app.js L362-L390).
    @Test func theStartGateShowsS01UntilItCloses() {
        let shell = ShellFixture.shell(ShellFixture.state(startupPage: "3", startVersion: nil))
        #expect(shell.screen == .start)
        shell.closeStart()
        #expect(shell.screen == .tab(.air))
        #expect(ShellFixture.shell(ShellFixture.state(startVersion: .string("0.5"))).screen == .start)
    }

    @Test func theMenuOpensAndCloses() async throws {
        let shell = ShellFixture.shell()
        var chosen: [MenuRow] = []
        shell.onMenuRow = { chosen.append($0) }
        let hosted = try HostedView(ShellView(model: shell), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        #expect(!shell.menuOpen)
        try hosted.tap("shell-menu-button")
        #expect(shell.menuOpen)
        #expect(try await hosted.menuInPlace(), "the menu slid in on screen")
        try hosted.tap("shell-menu-back")
        try await hosted.settle(500)
        #expect(!shell.menuOpen)
        // A row that leaves the menu closes it first; the analytics row opens its popup over the menu.
        shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-theme")
        #expect(!shell.menuOpen)
        #expect(chosen == [.theme])
        shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-analytics")
        #expect(shell.menuOpen)
        #expect(chosen == [.theme, .analytics])
        shell.chooseMenuRow(.version)
        #expect(chosen == [.theme, .analytics], "the version row does nothing")
    }

    /// The rows and their values as the Cordova menu shows them (index.html L97-L171, iOS).
    @Test func menuRowsAndValues() {
        let korea = ShellFixture.shell(ShellFixture.state(theme: "dark", startupPage: "2"))
        #expect(korea.menuRows.count == 16)
        #expect(korea.menuValue(.startupPage) == .key("LOC_SAVED_LOCATIONS"))
        #expect(korea.menuValue(.refreshInterval) == .key("LOC_MANUAL"))
        #expect(korea.menuValue(.theme) == .key("LOC_DARK_THEME"))
        #expect(korea.menuValue(.version) == .text("1.1.2"))
        #expect(korea.menuValue(.units) == nil)
        let english = ShellFixture.shell(languages: ["en-US"])
        #expect(english.menuRows.first == .units, "region US: no Korea-only rows")
        #expect(english.locale.catalog == "en")
        #expect(english.locale.acceptLanguage == "en-US,en;q=0.9")
        let englishInKorea = ShellFixture.shell(languages: ["en-KR"])
        #expect(englishInKorea.locale.region == "US", "the WebView reports en-US for English in Korea")
    }

    /// A popup closes only through its buttons; the backdrop does not close it; the next popup shows after it.
    @Test func aPopupClosesThroughItsButtons() async throws {
        let shell = ShellFixture.shell()
        var answers: [String] = []
        shell.show(Popup(title: "TodayWeather", lines: ["first"], buttons: [
            .init(text: "Cancel") { answers.append("cancel") }, .init(text: "OK", style: .positive) { answers.append("ok") },
        ]))
        shell.show(Popup(title: "", lines: ["second"], buttons: [.init(text: "OK") { answers.append("second") }]))
        let hosted = try HostedView(ShellView(model: shell), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        #expect(hosted.element("popup") != nil)
        try hosted.tap("popup-button-1")
        try await hosted.settle()
        #expect(answers == ["ok"])
        #expect(shell.popups.count == 1, "the second popup shows next")
        try hosted.tap("popup-button-0")
        try await hosted.settle()
        #expect(answers == ["ok", "second"])
        #expect(shell.popups.isEmpty)
        #expect(hosted.element("popup") == nil)
    }
}
}

extension HostedShellTests {
/// Entry events (launch, resume, notification taps, links) wait until the Cordova migration has finished and are then
/// handled in arrival order; the shell opens with the migrated state.
@MainActor
struct LaunchContinuityTests {
    @Test func anEntryEventDuringTheMigrationIsHandledAfterIt() throws {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "1.1.2"))
        // The migration is still running: the shell is not there and the events wait.
        launch.entries.submit(.notification(cityIndex: "1"))
        launch.entries.submit(.link(URL(string: "todayweather://1")!))
        #expect(launch.shell == nil)
        #expect(launch.holder.state == nil)
        #expect(!launch.entries.isOpen)
        var handled: [EntryEvent] = []
        var stateWhenHandled: [AppState?] = []
        // What the shell does with each event, connected before the migration ends (as the app's screens do).
        launch.onShell = { shell in
            shell.onEntry = { event in
                handled.append(event)
                stateWhenHandled.append(shell.holder.state)
            }
        }
        launch.migrationFinished(ShellFixture.state())
        #expect(handled == [.launch, .notification(cityIndex: "1"), .link(URL(string: "todayweather://1")!)])
        #expect(stateWhenHandled.allSatisfy { $0?.placeIndex == 1 }, "handled with the migrated state")
        launch.entries.submit(.resume)
        #expect(handled.last == .resume, "after the migration: at once")
        launch.migrationFinished(AppState())
        #expect(launch.holder.state?.placeIndex == 1, "a second migration result changes nothing")
    }

    @Test func theLaunchScreenStaysUntilTheMigration() async throws {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "1.1.2"))
        let hosted = try HostedView(RootView(launch: launch), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        #expect(hosted.element("splash") != nil)
        #expect(hosted.element("shell-tab-forecast") == nil)
        launch.migrationFinished(ShellFixture.state(startVersion: nil))
        try await hosted.settle()
        #expect(hosted.element("start-placeholder") != nil, "no startVersion: S01")
        try hosted.tap("start-placeholder")
        try await hosted.settle()
        #expect(hosted.element("shell-tab-forecast") != nil)
    }
}
}
