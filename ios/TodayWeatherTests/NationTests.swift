import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The corpus answers (copied from android/ into ios/Core/Tests/TWDomainTests/Corpus by import_corpus.py), read from the
/// repository's ios/ directory (the app-hosted tests run on the simulator of the Mac that has the checkout).
enum NationFixtures {
    static let inputs = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Core/Tests/TWDomainTests/Corpus/inputs")

    static func body(_ name: String) throws -> Data { try Data(contentsOf: inputs.appendingPathComponent("\(name).json")) }
}

/// The nationwide pages and the warnings in the app (IN-13, #2962): the Korea-only menu rows open S10, S11 and S12 over
/// the tabs, each opening requests its answer with the units and the WebView's language, `$ionicLoading` covers S10 and
/// S11 until the answer (the back button does nothing meanwhile), the modes and tabs switch the labels, a failed answer
/// leaves the names or no card, back returns to the tabs, and each page reports its Cordova state. The server is a double.
extension HostedShellTests {
@MainActor
struct NationTests {
    /// A server double on the real clock: per request the behavior its URL asks for.
    final class Server: WeatherHTTP, @unchecked Sendable {
        enum Behavior { case answer(Double, Data), fail(Double, Int) }
        private let lock = NSLock()
        private var recorded: [(URL, [String: String])] = []
        private var behave: @Sendable (URL) -> Behavior
        init(_ behavior: @escaping @Sendable (URL) -> Behavior) { behave = behavior }
        var requests: [(URL, [String: String])] { lock.withLock { recorded } }
        func set(_ behavior: @escaping @Sendable (URL) -> Behavior) { lock.withLock { behave = behavior } }

        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            let behavior = lock.withLock { recorded.append((url, headers)); return behave }
            switch behavior(url) {
            case .answer(let seconds, let body):
                try await Task.sleep(for: .seconds(seconds))
                return body
            case .fail(let seconds, let status):
                try await Task.sleep(for: .seconds(seconds))
                throw URLSessionGet.StatusError(status: status)
            }
        }
    }

    @MainActor
    struct Fixture {
        let shell: ShellModel
        let server: Server
        let nation: NationScreens

        init(languages: [String] = ["ko-KR"], delay: Double = 0.5) throws {
            shell = ShellFixture.shell(languages: languages)
            let nationBody = try NationFixtures.body("nation"), specialBody = try NationFixtures.body("special")
            server = Server { url in
                url.path.contains("/kma/special") ? .answer(0.1, specialBody) : .answer(delay, nationBody)
            }
            nation = NationScreens(shell: shell, source: NationSource(baseURL: "https://server.test.invalid", http: server))
        }

        func view() -> some View { ShellView(model: shell, page: nation.pageView) }
    }

    private func waitLoaded(_ f: Fixture, _ hosted: HostedView) async throws -> Bool {
        for _ in 0..<60 where f.nation.loading { try await hosted.settle(100) }
        try await hosted.settle()
        return !f.nation.loading
    }

    @Test func theRowsOpenTheirPagesWithTheirAnswers() async throws {
        let f = try Fixture()
        let hosted = try HostedView(f.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()

        // 전국날씨: the menu closes, the loading covers the page until the answer, the labels show the first mode.
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-nationalWeather")
        try await hosted.settle(100)
        #expect(!f.shell.menuOpen, "전국날씨 closes the menu")
        #expect(f.nation.page == .nation)
        #expect(f.nation.loading)
        #expect(hosted.element("nation-loading") != nil)
        #expect(hosted.element("nation-title") != nil && f.nation.content.title == "한국")
        // The backdrop takes the back button's tap: nothing happens while loading (Ionic, B9 of the Android plan).
        f.nation.back()
        #expect(f.nation.page == .nation)
        #expect(try await waitLoaded(f, hosted))
        #expect(hosted.element("nation-loading") == nil)
        let seoul = try #require(f.nation.content.labels.first)
        #expect(seoul.name == "서울" && seoul.icon != nil && seoul.lines.count == 1)
        #expect(hosted.element("nation-label-서울") != nil)
        try hosted.tap("nation-mode-2")
        try await hosted.settle()
        #expect(f.nation.mode == .wind)
        #expect(f.nation.content.labels.first?.lines.last?.unit == "m/s", "the wind speed unit of the stored units")
        try hosted.tap("nation-mode-1")
        try await hosted.settle()
        #expect(f.nation.mode == .rain)
        try hosted.tap("nation-back")
        try await hosted.settle()
        #expect(f.nation.page == nil)
        #expect(hosted.element("shell-tab-forecast") != nil)

        // 전국미세먼지: a new opening starts on PM2.5 and requests again; the tabs switch the pollutant.
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-nationalAir")
        #expect(try await waitLoaded(f, hosted))
        #expect(f.nation.page == .nationAir)
        #expect(f.nation.airType == "pm2.5")
        #expect(hosted.element("nation-title") != nil && f.nation.content.title == "한국")
        for type in Nationwide.airTypes.reversed() {
            try hosted.tap("nation-tab-\(type)")
            try await hosted.settle(100)
            #expect(f.nation.airType == type)
        }
        #expect(f.nation.content.labels.first?.background != Nationwide.noGrade)
        try hosted.tap("nation-back")
        try await hosted.settle()

        // 기상특보: no loading overlay; the cards of the answer.
        f.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        try hosted.tap("shell-menu-specialWeather")
        try await hosted.settle(100)
        #expect(f.nation.page == .warnings)
        #expect(!f.nation.loading)
        for _ in 0..<30 where f.nation.cards.isEmpty { try await hosted.settle(100) }
        #expect(f.nation.cards.count == 3)
        #expect(f.nation.cards.first?.heading.hasPrefix("기상특보 2026. 11. ") == true)
        #expect(hosted.element("nation-card-0") != nil)
        #expect(hosted.element("nation-title") != nil && f.nation.content.title == "기상특보")
        try hosted.tap("nation-back")
        try await hosted.settle()
        #expect(f.nation.page == nil)

        // Each opening sent its request, with the units and the WebView's language.
        // A busy machine can hold the 0.5 s answer past 2 s, when `_getHttp` sends its next attempt (one to three per
        // opening; NationSourceTests checks their timing on a virtual clock).
        let paths = f.server.requests.map { $0.0.path }
        #expect((2...6).contains(paths.filter { $0 == "/v000903/nation/KR" }.count), "\(paths)")
        #expect(paths.last == "/v000903/kma/special" && paths.filter { $0 == "/v000903/kma/special" }.count == 1, "\(paths)")
        #expect(f.server.requests.allSatisfy { $0.1 == ["Accept-Language": "ko-KR,ko;q=0.9"] })
        // The stored units (the fixture's state), in `Units.getAllUnits()` order.
        let units = try #require(f.shell.holder.state?.units)
        let expected = NationSource.nationURL(base: "https://server.test.invalid", region: "KR", units: units)
        #expect(f.server.requests.first?.0.absoluteString == expected)
    }

    /// A failed answer: the labels keep their names (S10, S11), no card (S12).
    @Test func aFailedAnswerShowsTheNamesOrNoCard() async throws {
        let f = try Fixture()
        f.server.set { _ in .fail(0.1, 500) }
        let hosted = try HostedView(f.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        f.shell.onMenuRow(.nationalWeather)
        #expect(try await waitLoaded(f, hosted))
        #expect(f.nation.response == nil)
        #expect(f.nation.content.labels.map(\.name) == Nationwide.weatherCities.map(\.name))
        #expect(f.nation.content.labels.allSatisfy { $0.icon == nil && $0.lines.isEmpty })
        #expect(hosted.element("nation-label-울산") != nil)
        f.nation.back()
        f.shell.onMenuRow(.nationalAir)
        #expect(try await waitLoaded(f, hosted))
        #expect(f.nation.content.labels.allSatisfy { $0.lines.isEmpty && $0.background == Nationwide.noGrade })
        f.nation.back()
        f.shell.onMenuRow(.specialWeather)
        try await hosted.settle(600)
        #expect(f.nation.page == .warnings)
        #expect(f.nation.cards.isEmpty)
        #expect(hosted.element("nation-card-0") == nil)
    }

    /// An answer that arrives after the page was left and opened again counts only for the opening that sent it.
    @Test func anAnswerCountsForItsOpeningOnly() async throws {
        let f = try Fixture(delay: 0.6)
        f.shell.onMenuRow(.specialWeather)
        f.nation.back()
        f.shell.onMenuRow(.nationalWeather)
        #expect(f.nation.loading)
        for _ in 0..<40 where f.nation.loading { try await Task.sleep(for: .milliseconds(100)) }
        #expect(!f.nation.loading)
        #expect(f.nation.page == .nation)
        #expect(f.nation.cards.isEmpty, "the warnings' answer of the earlier opening is not shown")
        #expect(f.nation.response != nil)
    }

    /// A clock whose sleeps end only when their task is cancelled: no timeout or later attempt fires by itself.
    struct StoppedClock: AppClock {
        var now: Date { Date(timeIntervalSince1970: 0) }
        func sleep(for duration: Duration) async throws {
            try await Task.sleep(for: .seconds(86_400))
        }
    }

    /// A server that holds every request until its task is cancelled, and counts the cancelled ones.
    final class HoldingServer: WeatherHTTP, @unchecked Sendable {
        private let lock = NSLock()
        private var started = 0
        private var cancelledCount = 0
        var requests: Int { lock.withLock { started } }
        var cancelled: Int { lock.withLock { cancelledCount } }

        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            lock.withLock { started += 1 }
            do {
                try await Task.sleep(for: .seconds(86_400))
            } catch {
                lock.withLock { cancelledCount += 1 }
                throw error
            }
            return Data()
        }
    }

    /// Closing a page or opening another cancels the request it sent (CODEX-IN13-1, as the Android `NationLoads.close`
    /// cancels its job); the cancelled request's end changes nothing.
    @Test func leavingAPageCancelsItsRequest() async throws {
        let shell = ShellFixture.shell(languages: ["ko-KR"])
        let server = HoldingServer()
        let nation = NationScreens(shell: shell, source: NationSource(baseURL: "https://server.test.invalid", http: server,
                                                                      clock: StoppedClock()))
        nation.menuRow(.specialWeather)
        for _ in 0..<100 where server.requests < 1 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(server.requests == 1)
        nation.back()
        for _ in 0..<100 where server.cancelled < 1 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(server.cancelled == 1, "back cancels the warnings request")
        #expect(nation.page == nil && nation.cards.isEmpty)

        nation.menuRow(.specialWeather)
        for _ in 0..<100 where server.requests < 2 { try await Task.sleep(for: .milliseconds(50)) }
        nation.menuRow(.nationalAir)
        for _ in 0..<100 where server.cancelled < 2 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(server.cancelled == 2, "opening another page cancels the earlier page's request")
        #expect(nation.page == .nationAir && nation.loading)
    }

    /// The rows show for region KR only (`getRegion() === 'KR'`; 전국날씨 also needs the TodayWeather product, which this
    /// app is); other rows go on to the hook before this one.
    @Test func theRowsAreKoreanAndOtherRowsGoOn() async throws {
        #expect(MenuRow.rows(region: "KR").filter(\.krOnly) == [.specialWeather, .nationalWeather, .nationalAir, .nullschoolWind])
        #expect(MenuRow.rows(region: "US").filter(\.krOnly).isEmpty)
        let english = try Fixture(languages: ["en-US"])
        #expect(english.shell.locale.region != "KR")
        let hosted = try HostedView(english.view(), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        english.shell.openMenu()
        #expect(try await hosted.menuInPlace())
        #expect(hosted.element("shell-menu-nationalWeather") == nil)
        #expect(hosted.element("shell-menu-specialWeather") == nil)
        #expect(hosted.element("shell-menu-units") != nil)

        var other: [MenuRow] = []
        let shell = ShellFixture.shell()
        shell.onMenuRow = { other.append($0) }
        let nation = NationScreens(shell: shell, source: NationSource(baseURL: nil))
        shell.onMenuRow(.units)
        shell.onMenuRow(.about)
        #expect(other == [.units, .about])
        #expect(nation.page == nil)
    }

    /// `screen_view` with the Cordova states `nation`, `nation-air` and `kma-special` (in `AnalyticsSchema.screens`).
    @Test func thePagesAreScreens() async throws {
        let records = PrivacyRowsTests.Records()
        records.choice = "true"
        records.collection = true
        let sdk = PrivacyRowsTests.Sdk()
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: records, trafficType: "development"),
                                        settings: nil, openURL: { _ in })
        let f = try Fixture()
        monetization.pageScreen = { f.nation.screenName }
        monetization.attach(f.shell)
        for row in [MenuRow.nationalWeather, .nationalAir, .specialWeather] {
            f.shell.onMenuRow(row)
            for _ in 0..<40 where f.nation.loading { try await Task.sleep(for: .milliseconds(50)) }
            try await Task.sleep(for: .milliseconds(50))
            f.nation.back()
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(sdk.events == ["screen_view tab.forecast", "screen_view nation", "screen_view tab.forecast", "screen_view nation-air",
                               "screen_view tab.forecast", "screen_view kma-special", "screen_view tab.forecast"])
        #expect(["nation", "nation-air", "kma-special"].allSatisfy(AnalyticsSchema.screens.contains))
    }
}
}
