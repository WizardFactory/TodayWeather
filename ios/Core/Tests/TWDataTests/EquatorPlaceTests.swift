import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// A linked place on the equator (`/loc?lat=0&lon=…`, #3097) has no address: its coordinates are its location. Cordova's
/// `if (location.lat)` prefers the address at latitude 0 (A05), which still holds when there is one. The request, the
/// weather key and `updateCity`'s location follow the same rule (Android CODEX-3164-5, -11, -13).
struct EquatorPlaceTests {
    static let units = [("temperatureUnit", "C")]

    @Test func theRequestUsesCoordinatesAtLatitudeZeroWithoutAnAddress() {
        #expect(WeatherRequests.url(base: "", lat: 0, long: 10.5, address: nil, units: Self.units)?
            .hasPrefix("/weather/v000903/coord/0,10.5") == true)
        #expect(WeatherRequests.url(base: "", lat: 0, long: 10.5, address: "", units: Self.units)?
            .hasPrefix("/weather/v000903/coord/0,10.5") == true)
        // With an address, latitude 0 still falls back to it (A05).
        #expect(WeatherRequests.url(base: "", lat: 0, long: 10.5, address: "서울특별시 중구", units: Self.units)?
            .hasPrefix("/v000903/kma/addr/") == true)
        #expect(WeatherRequests.usesCoordinates(lat: 0, address: nil))
        #expect(!WeatherRequests.usesCoordinates(lat: 0, address: "서울특별시 중구"))
        #expect(!WeatherRequests.usesCoordinates(lat: .nan, address: nil))
        #expect(!WeatherRequests.usesCoordinates(lat: nil, address: nil))
    }

    @Test func theKeyFollowsTheRequest() {
        let equator = Place(currentPosition: false, disable: false, name: "Null Island", location: Location(lat: 0, long: 0))
        #expect(WeatherRepository.key(equator) == "coord:0,0")
        var addressed = equator
        addressed.address = "서울특별시 중구"
        #expect(WeatherRepository.key(addressed) == "addr:서울특별시 중구")
    }

    @Test func aResponseKeepsTheEquatorPlacesOwnLocation() throws {
        let equator = Place(currentPosition: false, disable: false, name: "Null Island", location: Location(lat: 0, long: 0))
        let converted = try #require(JSONValue.parse(Data(#"{"location": {"lat": 1.5, "long": 2.5}}"#.utf8)).objectValue)
        #expect(WeatherRepository.updatePlace(equator, converted).location == Location(lat: 0, long: 0))
        var addressed = equator
        addressed.address = "서울특별시 중구"
        #expect(WeatherRepository.updatePlace(addressed, converted).location == Location(lat: 1.5, long: 2.5))
    }
}
