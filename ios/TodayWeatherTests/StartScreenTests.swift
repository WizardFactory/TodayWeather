import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// S01 in a window of the test host (IN-10, #2959 AC1), driven through its accessibility elements as VoiceOver
/// activates them: O01, a shortcut, a Places prediction, a bundled town, Cancel, 현재위치 날씨보기 in each location state
/// (granted, allowed once, denied, approximate only, restricted, location services off) and O09. The server, the
/// location and the Places search are doubles. Port of the Android `StartScreenTest` (AN-10).
extension HostedShellTests {
@MainActor
struct StartScreenTests {
    static let cityHall = Location(lat: 37.5662952, long: 126.9779451)

    func host(_ f: StartFixture) throws -> HostedView {
        try HostedView(StartView(page: f.page), size: CGSize(width: 393, height: 852))
    }

    func wait(_ seconds: Double = 10, _ condition: () -> Bool) async -> Bool {
        await HostedShellTests.AirLiveTests.wait(seconds, condition)
    }

    /// O01 closed, as every visit starts with it.
    func openPast(_ hosted: HostedView, _ f: StartFixture) async throws {
        try await hosted.settle()
        #expect(f.shell.popups.first?.title == "선택 접근 권한", "O01 on entry")
        #expect(f.shell.popups.first?.lines.count == 3)
        try hosted.tap("popup-button-0")
        try await hosted.settle()
        #expect(f.shell.popups.isEmpty)
    }

    @Test func theNoticeShortcutsAndTheCurrentLocationButtonShow() async throws {
        let f = try StartFixture(location: TestLocation(system: .notDetermined))
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        #expect(hosted.element("start-input") != nil)
        #expect(hosted.element("start-location") != nil)
        #expect(hosted.element("start-shortcut-16") != nil, "17 shortcuts at 852 pt")
        #expect(hosted.element("start-shortcut-17") == nil)
        #expect(f.paths.isEmpty, "the page asks for nothing")
        #expect(f.location.prompts == 0, "O01 asks for nothing")
    }

    @Test func aShortcutAddsItsPlaceAndClosesTheStartPage() async throws {
        let f = try StartFixture(location: TestLocation(system: .notDetermined))
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        try hosted.tap("start-shortcut-0")
        #expect(await wait { f.closed() == 1 })
        let s = try #require(f.holder.state)
        #expect(s.places.map(\.name) == [nil, "서울"])
        #expect(s.placeIndex == 1)
        #expect(s.cordovaExtras["startVersion"] == .number(1))
        #expect(f.paths == ["/weather/v000903/coord/37.567,126.978"])
        #expect(!f.page.loading)
    }

    @Test func grantedOrApproximateLocationAddsTheCurrentPosition() async throws {
        for fix in [Self.cityHall, Location(lat: 37.5813, long: 126.9637)] {
            let f = try StartFixture(location: TestLocation(system: .authorizedWhenInUse, fixes: [fix]))
            let hosted = try host(f)
            defer { hosted.close() }
            try await openPast(hosted, f)
            try hosted.tap("start-location")
            #expect(await wait { f.closed() == 1 })
            let current = try #require(f.holder.state?.places.first)
            #expect(current.currentPosition && !current.disable)
            #expect(current.name == "회현동", "named from the geocode")
            #expect(f.holder.state?.placeIndex == 0)
            #expect(f.paths.first?.hasPrefix("/geocode/v000903/coord/37.5") == true)
            #expect(f.location.prompts == 0)
        }
    }

    @Test func allowedOnceRunsAgainAfterThePrompt() async throws {
        let f = try StartFixture(location: TestLocation(system: .notDetermined, answer: .authorizedWhenInUse, fixes: [Self.cityHall]))
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        try hosted.tap("start-location")
        #expect(await wait { f.closed() == 1 })
        #expect(f.location.prompts == 1)
        #expect(f.holder.state?.places.first?.name == "회현동")
    }

    @Test func deniedRestrictedAndLocationServicesOffEndInTheRetryConfirmation() async throws {
        let denial = "위치 서비스에 대한 사용이 거부되었습니다."
        let hint = "[설정]>[앱]>[오늘날씨]에서 권한을 허용해주세요."
        let cases: [(String, TestLocation, [String])] = [
            ("denied at the prompt", TestLocation(system: .notDetermined, answer: .denied), [denial]),
            ("denied earlier", TestLocation(system: .denied), [denial, hint]),
            ("restricted", TestLocation(system: .restricted), [denial, hint]),
            ("location services off", TestLocation(services: false, system: .denied), [denial, hint]),
        ]
        for (name, location, lines) in cases {
            let f = try StartFixture(location: location)
            let hosted = try host(f)
            defer { hosted.close() }
            try await openPast(hosted, f)
            try hosted.tap("start-location")
            #expect(await wait { !f.shell.popups.isEmpty }, "\(name): no hang (#2871)")
            let popup = try #require(f.shell.popups.first)
            #expect(popup.title == "오류", "\(name)")
            #expect(popup.lines == lines, "\(name)")
            #expect(popup.buttons.map(\.text) == ["닫기", "설정", "확인"], "\(name)")
            #expect(popup.buttons.map(\.style) == [.standard, .positive, .positive], "\(name)")
            #expect(!f.page.loading, "\(name): the overlay is hidden")
            #expect(f.closed() == 0 && f.paths.isEmpty, "\(name)")
            // 확인 tries again; a denial now records denied_always: the hint and Settings.
            try await hosted.settle()
            try hosted.tap("popup-button-2")
            #expect(await wait { f.shell.popups.first?.lines == [denial, hint] }, "\(name): again")
            try hosted.tap("popup-button-0")
            try await hosted.settle()
            #expect(f.shell.popups.isEmpty, "\(name): 닫기 closes it; S01 stays")
            #expect(StartGate.shows(f.holder.state?.cordovaExtras["startVersion"]))
        }
    }

    @Test func aPredictionIsGeocodedAndAdded() async throws {
        let search = TestPlaceSearch(["Lon": [Prediction(fullText: "London, UK", firstMatch: 0),
                                              Prediction(fullText: "London, ON, Canada", firstMatch: 0)]])
        let f = try StartFixture(location: TestLocation(system: .denied), search: search)
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        f.page.change("Lon")
        #expect(await wait { hosted.element("start-result-1") != nil })
        #expect(hosted.element("start-location") == nil, "the results replace the shortcuts and the button")
        #expect(hosted.element("start-attribution") != nil, "powered by Google")
        #expect(search.words == ["Lon"])
        try hosted.tap("start-result-0")
        #expect(await wait { f.closed() == 1 })
        #expect(f.paths == ["/geocode/v000903/addr/London,%20UK", "/weather/v000903/coord/51.507,-0.128"])
        #expect(f.holder.state?.places.last?.name == "London")
        #expect(f.page.word.isEmpty && f.page.results == nil)
    }

    @Test func withoutAPlacesKeyTheBundledTownsAreSearched() async throws {
        let f = try StartFixture(location: TestLocation(system: .denied))
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        f.page.change("회현")
        #expect(await wait { hosted.element("start-result-0") != nil })
        guard case .towns(_, let page)? = f.page.results else { Issue.record("towns"); return }
        let index = try #require(page.towns.firstIndex { $0.second == "중구" && $0.third == "회현동" })
        try hosted.tap("start-result-\(index)")
        #expect(await wait { f.closed() == 1 })
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98"], "no geocode for a town")
        #expect(f.holder.state?.places.last?.address == "대한민국 서울특별시 중구 회현동")
    }

    @Test func cancelClearsTheWordAndBringsTheShortcutsBack() async throws {
        let f = try StartFixture(location: TestLocation(system: .denied))
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        f.page.change("서울")
        #expect(await wait { hosted.element("start-cancel") != nil })
        try hosted.tap("start-cancel")
        #expect(await wait { hosted.element("start-shortcut-0") != nil })
        #expect(f.page.word.isEmpty && f.page.results == nil)
        #expect(hosted.element("start-cancel") == nil)
    }

    /// At the largest text size (`xxxLarge`, #2948) in every catalog on the 375 pt iPhone SE: the shortcuts, the search
    /// row and the location button grow and stay inside the window's width (a long label is drawn smaller).
    @Test(arguments: ["ko-KR", "en-US", "de-DE", "ja-JP", "zh-CN", "zh-TW"])
    func thePageFitsTheLargestTextSize(language: String) async throws {
        let f = try StartFixture(location: TestLocation(system: .notDetermined), languages: [language])
        let hosted = try HostedView(StartView(page: f.page), size: CGSize(width: 375, height: 667), dynamicType: .xxxLarge)
        defer { hosted.close() }
        try await hosted.settle()
        f.shell.tapPopupButton(0)
        try await hosted.settle()
        let location = try #require(hosted.element("start-location"), "\(language) the location button")
        #expect(location.accessibilityFrame.minX >= 9.5 && location.accessibilityFrame.maxX <= 365.5, "\(language) \(location.accessibilityFrame)")
        #expect(location.accessibilityFrame.height > 47.5, "\(language) the button grows with the text")
        var index = 0
        while let shortcut = hosted.element("start-shortcut-\(index)") {
            let frame = shortcut.accessibilityFrame
            #expect(frame.minX >= 18.5 && frame.maxX <= 356.5, "\(language) shortcut \(index) \(frame)")
            index += 1
        }
        #expect(index >= 6, "\(language) \(index) shortcuts")
        let input = try #require(hosted.element("start-input"), "\(language) the input")
        #expect(input.accessibilityFrame.minX >= 9.5 && input.accessibilityFrame.maxX <= 365.5, "\(language) \(input.accessibilityFrame)")
    }

    @Test func aFailedWeatherRequestIsO09() async throws {
        let f = try StartFixture(location: TestLocation(system: .notDetermined), weather: false)
        let hosted = try host(f)
        defer { hosted.close() }
        try await openPast(hosted, f)
        try hosted.tap("start-shortcut-3")
        #expect(await wait { !f.shell.popups.isEmpty })
        let popup = try #require(f.shell.popups.first)
        #expect(popup.title == "오류")
        #expect(popup.lines == ["날씨 정보를 가져오지 못하였습니다."])
        #expect(popup.buttons.map(\.text) == ["확인"])
        #expect(popup.buttons.first?.style == .positive)
        #expect(f.closed() == 0)
        #expect(f.holder.state?.places == [.currentPositionPlaceholder])
    }
}

/// The weather pages' start choice O02 and O03's position variant in the live shell (IN-10): with no enabled place a
/// tap on a weather tab opens O02; its inverted rows decide; a denied prompt over the current position offers Search.
@MainActor
struct CurrentPositionShellTests {
    func live(_ location: TestLocation, places: [Place], index: Int) throws -> (ShellModel, WeatherScreens, CurrentPositionPopups) {
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(AppState(places: places, placeIndex: index, units: .defaults(region: "KR"),
                             settings: Settings(startupPage: "0", refreshInterval: "0", theme: "light"),
                             cordovaExtras: JSONObject([("startVersion", 1)])))
        let shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: ["ko-KR"]), version: "test")
        let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: try StartServer.server())
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" }, location: location)
        let screens = WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852))
        return (shell, screens, CurrentPositionPopups(session: session, shell: shell, openURL: { _ in }))
    }

    @Test func noEnabledPlaceAsksHowToStart() async throws {
        let location = TestLocation(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)])
        let (shell, screens, popups) = try live(location, places: [.currentPositionPlaceholder], index: -1)
        _ = popups
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        try await hosted.settle()
        // The Hourly page's visit found no enabled place: O02.
        #expect(await HostedShellTests.AirLiveTests.wait(5) { hosted.element("start-choice") != nil })
        // The inverted rows (A07): location services on checks 지역 검색으로 시작 (true), which uses the current position.
        #expect(screens.session.autoSearch)
        try hosted.tap("start-choice-false")
        try await hosted.settle()
        #expect(!screens.session.autoSearch)
        try hosted.tap("start-choice-ok")
        try await hosted.settle()
        #expect(shell.selected == .search, "false opens the Locations tab")
        #expect(shell.holder.state?.places.first?.disable == true)
        // A tap on a weather tab asks again.
        try hosted.tap("shell-tab-dailyforecast")
        #expect(await HostedShellTests.AirLiveTests.wait(5) { hosted.element("start-choice") != nil })
        #expect(shell.selected == .search, "the tap was taken")
        try hosted.tap("start-choice-true")
        try hosted.tap("start-choice-ok")
        try await hosted.settle()
        #expect(shell.selected == .forecast)
        #expect(shell.holder.state?.places.first?.disable == false, "the current position is enabled")
        #expect(await HostedShellTests.AirLiveTests.wait(10) { location.positions == 1 }, "and looked up")
    }

    @Test func aDeniedPromptOffersSearch() async throws {
        let current = Place(currentPosition: true, disable: false, name: "회현동", address: "서울특별시 중구 회현동", country: "KR",
                            location: Location(lat: 37.56, long: 126.98))
        let location = TestLocation(system: .notDetermined, answer: .denied)
        let other = Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시", country: "KR",
                          location: Location(lat: 37.567, long: 126.978))
        let (shell, screens, popups) = try live(location, places: [current, other], index: 0)
        _ = popups
        let hosted = try HostedView(ShellView(model: shell, content: { screens.content($0) }), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        screens.handle(.launch)
        #expect(await HostedShellTests.AirLiveTests.wait(10) { shell.popups.first?.title == "오류" })
        let popup = try #require(shell.popups.first)
        #expect(popup.lines == ["권한 요청이 거부되었습니다. 지역검색으로 이동하거나, 재시도해주세요."])
        #expect(popup.buttons.map(\.text) == ["검색", "확인"])
        try await hosted.settle()
        try hosted.tap("popup-button-0")
        try await hosted.settle()
        #expect(shell.selected == .search)
        #expect(shell.holder.state?.places.first?.disable == true)
        #expect(shell.holder.state?.placeIndex == 1)
        #expect(shell.popups.isEmpty)
    }
}
}
