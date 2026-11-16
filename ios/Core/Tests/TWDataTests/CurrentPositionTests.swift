import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// The weather pages' current position (IN-10, #2959): TabCtrl's iOS `updateCurrentPosition` beside each load of slot 0
/// in every location state, O03's position variants, `locationOn`, and the start choice O02 with no enabled place. Port
/// of the Android `CurrentPositionTest` (AN-10) with the iOS branches.
extension ClockedDataTests {
@MainActor
struct CurrentPositionTests {
    static let saved = Place(currentPosition: true, disable: false, name: "회현동", address: "서울특별시 중구 회현동", country: "KR",
                             location: Location(lat: 37.56, long: 126.98))

    @MainActor
    struct Fixture {
        let clock = VirtualClock()
        let http: ScriptedWeatherHTTP
        let holder = AppStateHolder(store: MemoryStore())
        let location: LocationDouble
        let events = EventLog()
        let session: WeatherSession

        init(_ location: LocationDouble, current: Place = CurrentPositionTests.saved, selected: Int = 0,
             byURL: @escaping (URL) -> ScriptedWeatherHTTP.Behavior? = { _ in nil }) throws {
            let seoulBody = try WeatherFixtures.body("kma-seoul")
            http = ScriptedWeatherHTTP(clock: clock) { url in byURL(url) ?? .answer(100, seoulBody) }
            holder.load(AppState(places: [current, seoul], placeIndex: selected, units: koreanUnits,
                                 cordovaExtras: JSONObject([("startVersion", 1)])))
            self.location = location
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: http, clock: clock)
            session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" },
                                     clock: clock, random: { 0 }, telemetry: events.telemetry, location: location)
        }

        var paths: [String] { http.attempts.map { $0.url.path(percentEncoded: true) } }
        var state: AppState { holder.state! }
    }

    @Test func aNewPositionReplacesTheSavedOneAndLoadsAgain() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5013, long: 127.0396)]))
        f.location.holdPositions = true
        f.session.reload(.initial)
        #expect(f.session.locating)
        #expect(f.session.loadingSelected, "the title's spinner turns while the lookup runs")
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.session.applies == 2 }, "the saved position's weather applied")
        #expect(f.session.loadingSelected, "the spinner turns until the position settles")
        f.location.releasePositions()
        #expect(await eventually { f.state.places[0].location == Location(lat: 37.501, long: 127.04) }, "the new location is saved")
        #expect(!f.session.locating)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.paths.count == 2 })
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98", "/weather/v000903/coord/37.501,127.04"])
        #expect(await eventually { f.session.applies == 3 }, "applyEvent 'updateCurrentPosition'")
        #expect(f.session.positionRetry == nil)
        #expect(f.events.outcomes("location_permission", "outcome") == ["granted"])
    }

    @Test func theSamePositionLoadsNothingMore() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)]))
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { !f.session.locating })
        await f.clock.advance(by: 1000)
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98"])
    }

    @Test func aNewPositionLoadsOnlyWhileTheCurrentPositionIsSelected() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Location(lat: 35.1796, long: 129.0756)]))
        f.location.holdPositions = true
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.session.applies == 2 })
        // The user swipes to the next place before the position arrives.
        f.holder.change { $0.placeIndex = 1 }
        f.location.releasePositions()
        #expect(await eventually { !f.session.locating })
        await f.clock.advance(by: 1000)
        #expect(f.state.places[0].location == Location(lat: 35.18, long: 129.076), "saved for later")
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98"], "no second request")
    }

    @Test func allowedOnceAtThePromptSettlesSilentlyAndLocationOnReloads() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined, answer: .authorizedWhenInUse,
                                           fixes: [Location(lat: 37.5013, long: 127.0396)]))
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { !f.session.locating })
        #expect(f.location.prompts == 1)
        #expect(f.session.positionRetry == nil, "a grant shows nothing")
        #expect(f.location.locationOn == 1)
        // The app's state change handler sends `reloadEvent 'locationOn'`, which reloads the selected current position.
        f.session.reload(.locationOn)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.paths.count == 3 })
        #expect(f.paths.last == "/weather/v000903/coord/37.501,127.04")
        #expect(f.events.outcomes("location_permission", "outcome") == ["denied", "granted"])
    }

    @Test func deniedAtThePromptAsksToSearchOrRetry() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined, answer: .denied))
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.session.positionRetry != nil })
        #expect(f.session.positionRetry == RetryConfirm(lines: ["LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY"],
                                                        buttons: [.search, .retry]))
        #expect(!f.session.locating)
        // While it is open no reload runs.
        f.session.reload(.tab)
        await f.clock.advance(by: 1000)
        #expect(f.paths.count == 1)
        // Search: the current position is disabled and the next place selected; the app opens the Locations tab.
        f.session.searchInsteadOfPosition()
        #expect(f.session.positionRetry == nil)
        #expect(f.state.places[0].disable)
        #expect(f.state.placeIndex == 1)
    }

    @Test func deniedOrRestrictedLoadsTheSavedPositionAsItIs() async throws {
        for system in [SystemAuthorization.denied, .restricted] {
            let f = try Fixture(LocationDouble(system: system))
            f.session.reload(.initial)
            await f.clock.advance(by: 1000)
            #expect(await eventually { !f.session.locating })
            #expect(f.paths == ["/weather/v000903/coord/37.56,126.98"])
            #expect(f.session.positionRetry == nil)
            #expect(f.location.prompts == 0 && f.location.positions == 0 && f.location.serviceRequests == 0)
            #expect(f.events.outcomes("location_permission", "outcome") == ["denied"])
        }
    }

    @Test func locationServicesOffWithoutASavedPositionAsksToTurnThemOn() async throws {
        let empty = Place(currentPosition: true, disable: false)
        let f = try Fixture(LocationDouble(services: false, system: .denied), current: empty)
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { !f.session.locating })
        #expect(f.location.serviceRequests == 1, "locationAccuracy.request: the system's alert to turn location on")
        #expect(f.session.positionRetry == nil, "settles silently")
        // The saved current position has neither location nor address: its own load fails as Cordova's did (O03).
        #expect(await eventually { f.session.retry })
        #expect(f.paths.isEmpty)
        // With a saved position the place loads as saved.
        let saved = try Fixture(LocationDouble(services: false, system: .denied))
        saved.session.reload(.initial)
        await saved.clock.advance(by: 1000)
        #expect(await eventually { !saved.session.locating })
        #expect(saved.location.serviceRequests == 0)
        #expect(saved.paths == ["/weather/v000903/coord/37.56,126.98"])
    }

    @Test func noPositionOpensTheRetryConfirmationWhoseOKLooksAgain() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [nil, Location(lat: 37.5604, long: 126.9801)]))
        f.session.recorded = .authorizedWhenInUse // S02 recorded the grant (IN-11).
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.session.positionRetry != nil })
        #expect(f.session.positionRetry == RetryConfirm(lines: ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"], buttons: [.close, .retry]))
        f.session.confirmPositionRetry()
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.location.positions == 2 })
        #expect(await eventually { !f.session.locating })
        #expect(f.session.positionRetry == nil)
        #expect(f.paths.count == 2, "OK reloads the current position (reloadEvent 'retryPopup')")
    }

    @Test func oneLookupAtATime() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Location(lat: 37.56, long: 126.98)]))
        f.session.reload(.initial)
        f.session.reload(.tab)
        await f.clock.advance(by: 1000)
        #expect(await eventually { !f.session.locating })
        #expect(f.location.positions == 1, "a second lookup while one runs is `alreadyCalled`")
    }

    @Test func locationOnReloadsOnlyASelectedCurrentPosition() async throws {
        let f = try Fixture(LocationDouble(system: .denied), selected: 1)
        f.session.reload(.locationOn)
        await f.clock.advance(by: 1000)
        #expect(f.paths.isEmpty)
        f.holder.change { $0.placeIndex = 0 }
        f.session.reload(.locationOn)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.paths.count == 1 })
    }

    @Test func theStartChoiceWithNoEnabledPlace() async throws {
        let disabled = Place(currentPosition: true, disable: true)
        let location = LocationDouble(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5604, long: 126.9801)])
        let f = try Fixture(location, current: disabled, selected: 1)
        f.holder.change { $0.places.removeLast(); $0.placeIndex = -1 }
        #expect(f.session.autoSearch, "location services on when the weather pages opened")
        f.session.openStartPopup()
        #expect(f.session.startPopup)
        // The rows are inverted (A07): the row 현재위치 날씨보기 stands for false and searches.
        f.session.chooseAutoSearch(false)
        #expect(!f.session.startChoice())
        #expect(!f.session.startPopup)
        #expect(f.state.places[0].disable)
        #expect(f.paths.isEmpty)
        // 지역 검색으로 시작 stands for true: the current position is enabled and loads (`reloadEvent 'startPopup'`).
        f.session.openStartPopup()
        f.session.chooseAutoSearch(true)
        #expect(f.session.startChoice())
        #expect(!f.state.places[0].disable)
        #expect(f.state.placeIndex == 0)
        await f.clock.advance(by: 1000)
        #expect(await eventually { !f.session.locating })
        #expect(f.location.positions == 1)
        #expect(f.state.places[0].location == Location(lat: 37.56, long: 126.98))
        #expect(await eventually { f.paths == ["/weather/v000903/coord/37.56,126.98"] })

        let off = try Fixture(LocationDouble(services: false, system: .denied), current: disabled)
        #expect(!off.session.autoSearch, "location services off: the first row")
    }
}
}
