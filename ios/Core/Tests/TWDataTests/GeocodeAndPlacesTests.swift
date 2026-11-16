import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// The geocode requests of S01 and S02, WeatherInfo's list operations and the position wait (IN-10, #2959). Ported from
/// the Android `GeocodeClientTest` and `PlaceListTest` (AN-10).
extension ClockedDataTests {
@MainActor
struct GeocodeAndPlacesTests {
    @Test func theGeocodeRequestsUseTheLegacyPathsAndTheWebViewsLanguage() async throws {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock) { url in
            url.path.contains("/coord/") ? .answer(0, Data(StartFlowTests.geocodeSeoul.utf8)) : .answer(0, Data("[1]".utf8))
        }
        let client = GeocodeClient(baseURL: "https://server.test.invalid", http: http, clock: clock)
        let seoul = try #require(await client.byLocation(Location(lat: 37.566, long: 126.978), acceptLanguage: "en-US,en;q=0.9"))
        #expect(seoul["name"]?.stringValue == "회현동")
        // A body that is JSON but no object reads as an object without fields.
        let other = try #require(await client.byAddress("서울특별시 중구", acceptLanguage: "ko-KR,ko;q=0.9"))
        #expect(other.isEmpty)
        let urls = http.attempts.map { $0.url.absoluteString }
        #expect(urls == ["https://server.test.invalid/geocode/v000903/coord/37.566,126.978",
                         "https://server.test.invalid/geocode/v000903/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C%20%EC%A4%91%EA%B5%AC"])
        #expect(http.attempts.map { $0.headers["Accept-Language"] } == ["en-US,en;q=0.9", "ko-KR,ko;q=0.9"])

        let place = GeocodeClient.place(seoul, currentPosition: true)
        #expect(place == Place(currentPosition: true, disable: false, name: "회현동", address: "서울특별시 중구 회현동", country: "KR",
                               location: Location(lat: 37.56, long: 126.98)))
        // JavaScript's number text for the coordinates.
        _ = await client.byLocation(Location(lat: -33.869, long: 151.2), acceptLanguage: "en")
        #expect(http.attempts.last?.url.path == "/geocode/v000903/coord/-33.869,151.2")
    }

    @Test func aFailedOrUnparsableGeocodeIsNone() async throws {
        let clock = VirtualClock()
        let failing = ScriptedWeatherHTTP(clock: clock) { _ in .fail(0, 500) }
        #expect(await GeocodeClient(baseURL: "https://server.test.invalid", http: failing, clock: clock)
            .byAddress("London", acceptLanguage: "en") == nil)
        let html = ScriptedWeatherHTTP(clock: clock) { _ in .answer(0, Data("<html>".utf8)) }
        #expect(await GeocodeClient(baseURL: "https://server.test.invalid", http: html, clock: clock)
            .byAddress("London", acceptLanguage: "en") == nil)
        // Without the private server URL nothing is sent.
        let none = ScriptedWeatherHTTP(clock: clock)
        #expect(await GeocodeClient(baseURL: "", http: none, clock: clock).byAddress("London", acceptLanguage: "en") == nil)
        #expect(none.attempts.isEmpty)
        // A hanging server: three attempts 2 s apart, each ending after 10 s.
        let hanging = ScriptedWeatherHTTP(clock: clock) { _ in .hang }
        let client = GeocodeClient(baseURL: "https://server.test.invalid", http: hanging, clock: clock)
        async let answer = client.byLocation(Location(lat: 1, long: 2), acceptLanguage: "en")
        await clock.advance(by: 15_000)
        #expect(await answer == nil)
        #expect(hanging.attempts.map(\.at) == [clock.elapsed - 15_000, clock.elapsed - 13_000, clock.elapsed - 11_000])
    }

    @Test func theListOperationsOfWeatherInfo() {
        let current = Place(currentPosition: true, disable: true)
        let named = Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시")
        let unnamed = Place(currentPosition: false, disable: false, address: "London, UK")
        let places = [current, named, unnamed]
        #expect(PlaceList.indexOf(places, Place(currentPosition: true, disable: false, name: "x")) == 0)
        #expect(PlaceList.indexOf(places, Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시")) == 1)
        #expect(PlaceList.indexOf(places, Place(currentPosition: false, disable: false, name: "중구", address: "대한민국 서울특별시")) == -1,
                "the same address with another name is another place")
        #expect(PlaceList.indexOf(places, Place(currentPosition: false, disable: false, address: "London, UK")) == 2)
        #expect(PlaceList.indexOf(places, Place(currentPosition: false, disable: false, name: "", address: "London, UK")) == 2,
                "an empty name is no name")

        let state = AppState(places: [current], placeIndex: -1)
        let added = PlaceList.add(state, Place(currentPosition: false, disable: true, name: "서울", address: "a"))
        #expect(added != nil)
        #expect(added?.places.last?.disable == false, "addCity enables the place")
        #expect(added.flatMap { PlaceList.add($0, Place(currentPosition: false, disable: false, name: "서울", address: "a")) } == nil)

        let closed = PlaceList.closeStart(added!)
        #expect(closed.placeIndex == 1)
        #expect(closed.cordovaExtras["startVersion"] == .number(1))

        // disableCity: the flag, then the first enabled place while the index is at most 0.
        let on = PlaceList.disableCurrent(state, false)
        #expect(!on.places[0].disable && on.placeIndex == 0)
        let off = PlaceList.disableCurrent(AppState(places: [Place(currentPosition: true, disable: false), named], placeIndex: 0), true)
        #expect(off.places[0].disable && off.placeIndex == 1)
        let kept = PlaceList.disableCurrent(AppState(places: [Place(currentPosition: true, disable: false), named, unnamed], placeIndex: 2), true)
        #expect(kept.placeIndex == 2)
    }

    @Test func thePositionWaitSkipsStaleFixesAndEndsOnAnErrorOrTheTimeout() async {
        let clock = VirtualClock()
        let start = clock.now
        // CoreLocation's cached fix from five minutes ago is passed over; a fresh one counts.
        let (stream, events) = AsyncStream<PositionEvent>.makeStream()
        async let found = PositionFix.first(stream, clock: clock)
        events.yield(.fix(Location(lat: 1, long: 1), at: start.addingTimeInterval(-300)))
        events.yield(.fix(Location(lat: 37.5, long: 127), at: start.addingTimeInterval(-30)))
        #expect(await found == Location(lat: 37.5, long: 127))
        #expect(PositionFix.accepts(start.addingTimeInterval(-60), now: start))
        #expect(!PositionFix.accepts(start.addingTimeInterval(-60.5), now: start))

        // An error ends it.
        let (failing, failEvents) = AsyncStream<PositionEvent>.makeStream()
        async let failed = PositionFix.first(failing, clock: clock)
        failEvents.yield(.failed)
        #expect(await failed == nil)

        // Nothing usable within 60 s.
        let (silent, silentEvents) = AsyncStream<PositionEvent>.makeStream()
        async let none = PositionFix.first(silent, clock: clock)
        silentEvents.yield(.fix(Location(lat: 1, long: 1), at: start.addingTimeInterval(-3600)))
        await clock.advance(by: 60_000)
        #expect(await none == nil)
        silentEvents.finish()
    }
}
}
