import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// S01's adds (IN-10, #2959): a shortcut, a Places prediction, a bundled town and the current position in every
/// location state of the Cordova iOS app (granted, allowed once, denied, approximate only, restricted, location services
/// off), with O04 and O09 as StartCtrl shows them. The server double answers the geocode and weather requests at once.
/// Port of the Android `StartFlowTest` (AN-10) with the iOS branches.
extension ClockedDataTests {
@MainActor
struct StartFlowTests {
    static let geocodeSeoul = #"{"name":"회현동","country":"KR","address":"서울특별시 중구 회현동","location":{"lat":37.56,"long":126.98},"kmaAddress":{"name1":"서울특별시","name2":"중구","name3":"회현동"}}"#
    static let geocodeLondon = #"{"name":"London","country":"GB","address":"London, UK","location":{"lat":51.507,"long":-0.128}}"#

    @MainActor
    struct Fixture {
        let clock = VirtualClock()
        let http: ScriptedWeatherHTTP
        let holder = AppStateHolder(store: MemoryStore())
        let location: LocationDouble
        let events = EventLog()
        let flow: StartFlow

        init(_ location: LocationDouble, state: AppState = AppState(units: koreanUnits),
             byURL: @escaping (URL) -> ScriptedWeatherHTTP.Behavior? = { _ in nil }) throws {
            let seoulBody = try WeatherFixtures.body("kma-seoul")
            let londonBody = try WeatherFixtures.body("vc-london")
            http = ScriptedWeatherHTTP(clock: clock) { url in
                if let b = byURL(url) { return b }
                let path = url.path
                if path.hasPrefix("/geocode/v000903/coord/") { return .answer(0, Data(StartFlowTests.geocodeSeoul.utf8)) }
                if path.hasPrefix("/geocode/v000903/addr/") { return .answer(0, Data(StartFlowTests.geocodeLondon.utf8)) }
                if path.contains("51.507") { return .answer(0, londonBody) }
                return .answer(0, seoulBody)
            }
            holder.load(state)
            self.location = location
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: http, clock: clock)
            flow = StartFlow(holder: holder, repository: repository,
                             geocode: GeocodeClient(baseURL: "https://server.test.invalid", http: http, clock: clock),
                             location: location, acceptLanguage: { "ko-KR,ko;q=0.9" }, telemetry: events.telemetry)
        }

        var paths: [String] { http.attempts.map { $0.url.path(percentEncoded: true) } }
        var state: AppState { holder.state! }
    }

    static let cityHall = Location(lat: 37.5662952, long: 126.9779451)

    /// The current position saved in slot 0, named from the geocode response, and S01 closed onto it.
    func expectCurrentPositionAdded(_ f: Fixture) {
        let s = f.state
        #expect(s.places.count == 1)
        #expect(s.places[0].currentPosition)
        #expect(!s.places[0].disable)
        #expect(s.places[0].name == "회현동", "named from the geocode")
        #expect(s.places[0].address == "서울특별시 중구 회현동")
        #expect(s.places[0].country == "KR")
        #expect(s.places[0].location == Location(lat: 37.56, long: 126.98))
        #expect(s.places[0].source == "KMA")
        #expect(s.placeIndex == 0)
        #expect(s.cordovaExtras["startVersion"] == .number(1))
        #expect(!StartGate.shows(s.cordovaExtras["startVersion"]))
    }

    @Test func grantedLocatesGeocodesAndSavesTheCurrentPosition() async throws {
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Self.cityHall]))
        var overlay: [Bool] = []
        #expect(await f.flow.useCurrentLocation { overlay.append($0) } == .added)
        // The fix rounded to three decimals (`geolocationNormalize`), then the geocode's location for the weather.
        #expect(f.paths == ["/geocode/v000903/coord/37.566,126.978", "/weather/v000903/coord/37.56,126.98"])
        #expect(f.http.attempts.allSatisfy { $0.headers["Accept-Language"] == "ko-KR,ko;q=0.9" })
        expectCurrentPositionAdded(f)
        #expect(f.location.prompts == 0)
        #expect(overlay == [true, false])
        #expect(f.events.outcomes("location_permission", "outcome") == ["granted"])
        #expect(f.events.outcomes("favorite_change", "action") == [], "the current position is no favorite")
        #expect(f.flow.recorded == .authorizedWhenInUse)
    }

    @Test func allowedOnceRunsTheAttemptAgainAfterThePrompt() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined, answer: .authorizedWhenInUse, fixes: [Self.cityHall]))
        var overlay: [Bool] = []
        #expect(await f.flow.useCurrentLocation { overlay.append($0) } == .added)
        #expect(f.location.prompts == 1)
        #expect(f.location.locationOn == 1, "the grant is a state change to enabled")
        expectCurrentPositionAdded(f)
        // Shown, hidden before the prompt, shown again for the second attempt, hidden after the weather.
        #expect(overlay == [true, false, true, false])
        #expect(f.events.outcomes("location_permission", "outcome") == ["denied", "granted"])

        // Allow Once expires: at the next start iOS reports not_determined again and the prompt shows again.
        f.location.change(.notDetermined)
        f.location.resume()
        #expect(f.location.recorded == .notDetermined)
        f.location.answer = .authorizedWhenInUse
        f.location.fixes = [Self.cityHall]
        _ = await f.flow.locate()
        #expect(f.location.prompts == 2)
    }

    @Test func deniedAtThePromptEndsInTheDenialWithoutAHang() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined, answer: .denied))
        var overlay: [Bool] = []
        let outcome = await f.flow.useCurrentLocation { overlay.append($0) }
        // iOS records nothing for the prompt's answer: Settings as for an unrecorded status.
        #expect(outcome == .confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"],
                                                 buttons: [.close, .settings, .retry])))
        #expect(overlay.last == false, "the overlay is hidden")
        #expect(f.paths.isEmpty)
        #expect(f.state.places == [.currentPositionPlaceholder])
        #expect(StartGate.shows(f.state.cordovaExtras["startVersion"]), "S01 stays")
        // OK tries again: the record now holds the denial, which StartCtrl reads and records: the hint and Settings.
        let again = await f.flow.useCurrentLocation()
        #expect(again == .confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"],
                                               buttons: [.close, .settings, .retry])))
        #expect(f.location.prompts == 1, "no second prompt")
    }

    @Test func deniedEarlierEndsInTheDenialWithTheHint() async throws {
        let f = try Fixture(LocationDouble(system: .denied))
        let outcome = await f.flow.useCurrentLocation()
        #expect(outcome == .confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"],
                                                 buttons: [.close, .settings, .retry])))
        #expect(f.location.prompts == 0 && f.location.positions == 0)
        #expect(f.events.outcomes("location_permission", "outcome") == ["denied"])
    }

    @Test func approximateOnlyLocatesWithTheReducedFix() async throws {
        // Precise location off: CoreLocation's fixes are kilometres off; the status is the same grant.
        let approximate = Location(lat: 37.5813, long: 126.9637)
        let f = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [approximate]))
        #expect(await f.flow.useCurrentLocation() == .added)
        #expect(f.paths.first == "/geocode/v000903/coord/37.581,126.964")
        expectCurrentPositionAdded(f)
    }

    @Test func restrictedEndsInTheDenial() async throws {
        let f = try Fixture(LocationDouble(system: .restricted))
        #expect(f.location.recorded == .deniedAlways, "the plugin reports restricted as denied_always")
        let outcome = await f.flow.useCurrentLocation()
        #expect(outcome == .confirm(RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"],
                                                 buttons: [.close, .settings, .retry])))
        #expect(f.location.prompts == 0)
    }

    @Test func locationServicesOffEndsInAMessageWithoutAHang() async throws {
        // Off at the start: nothing recorded, and iOS reports denied for the app.
        let off = try Fixture(LocationDouble(services: false, system: .denied))
        #expect(off.location.recorded == nil)
        #expect(await off.flow.useCurrentLocation() == .confirm(RetryConfirm(
            lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"], buttons: [.close, .settings, .retry])))
        // Reported with the app's grant: the turn-on message and Settings.
        let granted = try Fixture(LocationDouble(services: false, system: .authorizedWhenInUse))
        #expect(await granted.flow.useCurrentLocation() == .confirm(RetryConfirm(
            lines: ["LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"], buttons: [.close, .settings, .retry])))
        // Reported as never asked: the prompt cannot change anything, which ends in the denial instead of waiting.
        let asked = try Fixture(LocationDouble(services: false, system: .notDetermined, answer: .authorizedWhenInUse))
        #expect(await asked.flow.useCurrentLocation() == .confirm(RetryConfirm(
            lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"], buttons: [.close, .settings, .retry])))
        #expect(asked.location.prompts == 1)
        for f in [off, granted, asked] {
            #expect(f.paths.isEmpty)
            #expect(f.location.positions == 0)
        }
        // Turned on in Settings and back in the app: the grant is recorded, `locationOn`, and the attempt locates.
        granted.location.servicesEnabled = true
        granted.location.fixes = [Self.cityHall]
        granted.location.resume()
        #expect(await granted.flow.useCurrentLocation() == .added)
        expectCurrentPositionAdded(granted)
    }

    @Test func aFailedPositionOrGeocodeEndsInTheRetryConfirmation() async throws {
        let noFix = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [nil]))
        #expect(await noFix.flow.useCurrentLocation() == .confirm(RetryConfirm(
            lines: ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"], buttons: [.close, .retry])))
        let noGeocode = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Self.cityHall])) { url in
            url.path.hasPrefix("/geocode/") ? .fail(0, 500) : nil
        }
        #expect(await noGeocode.flow.useCurrentLocation() == .confirm(RetryConfirm(
            lines: ["LOC_FAIL_TO_GET_LOCATION_INFORMATION"], buttons: [.close, .retry])))
        #expect(noGeocode.paths.count == 1, "a fast error status settles the first attempt")
        #expect(noGeocode.state.places == [.currentPositionPlaceholder])
    }

    @Test func theCurrentPositionsWeatherFailureIsO09() async throws {
        let failed = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Self.cityHall])) { url in
            url.path.hasPrefix("/weather/") ? .fail(0, 503) : nil
        }
        #expect(await failed.flow.useCurrentLocation() == .alert(StartFlow.failedWeather))
        #expect(failed.state.places == [.currentPositionPlaceholder], "the current position stays disabled")
        let unconvertible = try Fixture(LocationDouble(system: .authorizedWhenInUse, fixes: [Self.cityHall])) { url in
            url.path.hasPrefix("/weather/") ? .answer(0, Data("{}".utf8)) : nil
        }
        #expect(await unconvertible.flow.useCurrentLocation() == .alert(StartFlow.alreadyAdded))
        #expect(unconvertible.state.places[0].disable, "disabled again")
        #expect(StartGate.shows(unconvertible.state.cordovaExtras["startVersion"]))
    }

    @Test func aShortcutIsAddedAfterItsWeatherLoaded() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined))
        let seoulShortcut = try #require(CityShortcuts.forScreenHeight(852).first)
        #expect(await f.flow.addShortcut(seoulShortcut) == .added)
        #expect(f.paths == ["/weather/v000903/coord/37.567,126.978"])
        let s = f.state
        try #require(s.places.count == 2)
        #expect(s.places[1] == Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시",
                                     country: "KR", location: Location(lat: 37.567, long: 126.978), source: "KMA"))
        #expect(s.placeIndex == 1, "the last place is selected")
        #expect(s.places[0].disable, "the current position stays off")
        #expect(f.events.outcomes("favorite_change", "action") == ["add"])
        #expect(f.location.prompts == 0, "no location request")
        // The same place again: O09's duplicate message, nothing added.
        #expect(await f.flow.addShortcut(seoulShortcut) == .alert(StartFlow.alreadyAdded))
        #expect(f.state.places.count == 2)
    }

    @Test func aFailedShortcutIsO09AndAddsNothing() async throws {
        let f = try Fixture(LocationDouble(system: .notDetermined)) { _ in .fail(0, 503) }
        let berlin = try #require(CityShortcuts.forScreenHeight(852).dropFirst(3).first)
        #expect(await f.flow.addShortcut(berlin) == .alert(StartFlow.failedWeather))
        #expect(f.state.places == [.currentPositionPlaceholder])
        #expect(StartGate.shows(f.state.cordovaExtras["startVersion"]))
    }

    @Test func aPredictionIsGeocodedByItsFullTextAndNamedByItsTerm() async throws {
        let f = try Fixture(LocationDouble(system: .denied))
        #expect(await f.flow.addPrediction(fullText: "London, UK", firstMatch: 0, word: "Lon") == .added)
        #expect(f.paths == ["/geocode/v000903/addr/London,%20UK", "/weather/v000903/coord/51.507,-0.128"])
        try #require(f.state.places.count == 2)
        let place = f.state.places[1]
        #expect(place.name == "London", "the term at the first match")
        #expect(place.address == "London, UK")
        #expect(place.country == "GB")
        #expect(f.state.placeIndex == 1)
        // A failed geocode shows nothing.
        let failed = try Fixture(LocationDouble(system: .denied)) { url in url.path.hasPrefix("/geocode/") ? .fail(0, 404) : nil }
        #expect(await failed.flow.addPrediction(fullText: "Paris, France", firstMatch: 0, word: "Par") == .none)
        #expect(failed.state.places == [.currentPositionPlaceholder])
    }

    @Test func aBundledTownIsAddedWithoutAGeocode() async throws {
        let f = try Fixture(LocationDouble(system: .denied))
        let town = BundledTown(first: "서울특별시", second: "중구", third: "회현동", lat: 37.56, long: 126.98)
        #expect(await f.flow.addTown(town) == .added)
        #expect(f.paths == ["/weather/v000903/coord/37.56,126.98"])
        try #require(f.state.places.count == 2)
        #expect(f.state.places[1].name == "회현동")
        #expect(f.state.places[1].address == "대한민국 서울특별시 중구 회현동")
    }
}
}
