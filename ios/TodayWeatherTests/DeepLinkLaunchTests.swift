import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// `link.todayweather.ai` Universal Links and the header search with unsaved places in the app (#3097 on the #3180
/// scenario, specs/deeplink.md §6.2): through `AppLaunch` as a link arrives (cold and warm), the tabs, pages, S01 bypass,
/// the star and S02's search from the weather header. The server is absent (no requests), as in the widget link tests.
@MainActor
struct DeepLinkLaunchTests {
    static func launch(_ state: AppState = ShellFixture.state(), cold links: [String] = []) throws -> AppLaunch {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "test"),
                               weatherCache: nil, placeSearch: { nil })
        for link in links { launch.entries.submit(.link(try #require(URL(string: link)))) }
        launch.migrationFinished(state)
        return launch
    }

    static func open(_ launch: AppLaunch, _ link: String) throws {
        launch.entries.submit(.link(try #require(URL(string: link))))
    }

    /// A cold start: the link waits for the migration, then opens its tab on the place shown unsaved; nothing is saved.
    @Test func aColdPlaceLinkOpensItsTabUnsaved() throws {
        let launch = try Self.launch(cold: ["https://link.todayweather.ai/place/busan?view=daily"])
        #expect(launch.shell?.selected == .dailyforecast)
        let shown = try #require(launch.unsaved?.unsaved)
        #expect(shown.place.name == "부산" && shown.selected)
        #expect(launch.holder.state == ShellFixture.state(), "nothing saved")
        let state = try #require(launch.weather?.session.state)
        #expect(state.places.count == 3 && state.placeIndex == 2)
        #expect(launch.weather?.isUnsaved(state) == true, "the header shows the star")
    }

    /// A warm link to coordinates within 0.01° of a saved place selects it; the unsaved place opened before stays.
    @Test func aLinkNearASavedPlaceSelectsIt() throws {
        let launch = try Self.launch()
        try Self.open(launch, "https://link.todayweather.ai/place/busan")
        try Self.open(launch, "https://link.todayweather.ai/loc?lat=37.565&lon=126.985&view=daily")
        #expect(launch.shell?.selected == .dailyforecast)
        #expect(launch.holder.state?.placeIndex == 1)
        #expect(launch.unsaved?.unsaved?.place.name == "부산")
        #expect(launch.unsaved?.unsaved?.selected == false)
        let state = try #require(launch.weather?.session.state)
        #expect(launch.weather?.isUnsaved(state) == false, "the bell")
    }

    /// Air opens on the link's pollutant; pages open over the tabs; what covered the tabs closes first.
    @Test func airPollutantsPagesAndOverlays() throws {
        let launch = try Self.launch()
        try Self.open(launch, "https://link.todayweather.ai/air/busan?pollutant=pm25")
        #expect(launch.shell?.selected == .air)
        #expect(launch.weather?.airLink == "pm25")
        launch.shell?.openMenu()
        try Self.open(launch, "https://link.todayweather.ai/nation/air")
        #expect(launch.shell?.menuOpen == false)
        #expect(launch.nation?.page == .nationAir)
        try Self.open(launch, "https://link.todayweather.ai/warnings")
        #expect(launch.nation?.page == .warnings)
        try Self.open(launch, "https://link.todayweather.ai/open")
        #expect(launch.nation?.page == nil, "/open closes the page and keeps the tab")
        #expect(launch.shell?.selected == .air)
    }

    /// Other hosts, unknown cities and invalid coordinates change nothing.
    @Test func linksThatOpenNothing() throws {
        let launch = try Self.launch()
        launch.shell?.select(.dailyforecast)
        for link in ["https://app.todayweather.ai/weather/busan/daily", "https://todayweather.ai/mobile/privacy.html",
                     "https://link.todayweather.ai/place/atlantis", "https://link.todayweather.ai/loc?lat=91&lon=0"] {
            try Self.open(launch, link)
        }
        #expect(launch.shell?.selected == .dailyforecast)
        #expect(launch.unsaved?.unsaved == nil)
        #expect(launch.holder.state == ShellFixture.state())
    }

    /// Over S01 a place link shows the tabs on the unsaved place without closing S01; pages wait. The star saves it as the
    /// first place and closes S01; without it, S01 shows at the next start.
    @Test func aPlaceLinkOverTheStartPageAndItsStar() throws {
        var start = ShellFixture.state(startVersion: nil)
        start.places = [.currentPositionPlaceholder]
        start.placeIndex = -1
        let launch = try Self.launch(start)
        #expect(launch.shell?.screen == .start)
        try Self.open(launch, "https://link.todayweather.ai/nation/weather")
        #expect(launch.shell?.screen == .start && launch.nation?.page == nil)
        try Self.open(launch, "https://link.todayweather.ai/place/jeju")
        #expect(launch.shell?.screen == .tab(.forecast))
        #expect(StartGate.shows(launch.holder.state?.cordovaExtras["startVersion"]), "S01 is not closed")
        #expect(StartScreen.first(startVersion: launch.holder.state?.cordovaExtras["startVersion"], startupPage: "0") == .start,
                "a new start shows S01")
        launch.weather?.onStar()
        #expect(launch.holder.state?.places.map(\.name) == [nil, "제주"])
        #expect(launch.holder.state?.placeIndex == 1)
        #expect(!StartGate.shows(launch.holder.state?.cordovaExtras["startVersion"]), "the star closed S01")
        #expect(launch.shell?.notice == "즐겨찾기에 추가했습니다")
    }

    /// The star saves the unsaved place at once as the last saved place, with the short notice; the bell returns.
    @Test func theStarSavesWithANotice() throws {
        let launch = try Self.launch()
        try Self.open(launch, "https://link.todayweather.ai/place/busan")
        launch.weather?.onStar()
        #expect(launch.holder.state?.places.map(\.name) == [nil, "회현동", "부산"])
        #expect(launch.holder.state?.placeIndex == 2)
        #expect(launch.unsaved?.unsaved == nil)
        #expect(launch.shell?.notice == "즐겨찾기에 추가했습니다")
        let state = try #require(launch.weather?.session.state)
        #expect(launch.weather?.isUnsaved(state) == false)
    }

    /// The header's search button opens S02 searching from its tab; 취소 returns there. A chosen town opens on that tab
    /// unsaved, and the next result replaces it.
    @Test func theHeaderSearchOpensS02AndReturnsToItsTab() async throws {
        let launch = try Self.launch()
        let places = try #require(launch.places)
        launch.shell?.select(.dailyforecast)
        launch.weather?.onSearch(.dailyforecast)
        #expect(launch.shell?.selected == .search)
        #expect(places.searching && places.searchFrom == .dailyforecast)
        #expect(places.takeFocusRequest(), "the input takes the focus")
        places.modeTapped()
        #expect(launch.shell?.selected == .dailyforecast, "취소 returns")
        launch.weather?.onSearch(.dailyforecast)
        places.addTown(BundledTown(first: "부산광역시", second: "", third: "", lat: 35.18, long: 129.08))
        await places.page.action?.value
        #expect(launch.shell?.selected == .dailyforecast)
        #expect(launch.unsaved?.unsaved?.place.name == "부산광역시")
        #expect(launch.holder.state?.places.count == 2, "nothing saved")
        launch.weather?.onSearch(.dailyforecast)
        places.addTown(BundledTown(first: "대구광역시", second: "", third: "", lat: 35.87, long: 128.6))
        await places.page.action?.value
        #expect(launch.unsaved?.unsaved?.place.name == "대구광역시", "one unsaved place: the new one replaces it")
    }

    /// Only a web-browsing activity's page URL is a Universal Link; Handoff and others open nothing.
    @Test func onlyBrowsingWebActivitiesAreLinks() throws {
        let web = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
        web.webpageURL = URL(string: "https://link.todayweather.ai/place/seoul")
        let other = NSUserActivity(activityType: "net.wizardfactory.todayweather.handoff")
        other.webpageURL = URL(string: "https://link.todayweather.ai/place/busan")
        #expect(SceneDelegate.webLinks([web, other]) == [URL(string: "https://link.todayweather.ai/place/seoul")!])
    }

    /// A widget link keeps working and counts saved places only (CODEX-3190-3 on iOS).
    @Test func aWidgetLinkStillSelectsItsSavedPlace() throws {
        let launch = try Self.launch()
        try Self.open(launch, "https://link.todayweather.ai/place/busan")
        let place = try #require(launch.holder.state?.places[1])
        try Self.open(launch, "todayweather://widget?place=" + WidgetSharing.id(place))
        #expect(launch.holder.state?.placeIndex == 1)
        #expect(launch.unsaved?.unsaved?.selected == false)
        #expect(launch.shell?.selected == .forecast)
    }

    /// CODEX-3195-3: a place link while the weather's retry confirmation (O03) is open closes it and loads the linked
    /// place; the confirmation would otherwise stop every reload.
    @Test func aPlaceLinkClosesTheRetryConfirmationAndLoads() async throws {
        let server = WeatherTabTests.Server { _ in .fail(0, 503) }
        let launch = AppLaunch(store: MemoryStore(),
                               environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "test",
                                                  serverURL: "https://server.test.invalid"),
                               weatherHTTP: server, weatherCache: nil,
                               location: { TestLocation(system: .authorizedWhenInUse) }, placeSearch: { nil })
        launch.migrationFinished(ShellFixture.state())
        let session = try #require(launch.weather?.session)
        #expect(await HostedShellTests.AirLiveTests.wait(10) { session.retry })
        let before = server.requests.count
        try Self.open(launch, "https://link.todayweather.ai/place/busan")
        #expect(!session.retry, "the confirmation closed")
        #expect(await HostedShellTests.AirLiveTests.wait(10) { server.requests.count > before }, "the linked place loads")
        #expect(server.requests.last.map { $0.0.absoluteString.contains("/coord/35.179,129.076") } == true)
    }

    /// CODEX-3195-5: an S01 add still loading when a place link shows the tabs over S01 finishes S01's close: the added
    /// place is saved and selected, S01 is closed, and the unsaved place gives way (CODEX-3190-19).
    @Test func anS01AddFinishingAfterAPlaceLinkClosesS01() async throws {
        let body = try References.data("places-kma-seoul.input.json")
        let server = WeatherTabTests.Server { _ in .answer(0.5, body) }
        let launch = AppLaunch(store: MemoryStore(),
                               environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "test",
                                                  serverURL: "https://server.test.invalid"),
                               weatherHTTP: server, weatherCache: nil,
                               location: { TestLocation(system: .authorizedWhenInUse) }, placeSearch: { nil })
        var start = ShellFixture.state(startVersion: nil)
        start.places = [.currentPositionPlaceholder]
        start.placeIndex = -1
        launch.migrationFinished(start)
        let page = try #require(launch.startPage)
        page.addShortcut(CityShortcuts.forScreenHeight(800).first!)
        try Self.open(launch, "https://link.todayweather.ai/place/jeju")
        #expect(launch.shell?.screen == .tab(.forecast) && launch.unsaved?.unsaved?.selected == true)
        #expect(await HostedShellTests.AirLiveTests.wait(10) { launch.startPage == nil }, "S01 closed itself")
        #expect(!StartGate.shows(launch.holder.state?.cordovaExtras["startVersion"]))
        #expect(launch.holder.state?.places.last?.name == "서울")
        #expect(launch.unsaved?.unsaved?.selected == false, "the added place is the selected one")
    }
}

extension HostedShellTests {
    /// The weather header in a narrow window (#3180, #3097).
    @MainActor
    struct HeaderFitTests {
        /// CODEX-3195-6: in a 320 pt window with larger text and a long name, the header keeps every control whole, inside the
        /// window and apart: menu, the name, the search button (44 × 44 pt), the star and share.
        @Test func theHeaderFitsANarrowWindowWithALongName() async throws {
            let long = Place(currentPosition: false, disable: false, name: "경기도 성남시 분당구 정자일로 분당내곡로 아주 긴 이름",
                             address: "대한민국 경기도 성남시 분당구", country: "KR", location: Location(lat: 37.383, long: 127.119))
            let f = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul])
            f.unsaved.show(long)
            f.shell.select(.forecast)
            let size = CGSize(width: 320, height: 568)
            let view = ShellView(model: f.shell, content: { f.weather.content($0) }).environment(\.dynamicTypeSize, .xLarge)
            let hosted = try HostedView(view, size: size)
            defer { hosted.close() }
            f.weather.handle(.launch)
            try #require(await HostedShellTests.AirLiveTests.wait(10) { hosted.element("forecast-star") != nil })
            try await hosted.settle()
            func frame(_ id: String) throws -> CGRect { try #require(hosted.element(id)).accessibilityFrame }
            let menu = try frame("shell-menu-button"), title = try frame("shell-title"), search = try frame("forecast-search")
            let star = try frame("forecast-star"), share = try frame("forecast-share")
            let window = hosted.window.frame
            for (name, rect) in [("menu", menu), ("search", search), ("star", star), ("share", share)] {
                #expect(window.contains(rect), "\(name) inside the window: \(rect)")
            }
            #expect(menu.maxX <= title.minX && title.maxX <= search.minX + 1, "menu, the name, then search: \(menu) \(title) \(search)")
            #expect(search.maxX <= star.minX + 1 && star.maxX <= share.minX + 1, "search, star, share: \(search) \(star) \(share)")
            #expect(search.width >= 44 && search.height >= 44, "touch size: \(search)")
        }
    }
}
