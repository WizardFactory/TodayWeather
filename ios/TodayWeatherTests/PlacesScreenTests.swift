import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// S02 in the live shell over doubles (IN-11, #2960): the server double answers the weather and geocode requests, the
/// location double the position, the Places double the predictions, and the alarms' removal is recorded.
@MainActor
struct PlacesFixture {
    static let seoul = Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시", country: "KR",
                             location: Location(lat: 37.567, long: 126.978))
    static let busan = Place(currentPosition: false, disable: false, name: "부산광역시", address: "대한민국 부산광역시", country: "KR",
                             location: Location(lat: 35.18, long: 129.08))
    static let london = Place(currentPosition: false, disable: false, name: "London", address: "London, UK", country: "GB",
                              location: Location(lat: 51.51, long: -0.13))

    static func alarm(_ index: Int) -> JSONObject {
        JSONObject([("cityIndex", .number(index)), ("id", 1), ("time", "2026-11-07T22:40:00.000Z"),
                    ("dayOfWeek", [false, true, true, true, true, true, false]), ("enable", true), ("category", "alarm")])
    }

    /// The legacy server: the captured responses (kma-seoul, vc-london for London) and the geocode answers.
    static func server() throws -> WeatherTabTests.Server {
        let seoul = try References.data("places-kma-seoul.input.json")
        let london = try References.data("places-vc-london.input.json")
        let geocode = try References.data("places-geocode-seoul.input.json")
        return WeatherTabTests.Server { url in
            let path = url.path
            if path.hasPrefix("/geocode/v000903/coord/") { return .answer(0, geocode) }
            if path.hasPrefix("/geocode/v000903/addr/") { return .answer(0, Data(StartServer.geocodeLondon.utf8)) }
            return .answer(0, path.contains("/51.5") ? london : seoul)
        }
    }

    final class Removed { var indices: [Int] = [] }

    let holder: AppStateHolder
    let shell: ShellModel
    let server: WeatherTabTests.Server
    let location: TestLocation
    let session: WeatherSession
    let weather: WeatherScreens
    let places: PlacesScreens
    let removed = Removed()

    init(places list: [Place], selected: Int = 1, records: [JSONObject] = [], startupPage: String = "0",
         location: TestLocation = TestLocation(system: .authorizedWhenInUse), search: (any PlaceSearch)? = nil,
         languages: [String] = ["ko-KR"], started: Bool = true) throws {
        holder = AppStateHolder(store: MemoryStore())
        holder.load(AppState(places: list, placeIndex: selected, units: .defaults(region: "KR"),
                             settings: Settings(startupPage: startupPage, refreshInterval: "0", theme: "light"),
                             push: PushState(type: "ios", fcmToken: "token-a", records: records),
                             cordovaExtras: started ? JSONObject([("startVersion", 1)]) : JSONObject()))
        shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: languages), version: "test")
        server = try Self.server()
        self.location = location
        let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: server)
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" }, location: location)
        self.session = session
        weather = WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852))
        let holder = self.holder, removed = self.removed
        let geocode = GeocodeClient(baseURL: "https://server.test.invalid", http: server)
        places = PlacesScreens(shell: shell, session: session, makePage: {
            PlacesPage(holder: holder, repository: repository, session: session, geocode: geocode, location: location,
                       acceptLanguage: { "ko-KR,ko;q=0.9" }, removeAlarms: { removed.indices.append($0) })
        }, search: search, towns: BundledTownLoader(), openURL: { _ in })
        places.query.predictionDelay = .milliseconds(10)
    }

    var paths: [String] { server.requests.map { $0.0.path(percentEncoded: true) } }
    var state: AppState { holder.state! }

    /// The shell in a window on the Locations tab, with its visit's loads finished.
    func hosted() async throws -> HostedView {
        shell.select(.search)
        let weather = self.weather, places = self.places
        let view = try HostedView(ShellView(model: shell, content: { tab in
            tab == .search ? places.content(tab) : weather.content(tab)
        }), size: CGSize(width: 393, height: 852))
        #expect(await HostedShellTests.AirLiveTests.wait(5) { places.visits == 1 })
        await places.page.visit?.value
        await places.page.lookup?.value
        try await view.settle()
        return view
    }

    func settle() async {
        await places.page.action?.value
        await places.page.visit?.value
    }
}

extension HostedShellTests {
@MainActor
struct PlacesScreenTests {
    @Test func cancelStaysOnScreenWithALongQuery() async throws {
        let query = String(repeating: "서울특별시", count: 12)
        let search = TestPlaceSearch([query: [Prediction(fullText: query + " 중구", firstMatch: 0)]])
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], search: search)
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged(query)
        try #require(await HostedShellTests.AirLiveTests.wait(5) { app.element("places-prediction-0") != nil })
        try await app.settle()
        let cancel = try #require(app.element("places-mode")).accessibilityFrame
        #expect(!cancel.isEmpty && app.window.frame.contains(cancel))
        try app.tap("places-mode")
        #expect(!f.places.searching && f.places.query.word.isEmpty)
        #expect(f.state.places.count == 2)
    }

    /// Exercise all four tab entry points with a populated Seoul forecast and a reserved status bar.
    @Test func mainTabContentClearsTheBar() async throws {
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
        let size = CGSize(width: 402, height: 874)
        let insets = ShellInsets(statusBar: 54, top: 8, bottom: 34, leading: 0, trailing: 0)
        let view = ShellFrame(model: f.shell, insets: insets, content: { tab in
            tab == .search ? f.places.content(tab) : f.weather.content(tab)
        })
        let hosted = try HostedView(view.ignoresSafeArea(), size: size)
        defer { hosted.close() }
        for tab in [ShellTab.search, .forecast, .dailyforecast, .air] {
            try hosted.tap("shell-tab-\(tab.rawValue)")
            let target = tab == .search ? "places-name-1" : tab == .air ? "air-header" : "forecast-header"
            try #require(await HostedShellTests.AirLiveTests.wait(5) { f.shell.selected == tab && hosted.element(target) != nil })
            await f.settle()
            try await hosted.settle()
            let frame = try #require(hosted.element(target)).accessibilityFrame
            if tab == .search {
                #expect(frame.minY >= insets.statusBar + insets.top + ShellMetrics.headerHeight)
            } else {
                #expect(abs(frame.maxY - size.height * 5 / 12) < 1, "\(tab) header ends at \(frame.maxY)")
            }
            let image = UIGraphicsImageRenderer(size: size).image { _ in
                hosted.window.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
            }
            Attachment.record(try #require(image.pngData()), named: "main-tab-\(tab.rawValue).png")
        }
    }

    @Test func savedPlacesHeaderFollowsLargerStandardText() async throws {
        func sizes(at type: DynamicTypeSize) async throws -> (inputHeight: CGFloat, buttonWidth: CGFloat) {
            let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
            f.shell.select(.search)
            let view = ShellView(model: f.shell, content: { f.places.content($0) })
            let hosted = try HostedView(view, size: CGSize(width: 402, height: 874), dynamicType: type)
            defer { hosted.close() }
            try await hosted.settle()
            let input = try #require(hosted.element("places-input"))
            let mode = try #require(hosted.element("places-mode"))
            return (input.accessibilityFrame.height, mode.accessibilityFrame.width)
        }
        let standard = try await sizes(at: .large)
        let larger = try await sizes(at: .xxxLarge)
        #expect(larger.inputHeight > standard.inputHeight)
        #expect(larger.buttonWidth > standard.buttonWidth)
    }

    @Test func accessibilityTextGrowsAndTheHourlyChartRemainsReachable() async throws {
        func sizes(at type: DynamicTypeSize) async throws -> (summary: CGFloat, tab: CGFloat) {
            let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
            let size = CGSize(width: 402, height: 874)
            let insets = ShellInsets(statusBar: 54, top: 8, bottom: 34, leading: 0, trailing: 0)
            let view = ShellFrame(model: f.shell, insets: insets, content: { f.weather.content($0) })
            let hosted = try HostedView(view.ignoresSafeArea(), size: size, dynamicType: type)
            defer { hosted.close() }
            try #require(await HostedShellTests.AirLiveTests.wait(5) { hosted.element("forecast-summary-air") != nil })
            try await hosted.settle()
            let summary = try #require(hosted.element("forecast-summary-air")).accessibilityFrame
            let tab = try #require(hosted.element("shell-tab-forecast")).accessibilityFrame
            let barBottom = insets.statusBar + insets.top + ShellMetrics.headerHeight
            #expect(summary.minY >= barBottom)
            if type.isAccessibilitySize {
                let chart = try #require(hosted.element("forecast-chart")).accessibilityFrame
                let scroll = try #require(hosted.elements().compactMap { $0 as? UIScrollView }
                    .first { $0.contentSize.height > $0.bounds.height + 1 && $0.bounds.height > 0 })
                scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: scroll.contentOffset.y + chart.minY - barBottom), animated: false)
                try await hosted.settle()
                let visibleChart = try #require(hosted.element("forecast-chart")).accessibilityFrame
                #expect(visibleChart.minY < chart.minY)
                #expect(visibleChart.minY < tab.minY && visibleChart.maxY > barBottom)
            }
            return (summary.height, tab.height)
        }
        let standard = try await sizes(at: .large)
        let accessible = try await sizes(at: .accessibility3)
        #expect(accessible.summary > standard.summary)
        #expect(accessible.tab > standard.tab)
    }

    /// #2960: each place with its temperature, range and bell; a row tap selects it and opens the startup page.
    @Test func theListShowsThePlacesAndARowOpensTheStartupPage() async throws {
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london], records: [PlacesFixture.alarm(2)],
                                  startupPage: "1")
        let app = try await f.hosted()
        defer { app.close() }
        #expect(f.places.rows.map(\.lines) == [["현재위치"], ["서울"], ["London"]])
        #expect(f.places.rows.map(\.temperature) == [nil, "3˚", "10˚"])
        #expect(f.places.rows.map(\.minMax) == [nil, "2˚/8˚", "5˚/10˚"])
        #expect(app.element("places-row-0") == nil, "the disabled current position shows only in edit mode")
        #expect(app.element("places-bell-1")?.accessibilityLabel == "alarm off")
        #expect(app.element("places-bell-2")?.accessibilityLabel == "alarm on")
        try app.tap("places-name-2")
        try await app.settle()
        #expect(f.shell.selected == .dailyforecast, "the startup page 1 (Daily)")
        #expect(f.state.placeIndex == 2)
        // A new visit reads the list again.
        f.shell.select(.search)
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.visits == 2 })
    }

    /// The bell hands its row's index to S09 (IN-14's hook).
    @Test func theBellOpensThePlacesAlarms() async throws {
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
        var opened: [Int] = []
        f.places.onBell = { opened.append($0) }
        let app = try await f.hosted()
        defer { app.close() }
        try app.tap("places-bell-1")
        #expect(opened == [1])
    }

    /// Edit mode: ⊗ deletes at once (a bell first removes the alarms), the switch turns the current position on and
    /// finds it; 확인 ends the mode.
    @Test func editModeDeletesAndSwitches() async throws {
        let location = TestLocation(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)])
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.busan, PlacesFixture.london],
                                  selected: 3, records: [PlacesFixture.alarm(3)], location: location)
        let app = try await f.hosted()
        defer { app.close() }
        try app.tap("places-mode")
        try await app.settle()
        #expect(f.places.editing)
        #expect(app.element("places-row-0") != nil && app.element("places-toggle") != nil)
        #expect(app.element("places-bell-1") == nil && app.element("places-delete-1") != nil)
        try app.tap("places-delete-3")
        try await app.settle()
        #expect(f.removed.indices == [3], "London's alarms")
        #expect(f.state.places.map(\.name) == [nil, "서울", "부산광역시"])
        #expect(f.state.placeIndex == 1, "the last place was selected: the first enabled one")
        try app.tap("places-delete-1")
        #expect(f.removed.indices == [3], "no bell: nothing removed")
        try app.tap("places-toggle")
        await f.settle()
        try await app.settle()
        #expect(f.state.places[0].disable == false && f.state.places[0].name == "회현동", "found and named from the geocode")
        #expect(f.paths.contains { $0.hasPrefix("/geocode/v000903/coord/37.56,126.98") })
        try app.tap("places-mode")
        #expect(!f.places.editing)
    }

    /// Search mode: the bundled towns for 부산; a town is added, selected and opened on the startup page.
    @Test func aTownIsSearchedAndAdded() async throws {
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged("부산")
        f.places.focusChanged(false)
        try #require(await HostedShellTests.AirLiveTests.wait(5) { app.element("places-town-0") != nil })
        #expect(f.places.searching)
        #expect(app.element("places-find") != nil && app.element("places-town-9") != nil && app.element("places-town-divider") != nil)
        #expect(app.element("places-google-divider") == nil, "no Places key: no predictions")
        try app.tap("places-town-0")
        await f.settle()
        try await app.settle()
        #expect(f.state.places.last?.name == "부산광역시" && f.state.placeIndex == 2)
        #expect(f.shell.selected == .forecast)
        #expect(!f.places.searching && f.places.query.word.isEmpty)
        // The mode button: 취소 leaves search mode and clears the word.
        f.shell.select(.search)
        try await app.settle()
        f.places.focusChanged(true)
        f.places.wordChanged("서울")
        try app.tap("places-mode")
        #expect(!f.places.searching && f.places.query.word.isEmpty && f.places.query.townResults == nil)
    }

    /// While the keyboard shows, a tap on a result only closes it (`cordova.plugins.Keyboard.close()`).
    @Test func aTapWithTheKeyboardUpOnlyClosesIt() async throws {
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged("부산")
        try #require(await HostedShellTests.AirLiveTests.wait(5) { app.element("places-town-0") != nil })
        let requests = f.focusRequests
        try app.tap("places-town-0")
        await f.settle()
        #expect(f.state.places.count == 2 && f.places.focusRequest == requests + 1)
    }

    /// With the Places key the predictions follow the towns under Google's logo; one is geocoded by its terms.
    @Test func aPredictionIsAdded() async throws {
        let search = TestPlaceSearch(["London": [Prediction(fullText: "London, UK", firstMatch: 0)]])
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], search: search)
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged("London")
        f.places.focusChanged(false)
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.query.predictions != nil })
        try await app.settle()
        #expect(app.element("places-google-divider") != nil)
        try app.tap("places-prediction-0")
        await f.settle()
        #expect(f.paths.contains("/geocode/v000903/addr/London,UK"))
        #expect(f.state.places.last?.name == "London")
    }

    /// 현재위치로 지역찾기: the found position replaces the results and is added as a place.
    @Test func findByLocationAddsTheFoundPlace() async throws {
        let location = TestLocation(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)])
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], location: location)
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged("부산")
        f.places.focusChanged(false)
        try #require(await HostedShellTests.AirLiveTests.wait(5) { app.element("places-town-0") != nil })
        try app.tap("places-find")
        await f.settle()
        try await app.settle()
        #expect(app.element("places-found") != nil && app.element("places-town-0") == nil)
        #expect(f.places.query.word == "회현동")
        try app.tap("places-found")
        await f.settle()
        #expect(f.state.places.last?.address == "서울특별시 중구 회현동")
        #expect(f.shell.selected == .forecast)
    }

    /// A found position replaces the results also when the word already is its name (CODEX-IN11-1: Cordova's
    /// `OnSearchCurrentPosition` and the Android `PlacesTab` clear them on every found position).
    @Test func aFoundPositionNamedAsTheWordReplacesTheResults() async throws {
        let location = TestLocation(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)])
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], location: location)
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.wordChanged("회현동")
        f.places.focusChanged(false)
        try #require(await HostedShellTests.AirLiveTests.wait(5) { app.element("places-town-0") != nil },
                     "the bundled towns named 회현동 are listed")
        try app.tap("places-find")
        await f.settle()
        try await app.settle()
        #expect(f.places.query.word == "회현동")
        #expect(f.places.query.townResults == nil && f.places.query.predictions == nil, "the found row replaces the results")
        #expect(app.element("places-found") != nil && app.element("places-town-0") == nil)
    }

    /// O03 `search` with the captured texts; OK finds by location again (A26).
    @Test func aDeniedFindShowsTheSearchConfirmation() async throws {
        let location = TestLocation(system: .denied)
        let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], location: location)
        let app = try await f.hosted()
        defer { app.close() }
        f.places.focusChanged(true)
        f.places.focusChanged(false)
        try await app.settle()
        try app.tap("places-find")
        await f.settle()
        let popup = try #require(f.shell.popups.first)
        #expect(popup.title == "오류")
        #expect(popup.lines == [Catalog(code: "ko")("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED")])
        #expect(popup.buttons.map(\.text) == ["닫기", "설정", "확인"])
        f.shell.tapPopupButton(2)
        await f.settle()
        #expect(f.location.positions == 0 && f.shell.popups.count == 1, "the find ran again and failed again")
    }
}
}

extension PlacesFixture {
    var focusRequests: Int { places.focusRequest }
}
