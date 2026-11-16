import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// Sharing from the weather and air pages (IN-16, #2965 AC1; O16, V20), in the live shell in a window: the share button of
/// S03, S04 and S05, tapped as VoiceOver's activation taps it, hands the selected place's Cordova message to the share
/// sheet; Korean links for a Korean WebView language, English otherwise; nothing without a location; the system sheet is
/// a `UIActivityViewController` whose popover points at the share button. The server is a double.
extension HostedShellTests {
@MainActor
struct ShareTests {
    final class Recorder: SharePresenting {
        var messages: [String] = []
        func present(_ message: String) { messages.append(message) }
    }

    static let seoul = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                             country: "KR", location: Location(lat: 37.56, long: 126.98))

    /// The shell with the weather and air pages over the server double, `places` with `index` selected, opening on the
    /// startup page's tab (Hourly by default).
    static func shell(languages: [String] = ["ko-KR"], places: [Place] = [.currentPositionPlaceholder, seoul],
                      index: Int = 1, startupPage: String = "0") -> (ShellModel, WeatherScreens) {
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(AppState(places: places, placeIndex: index, units: .defaults(region: "KR"),
                             settings: Settings(startupPage: startupPage, refreshInterval: "0", theme: "light"),
                             cordovaExtras: JSONObject([("startVersion", 1)])))
        let shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: languages), version: "test")
        let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil,
                                           http: WeatherTabTests.Server(WeatherTabTests.byPlace()))
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" })
        return (shell, WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852)))
    }

    /// The message the Cordova code builds for the selected place's record, in the shell's catalog and WebView language.
    static func expected(_ screens: WeatherScreens) throws -> String {
        let place = try #require(screens.session.selected)
        let catalog = Catalog(code: screens.shell.locale.catalog)
        return try #require(ShareMessage.build(screens.session.record(place), texts: ShareMessage.Texts { catalog($0) },
                                               language: screens.shell.locale.webLanguage))
    }

    /// Each of S03, S04 and S05 in its own live shell (the startup page opens it, as `AirLiveTests` opens S05).
    @Test(arguments: [("0", ShellTab.forecast), ("1", .dailyforecast), ("3", .air)])
    func eachPageSharesTheSelectedPlacesMessage(startupPage: String, tab: ShellTab) async throws {
        let (shell, screens) = Self.shell(startupPage: startupPage)
        #expect(shell.selected == tab)
        let recorder = Recorder()
        WeatherShare(presenter: recorder).attach(screens)
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        screens.handle(.launch)
        #expect(await AirLiveTests.wait(30) { screens.session.selected.map { screens.session.repository.cached($0) != nil } == true })
        #expect(await AirLiveTests.wait(10) { screens.content(tab) != nil }, "\(tab)")
        for _ in 0..<100 where hosted.element("forecast-share") == nil { try await hosted.settle(100) }
        let expected = try Self.expected(screens)
        #expect(expected.hasPrefix("회현동\n현재 "), "\(expected)")
        #expect(expected.hasSuffix("\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM"), "\(expected)")
        try hosted.tap("forecast-share")
        #expect(recorder.messages == [expected], "\(tab)")
    }

    @Test func otherLanguagesShareTheEnglishLink() async throws {
        let (shell, screens) = Self.shell(languages: ["en-US"])
        let recorder = Recorder()
        WeatherShare(presenter: recorder).attach(screens)
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        screens.handle(.launch)
        #expect(await AirLiveTests.wait(30) { screens.scope?.currentWeather != nil })
        try await hosted.settle()
        try hosted.tap("forecast-share")
        let message = try #require(recorder.messages.first)
        #expect(message.hasPrefix("회현동\nCurrent "), "\(message)")
        #expect(message.hasSuffix("\n\nTodayWeather https://twa.app.link/II1JstpVoM"), "\(message)")
        #expect(message == (try Self.expected(screens)))
    }

    /// `doTabShare` without a location shares nothing and asks how to start (`startPopup`, O02 of IN-10).
    @Test func aPlaceWithoutALocationSharesNothing() throws {
        let (_, screens) = Self.shell(places: [Place(currentPosition: true, disable: false)], index: 0)
        let recorder = Recorder()
        let share = WeatherShare(presenter: recorder)
        var startChoices = 0
        share.onNoLocation = { startChoices += 1 }
        share.attach(screens)
        screens.onShare()
        #expect(recorder.messages.isEmpty)
        #expect(startChoices == 1)
    }

    /// The app's launch connects the share button of the shell it creates (`WeatherShare.connect`).
    @Test func theLaunchConnectsTheShareButton() throws {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "test"),
                               weatherCache: nil)
        let recorder = Recorder()
        WeatherShare(presenter: recorder).connect(launch)
        launch.migrationFinished(AppState(places: [.currentPositionPlaceholder, Self.seoul], placeIndex: 1,
                                          cordovaExtras: JSONObject([("startVersion", 1)])))
        let weather = try #require(launch.weather)
        weather.onShare()
        #expect(recorder.messages == ["회현동\n"], "no weather yet: the city line, as the Cordova code shares it")
    }

    /// The system share sheet: a `UIActivityViewController` over the window's top view controller, its popover pointing at
    /// the share button (on iPad an arrow to it; on iPhone a sheet).
    @Test func theSheetPointsAtTheShareButton() async throws {
        let (shell, screens) = Self.shell()
        WeatherShare(presenter: SystemSharePresenter()).attach(screens)
        let size = UIDevice.current.userInterfaceIdiom == .pad ? CGSize(width: 1024, height: 1366) : CGSize(width: 393, height: 852)
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: size)
        defer { hosted.close() }
        screens.handle(.launch)
        #expect(await AirLiveTests.wait(30) { screens.scope?.currentWeather != nil })
        try await hosted.settle()
        let button = try #require(hosted.element("forecast-share"))
        try hosted.tap("forecast-share")
        #expect(await AirLiveTests.wait(10) { hosted.host.presentedViewController is UIActivityViewController })
        let sheet = try #require(hosted.host.presentedViewController as? UIActivityViewController)
        let popover = try #require(sheet.popoverPresentationController)
        let anchor = try #require(popover.sourceView)
        #expect(anchor is ShareAnchorView.AnchorView)
        #expect(popover.sourceRect == anchor.bounds)
        let anchorFrame = anchor.convert(anchor.bounds, to: nil)
        let buttonFrame = button.accessibilityFrame
        #expect(anchorFrame.width > 0 && anchorFrame.height > 0)
        #expect(buttonFrame.insetBy(dx: -6, dy: -6).contains(anchorFrame.insetBy(dx: 0.5, dy: 0.5)),
                "anchor \(anchorFrame) in the button \(buttonFrame)")
        try await hosted.settle(600)
        if UIDevice.current.userInterfaceIdiom == .pad {
            #expect(sheet.presentationController?.adaptivePresentationStyle(for: hosted.window.traitCollection) == .popover
                    || popover.arrowDirection != .unknown, "a popover on iPad")
            #expect(popover.arrowDirection == .up, "the arrow points up at the header's button")
        }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            hosted.host.dismiss(animated: false) { c.resume() }
        }
    }
}
}
