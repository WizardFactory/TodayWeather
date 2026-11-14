import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The weather pages in the shell (IN-08, #2957): the launch and a tap on the selected tab reload through IN-07's hook,
/// the request carries the WebView's `Accept-Language` and the units, the header shows the spinner while the place loads
/// (O17), a failure shows the retry confirmation O03 with the Cordova texts and its OK reloads, the expander is stored, the
/// pollen and air-forecast popups, and a late response stays with its place (V09). The server is a double in this test;
/// the state is injected through the `AppStateHolder` (an unsigned build has no App Group container).
@MainActor
@Suite(.serialized)
struct WeatherTabTests {
    /// A server double on the real clock: per request the behavior its URL asks for.
    final class Server: WeatherHTTP, @unchecked Sendable {
        enum Behavior { case answer(Double, Data), fail(Double, Int) }
        private let lock = NSLock()
        private var recorded: [(URL, [String: String])] = []
        let behavior: @Sendable (URL) -> Behavior
        init(_ behavior: @escaping @Sendable (URL) -> Behavior) { self.behavior = behavior }
        var requests: [(URL, [String: String])] { lock.withLock { recorded } }

        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            lock.withLock { recorded.append((url, headers)) }
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

    struct Fixture {
        let server: Server
        let holder: AppStateHolder
        let shell: ShellModel
        let screens: WeatherScreens

        @MainActor
        init(_ behavior: @escaping @Sendable (URL) -> Server.Behavior) {
            server = Server(behavior)
            holder = AppStateHolder(store: Memory())
            let seoul = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                              country: "KR", location: Location(lat: 37.56, long: 126.98))
            let london = Place(currentPosition: false, disable: false, name: "런던", address: "영국 런던", country: "GB",
                               location: Location(lat: 51.51, long: -0.13))
            holder.load(AppState(places: [.currentPositionPlaceholder, seoul, london], placeIndex: 1,
                                 units: .defaults(region: "KR"), cordovaExtras: JSONObject([("startVersion", 1)])))
            shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: ["ko-KR"]), version: "test")
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: server)
            let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" })
            screens = WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852))
        }
    }

    final class Memory: AppStateSaving, @unchecked Sendable {
        func save(_ state: AppState) throws {}
    }

    static func body(_ fixture: String) -> Data {
        (try? Data(contentsOf: References.url("forecast-\(fixture).input.json"))) ?? Data()
    }

    static func byPlace(seoul: Double = 0.05, london: Double = 0.05) -> @Sendable (URL) -> Server.Behavior {
        let s = body("kma-seoul"), l = body("vc-london")
        return { url in url.path.contains("37.56,126.98") ? .answer(seoul, s) : .answer(london, l) }
    }

    // Generous: the screenshot suites (IN-05, IN-07, IN-08) render synchronously on the main actor and may hold it for
    // minutes in a full run; the wait ends as soon as the condition holds.
    private func eventually(_ seconds: Double = 900, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    @Test func theLaunchLoadsTheSelectedPlaceAndATabTapReloads() async throws {
        let f = Fixture(Self.byPlace(seoul: 0.4))
        #expect(f.shell.selected == .forecast)
        f.screens.handle(.launch)
        #expect(await eventually { f.server.requests.count == 1 })
        let (url, headers) = try #require(f.server.requests.first)
        #expect(url.absoluteString == "https://server.test.invalid/weather/v000903/coord/37.56,126.98?temperatureUnit=C"
                + "&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq")
        #expect(headers["Accept-Language"] == "ko-KR,ko;q=0.9", "the WebView's header (ShellLocale.acceptLanguage)")
        // O17: the spinner in the title while the place loads.
        #expect(f.screens.content(.forecast)?.titleAccessory != nil)
        #expect(await eventually { f.screens.scope?.currentWeather != nil })
        let content = try #require(f.screens.content(.forecast))
        #expect(content.title == "회현동")
        #expect(content.titleAccessory == nil, "loaded: no spinner, and no location glyph for a saved place")
        #expect(f.holder.state?.places[1].source == "KMA")

        // A tap on the selected tab (more than 700 ms after the last one) reloads at once (`reloadEvent 'tab'`).
        f.shell.now = { 10_000 }
        f.shell.tapTab(.forecast)
        #expect(await eventually { f.server.requests.count == 2 })
        // The Daily tab opens a new visit of the same place.
        f.shell.now = { 20_000 }
        f.shell.tapTab(.dailyforecast)
        #expect(await eventually { f.screens.scope?.type == .mid })
        #expect(f.screens.content(.dailyforecast)?.title == "회현동")
        #expect(f.server.requests.count == 2, "opening a tab loads nothing")
    }

    @Test func aFailureShowsTheRetryConfirmationAndOKReloads() async throws {
        let f = Fixture { _ in .fail(0.05, 503) }
        f.screens.handle(.launch)
        #expect(await eventually { !f.shell.popups.isEmpty })
        let popup = try #require(f.shell.popups.first)
        // The texts and buttons of the captured Cordova popup (ForecastReference/forecast-captures.json, o03-weather).
        let captured = try #require(try References.json("forecast-captures.json")["pages"]?["o03-weather"]?["popup"])
        #expect(popup.title == captured["title"]?.stringValue)
        #expect(popup.lines == captured["body"]?.arrayValue?.compactMap(\.stringValue))
        #expect(popup.buttons.map(\.text) == captured["buttons"]?.arrayValue?.compactMap { $0["text"]?.stringValue })
        #expect(popup.buttons.map(\.style) == [.standard, .positive], "button-default, button-positive")
        f.shell.now = { 10_000 }
        f.shell.tapTab(.forecast)
        try await Task.sleep(for: .milliseconds(300))
        #expect(f.server.requests.count == 1, "reloads wait while the confirmation is open")
        f.shell.tapPopupButton(1)
        #expect(await eventually { f.server.requests.count == 2 }, "OK reloads")
        #expect(await eventually { f.shell.popups.count == 1 }, "and fails again: one confirmation")
        f.shell.tapPopupButton(0)
        #expect(f.shell.popups.isEmpty)
        #expect(!f.screens.session.retry)
    }

    @Test func theExpanderAndThePopups() async throws {
        let f = Fixture(Self.byPlace())
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil })
        f.screens.toggleExpanded()
        #expect(f.screens.scope?.expand == true)
        #expect(f.holder.state?.expandShortChart == true, "`expandShortChart` is stored")

        let catalog = Catalog(code: "ko")
        f.screens.perform(.pollen([PollenRow(labelKey: "LOC_POLLEN_PINE", gradeLabel: "높음", infoKey: "LOC_POLLEN_PINE_INFO",
                                             adviceKey: "LOC_POLLEN_ADVICE_2")]))
        let pollen = try #require(f.shell.popups.last)
        #expect(pollen.title == catalog("LOC_POLLEN_RISK"))
        #expect(pollen.lines == ["\(catalog("LOC_POLLEN_PINE")): 높음", catalog("LOC_POLLEN_PINE_INFO"), catalog("LOC_POLLEN_ADVICE_2"),
                                 catalog("LOC_POLLEN_SOURCE")])
        #expect(pollen.buttons.map(\.text) == [catalog("LOC_CLOSE")])
        f.shell.tapPopupButton(0)
        f.screens.perform(.airForecastInfo("airkorea"))
        #expect(f.shell.popups.last?.lines == [catalog("LOC_AIRKOREA_DESCRIPTION")])
        f.shell.tapPopupButton(0)
        f.screens.perform(.airForecastInfo("other"))
        #expect(f.shell.popups.isEmpty, "only kaq and airkorea have a description")
        f.screens.perform(.airInfo("aqi"))
        #expect(f.shell.selected == .air, "`goAirInfoPage` opens the Air tab")
    }

    /// V09: Seoul's slow answer arrives after the swipe to London; the page shows London's weather and Seoul keeps its own.
    @Test func aLateResponseStaysWithItsPlace() async throws {
        let f = Fixture(Self.byPlace(seoul: 1.2, london: 0.05))
        f.screens.handle(.launch)
        #expect(await eventually { f.server.requests.count == 1 })
        f.screens.session.next()
        #expect(f.holder.state?.placeIndex == 2)
        #expect(await eventually { f.screens.scope?.source?.stringValue == "VC" })
        #expect(await eventually { f.holder.state?.places[1].source == "KMA" }, "Seoul's answer is saved with Seoul")
        try await Task.sleep(for: .milliseconds(200))
        #expect(f.screens.content(.forecast)?.title == "런던")
        #expect(f.screens.scope?.currentWeather?["skyIcon"] == f.screens.session.record(f.holder.state!.places[2])["currentWeather"]?["skyIcon"])
        #expect(f.screens.pageContent?.page.arrows == true, "two enabled places: the arrows")
    }
}
