import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// One visit of S02 (IN-11, #2960; the Android `PlacesPageTest` of AN-11 with SearchCtrl's iOS branches): the visit's
/// bells and loads, deletes and the current position's switch (with the alarms' removal), find-by-location with O03
/// `search`, the adds of a result, and the changes saved across a restart. The server double answers at once.
extension ClockedDataTests {
@MainActor
struct PlacesPageTests {
    static let geocodeSeoul = StartFlowTests.geocodeSeoul
    static let geocodeLondon = StartFlowTests.geocodeLondon
    static let current = Place(currentPosition: true, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                               country: "KR", location: Location(lat: 37.56, long: 126.98))
    static func alarm(_ index: Int, enable: Bool = true) -> JSONObject {
        JSONObject([("cityIndex", .number(index)), ("id", 1), ("time", "2026-11-07T22:40:00.000Z"),
                    ("dayOfWeek", [false, true, true, true, true, true, false]), ("enable", .bool(enable)), ("category", "alarm")])
    }

    @MainActor
    struct Fixture {
        let clock = VirtualClock()
        let http: ScriptedWeatherHTTP
        let holder: AppStateHolder
        let location: LocationDouble
        let events = EventLog()
        let repository: WeatherRepository
        let session: WeatherSession
        let page: PlacesPage
        let removed: Removed
        let popups: Popups

        final class Removed { var indices: [Int] = [] }
        final class Popups { var shown: [StartFlow.Outcome] = []; var added = 0 }

        init(_ location: LocationDouble, places: [Place], selected: Int = 1, records: [JSONObject] = [],
             store: any AppStateSaving = MemoryStore(), byURL: @escaping (URL) -> ScriptedWeatherHTTP.Behavior? = { _ in nil }) throws {
            let seoulBody = try WeatherFixtures.body("kma-seoul")
            let londonBody = try WeatherFixtures.body("vc-london")
            http = ScriptedWeatherHTTP(clock: clock) { url in
                if let b = byURL(url) { return b }
                let path = url.path
                if path.hasPrefix("/geocode/v000903/coord/") { return .answer(0, Data(PlacesPageTests.geocodeSeoul.utf8)) }
                if path.hasPrefix("/geocode/v000903/addr/") { return .answer(0, Data(PlacesPageTests.geocodeLondon.utf8)) }
                if path.contains("51.5") { return .answer(0, londonBody) }
                return .answer(0, seoulBody)
            }
            holder = AppStateHolder(store: store)
            holder.load(AppState(places: places, placeIndex: selected, units: koreanUnits,
                                 push: PushState(type: "ios", fcmToken: "token-a", records: records),
                                 cordovaExtras: JSONObject([("startVersion", 1)])))
            self.location = location
            repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: http, clock: clock)
            session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" }, clock: clock,
                                     location: location)
            let removed = Removed(), popups = Popups()
            self.removed = removed
            self.popups = popups
            page = PlacesPage(holder: holder, repository: repository, session: session,
                              geocode: GeocodeClient(baseURL: "https://server.test.invalid", http: http, clock: clock),
                              location: location, acceptLanguage: { "ko-KR,ko;q=0.9" }, telemetry: events.telemetry,
                              removeAlarms: { removed.indices.append($0) })
            page.onPopup = { popups.shown.append($0) }
            page.onAdded = { popups.added += 1 }
        }

        var paths: [String] { http.attempts.map { $0.url.path(percentEncoded: true) } }
        var state: AppState { holder.state! }

        /// Waits for the visit's loads, its lookup and the action behind the overlay.
        func settle() async {
            await page.visit?.value
            await page.lookup?.value
            await page.action?.value
        }
    }

    // MARK: The visit

    @Test func aVisitReadsTheBellsOnceAndLoadsEachEnabledPlaceThroughTheGate() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul, london],
                            records: [Self.alarm(1, enable: false), Self.alarm(2)])
        f.page.open()
        #expect(f.page.hasPush == [false, false, true], "an enabled record only")
        await f.settle()
        // The disabled current position loads nothing; the others in saved order.
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98", "/weather/v000903/coord/51.51,-0.13"])
        #expect(f.repository.cached(london)?.weather["currentWeather"] != nil)
        // A second visit within ten minutes: the gate stops both.
        let again = PlacesPage(holder: f.holder, repository: f.repository, session: f.session,
                               geocode: GeocodeClient(baseURL: "https://server.test.invalid", http: f.http, clock: f.clock),
                               location: f.location, acceptLanguage: { "" }, removeAlarms: { _ in })
        again.open()
        await again.visit?.value
        #expect(f.paths.count == 2)
    }

    /// An enabled current position looks itself up (a grant records nothing on iOS) and loads again with its stored
    /// location, which the found one does not replace (SearchCtrl's `updateCity` is commented out).
    @Test func aVisitLooksUpAnEnabledCurrentPositionAndLoadsItAgain() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]), places: [Self.current, seoul],
                            selected: 0)
        f.page.open()
        await f.settle()
        #expect(f.paths.contains("/geocode/v000903/coord/37.566,126.978"))
        #expect(f.paths.filter { $0 == "/weather/v000903/coord/37.56,126.98" }.count == 3, "the current position twice and 서울")
        #expect(f.state.places[0].location == Location(lat: 37.56, long: 126.98))
        #expect(f.session.recorded == nil)
        #expect(f.popups.shown.isEmpty)
    }

    @Test func aFailedLookupOnAVisitShowsNothing() async throws {
        let f = try Fixture(LocationDouble(system: .denied), places: [Self.current, seoul], selected: 0)
        f.page.open()
        await f.settle()
        #expect(f.popups.shown.isEmpty)
        #expect(f.session.recorded == .deniedAlways, "recorded into TabCtrl's status")
        #expect(!f.paths.contains { $0.hasPrefix("/geocode/") })
    }

    // MARK: Deletes and the switch

    @Test func deletingAPlaceWithABellRemovesItsAlarmsFirst() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul, london],
                            selected: 2, records: [Self.alarm(1), Self.alarm(2)])
        f.page.open()
        f.page.delete(1)
        #expect(f.removed.indices == [1])
        #expect(f.state.places == [.currentPositionPlaceholder, london])
        // The selected number (2) now equals the count: `setFirstCityIndex` (the current position is off: 1).
        #expect(f.state.placeIndex == 1)
        #expect(f.page.hasPush == [false, true], "the deleted row's bell goes with it")
        #expect(f.events.outcomes("favorite_change", "action") == ["remove"])
        #expect(f.state.push.records.count == 2, "the records are the push service's (A24): nothing renumbered here")
    }

    /// A24: a place whose records are all disabled shows no bell, so nothing is removed.
    @Test func deletingAPlaceWithoutABellRemovesNoAlarms() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul, london],
                            selected: 2, records: [Self.alarm(1, enable: false)])
        f.page.open()
        f.page.delete(1)
        #expect(f.removed.indices.isEmpty)
        #expect(f.state.places.count == 2)
        // Deleting an earlier place keeps the selected number (now the next place); the current position has no ⊗.
        f.page.delete(0)
        #expect(f.state.places.count == 2)
    }

    @Test func removingAPlaceKeepsTheSelectedNumberUnlessItWasTheLast() {
        let s = AppState(places: [.currentPositionPlaceholder, seoul, london], placeIndex: 1)
        #expect(PlaceList.remove(s, 2).placeIndex == 1)
        #expect(PlaceList.remove(s, 1).placeIndex == 1, "now London")
        var last = s
        last.placeIndex = 2
        #expect(PlaceList.remove(last, 2).placeIndex == 1, "the first enabled place")
        var on = last
        on.places[0].disable = false
        #expect(PlaceList.remove(on, 2).placeIndex == 0)
        #expect(PlaceList.remove(s, 7) == s)
    }

    @Test func turningTheCurrentPositionOffRemovesItsAlarms() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [Self.current, seoul], selected: 0,
                            records: [Self.alarm(0)])
        f.page.open()
        await f.settle()
        f.page.setCurrentPosition(false)
        #expect(f.state.places[0].disable)
        #expect(f.state.placeIndex == 1, "setFirstCityIndex")
        #expect(f.removed.indices == [0])
        // Without a bell nothing is removed.
        let g = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [Self.current, seoul], selected: 1)
        g.page.open()
        g.page.setCurrentPosition(false)
        #expect(g.removed.indices.isEmpty && g.state.places[0].disable && g.state.placeIndex == 1)
    }

    /// The first enable (no temperature yet): found, named from the geocode, its weather loaded, behind the overlay.
    @Test func turningTheCurrentPositionOnTheFirstTimeFindsAndLoadsIt() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]),
                            places: [.currentPositionPlaceholder, seoul])
        f.page.open()
        await f.settle()
        f.page.setCurrentPosition(true)
        #expect(f.page.loading)
        await f.settle()
        #expect(!f.page.loading)
        let current = f.state.places[0]
        #expect(!current.disable && current.name == "회현동" && current.address == "서울특별시 중구 회현동")
        #expect(current.location == Location(lat: 37.56, long: 126.98))
        #expect(f.repository.cached(current)?.weather["currentWeather"] != nil)
        #expect(f.state.placeIndex == 1, "the selection stays (it was above 0)")
        // Off and on again with a temperature: no lookup.
        let lookups = f.location.positions
        f.page.setCurrentPosition(false)
        f.page.setCurrentPosition(true)
        await f.settle()
        #expect(f.location.positions == lookups)
    }

    @Test func aFailedFirstEnableShowsTheSearchConfirmationWhoseOKFindsByLocation() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [nil, StartFlowTests.cityHall]),
                            places: [.currentPositionPlaceholder, seoul])
        f.page.setCurrentPosition(true)
        await f.settle()
        #expect(f.popups.shown == [.confirm(RetryConfirm(lines: ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"], buttons: [.close, .retry]))])
        // A26: OK finds by location (the result row), not the switch's update.
        f.page.retryButton(.retry)
        await f.settle()
        #expect(f.page.found?["name"] == "회현동")
        #expect(f.state.places[0].name == nil)
    }

    // MARK: Find by location and the adds

    @Test func findByLocationGivesTheGeocodedRowAndAddsItAsAPlace() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]), places: [.currentPositionPlaceholder, seoul])
        var overlay: [Bool] = []
        f.page.findByLocation()
        overlay.append(f.page.loading)
        await f.settle()
        overlay.append(f.page.loading)
        #expect(overlay == [true, false])
        #expect(f.page.found?["address"] == "서울특별시 중구 회현동")
        #expect(f.page.finds == 1, "each found position is counted, so the search shows it even under the same name")
        f.page.addFound()
        #expect(f.page.found == nil)
        await f.settle()
        #expect(f.popups.added == 1)
        let added = try #require(f.state.places.last)
        #expect(!added.currentPosition && added.name == "회현동" && added.address == "서울특별시 중구 회현동")
        #expect(f.state.placeIndex == 2, "the new place is selected")
        #expect(f.state.cordovaExtras["startVersion"] == .number(1), "S01's gate is not touched")
        #expect(f.events.outcomes("favorite_change", "action") == ["add"])
    }

    /// The find-by-location failures as TabCtrl's O03 `search` shows them on iOS, by the status SearchCtrl recorded into
    /// TabCtrl's `gLocationAuthorizationStatus`.
    @Test func findByLocationFailuresOpenTheSearchConfirmation() async throws {
        let denied = try Fixture(LocationDouble(system: .denied), places: [.currentPositionPlaceholder, seoul])
        denied.page.findByLocation()
        await denied.settle()
        #expect(denied.popups.shown == [.confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"],
                                                             buttons: [.close, .settings, .retry]))])
        #expect(denied.session.recorded == .deniedAlways)

        let prompt = try Fixture(LocationDouble(system: .notDetermined, answer: .denied), places: [.currentPositionPlaceholder, seoul])
        prompt.page.findByLocation()
        await prompt.settle()
        #expect(prompt.location.prompts == 1)
        #expect(prompt.popups.shown == [.confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"],
                                                             buttons: [.close, .retry]))], "iOS records nothing for the prompt")

        let off = try Fixture(LocationDouble(services: false, system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul])
        off.page.findByLocation()
        await off.settle()
        #expect(off.popups.shown == [.confirm(RetryConfirm(lines: ["LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"],
                                                          buttons: [.close, .settings, .retry]))])

        let geocode = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]),
                                  places: [.currentPositionPlaceholder, seoul]) { url in
            url.path.hasPrefix("/geocode/") ? .fail(0, 500) : nil
        }
        geocode.page.findByLocation()
        await geocode.settle()
        #expect(geocode.popups.shown == [.confirm(RetryConfirm(lines: ["LOC_FAIL_TO_GET_LOCATION_INFORMATION"], buttons: [.close, .retry]))])
        #expect([denied, prompt, off, geocode].allSatisfy { $0.page.finds == 0 }, "a failed lookup finds nothing")
    }

    /// A grant from the prompt runs the lookup again at once (`searchCurrentPositionEvent`).
    @Test func aGrantFromThePromptFindsAtOnce() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined, answer: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]),
                            places: [.currentPositionPlaceholder, seoul])
        f.page.findByLocation()
        await f.settle()
        #expect(f.location.prompts == 1 && f.page.found != nil && f.popups.shown.isEmpty)
    }

    @Test func aPredictionIsGeocodedByItsTermsAndAdded() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul])
        f.page.addPrediction(fullText: "London, UK", firstMatch: 0, word: "Lon")
        await f.settle()
        #expect(f.paths.first == "/geocode/v000903/addr/London,UK")
        #expect(f.popups.added == 1)
        #expect(f.state.places.last?.name == "London" && f.state.placeIndex == 2)
    }

    @Test func aTownIsAddedWithoutAGeocodeAndADuplicateShowsO09() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul])
        let busan = BundledTown(first: "부산광역시", second: "", third: "", lat: 35.18, long: 129.08)
        f.page.addTown(busan)
        await f.settle()
        #expect(f.paths == ["/weather/v000903/coord/35.18,129.08"])
        #expect(f.state.places.last?.name == "부산광역시" && f.state.places.last?.address == "대한민국 부산광역시")
        f.page.addTown(busan)
        await f.settle()
        #expect(f.popups.shown == [.alert("LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED")])
        #expect(f.popups.added == 1)
    }

    @Test func aFailedWeatherRequestShowsO09AndAddsNothing() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul]) { url in
            url.path.hasPrefix("/weather/") ? .fail(0, 503) : nil
        }
        f.page.addTown(BundledTown(first: "부산광역시", second: "", third: "", lat: 35.18, long: 129.08))
        await f.settle()
        #expect(f.popups.shown == [.alert("LOC_FAIL_TO_GET_WEATHER_INFO")])
        #expect(f.state.places.count == 2)
    }

    /// A failed geocode of a prediction shows nothing (Cordova only hides the overlay).
    @Test func aFailedGeocodeShowsNothing() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul]) { url in
            url.path.hasPrefix("/geocode/") ? .fail(0, 500) : nil
        }
        f.page.addPrediction(fullText: "London, UK", firstMatch: 0, word: "Lon")
        await f.settle()
        #expect(f.popups.shown.isEmpty && f.popups.added == 0 && !f.page.loading)
    }

    // MARK: goPage and persistence

    /// A row tap (`setCityIndex`, `goPage`): the place is selected and `reloadEvent 'search'` waits for the gate.
    @Test func openingAPlaceFromTheListSelectsItAndLoadsThroughTheGate() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse), places: [.currentPositionPlaceholder, seoul, london])
        f.page.open()
        await f.settle()
        let requests = f.paths.count
        f.session.openFromSearch(2)
        #expect(f.state.placeIndex == 2)
        // Loaded by the visit: the gate stops the reload before any request.
        #expect(f.paths.count == requests)
        f.repository.invalidate(london)
        f.session.openFromSearch(2)
        #expect(await eventually { f.paths.count == requests + 1 })
        f.session.openFromSearch(9)
        #expect(f.state.placeIndex == 2, "an index outside the places is refused")
    }

    /// The changes of a visit are in the state file after a restart: an added place, a deleted one, the current position
    /// switched (slot 0 stays the current position), the selected place.
    @Test func theChangesSurviveARestart() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-places-\(UUID().uuidString)")
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [StartFlowTests.cityHall]),
                            places: [.currentPositionPlaceholder, seoul, london], store: store)
        f.page.open()
        await f.settle()
        f.page.addTown(BundledTown(first: "부산광역시", second: "", third: "", lat: 35.18, long: 129.08))
        await f.settle()
        f.page.delete(2)
        f.page.setCurrentPosition(true)
        await f.settle()
        await f.holder.saved()

        let restarted = try #require(try store.load())
        #expect(restarted.places.map(\.name) == ["회현동", "회현동", "부산광역시"])
        #expect(restarted.places[0].currentPosition && !restarted.places[0].disable, "slot 0 is the current position")
        #expect(!restarted.places[1].currentPosition)
        // 부산광역시 (3) was selected by its add; deleting London before it made the number equal the count, so
        // `setFirstCityIndex` chose 서울 (the current position was still off), as Cordova's `removeCity` does.
        #expect(restarted.placeIndex == 1)
        #expect(restarted == f.state)
        // Off again, saved: the slot stays, disabled.
        f.page.setCurrentPosition(false)
        await f.holder.saved()
        let off = try #require(try store.load())
        #expect(off.places[0].currentPosition && off.places[0].disable && off.places.count == 3)
    }
}
}
