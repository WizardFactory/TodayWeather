import Foundation
import Testing
import TWDomain
import TWModel

/// The weather request URLs against `getWeatherByGeoInfo` of the Cordova code (Corpus/requests.json; byte-identical under
/// JavaScriptCore, `ios/tools/corpus/compare_jsc.py`), and the URL WebKit sends for them (IN-08, #2957).
struct WeatherRequestsTests {
    static let unitKeys = ["temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit"]

    @Test func urlsMatchTheCordovaCode() throws {
        let cases = try #require(try Corpus.read("requests.json").arrayValue)
        #expect(cases.count == 15)
        for c in cases {
            let name = s(c["name"]) ?? ""
            let geo = c["geoInfo"]
            let location = geo?["location"]
            let units = Self.unitKeys.map { ($0, s(c["units"]?[$0]) ?? "") }
            let url = WeatherRequests.url(base: "https://server.test.invalid", lat: location?["lat"]?.numberValue?.double,
                                          long: location?["long"]?.numberValue?.double, address: geo?["address"]?.stringValue,
                                          units: units)
            if s(c["error"]) == "rejected" {
                #expect(url == nil, "\(name): rejected")
            } else {
                #expect(sameText(url, s(c["url"])), "\(name): \(url ?? "nil")")
            }
        }
    }

    @Test func coordinatesUseJavaScriptNumberText() {
        let units = [("temperatureUnit", "C")]
        #expect(WeatherRequests.url(base: "b", lat: 1e-7, long: 127, address: nil, units: units)
                == "b/weather/v000903/coord/1e-7,127?temperatureUnit=C&airForecastSource=kaq")
        #expect(WeatherRequests.url(base: "b", lat: .nan, long: 127, address: nil, units: units) == nil, "NaN is falsy")
        #expect(WeatherRequests.url(base: "b", lat: 0, long: 127, address: "", units: units) == nil)
    }

    @Test func webKitEncodesTheURLItSends() throws {
        let kma = try #require(WeatherRequests.requestURL(
            "https://h.test/v000903/kma/addr/서울특별시/중구/명동?temperatureUnit=C&windSpeedUnit=m/s&airForecastSource=kaq"))
        #expect(kma.absoluteString == "https://h.test/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/"
                + "%EC%A4%91%EA%B5%AC/%EB%AA%85%EB%8F%99?temperatureUnit=C&windSpeedUnit=m/s&airForecastSource=kaq")
        let free = try #require(WeatherRequests.requestURL("https://h.test/weather/v000903/addr/United Kingdom London?a=b"))
        #expect(free.absoluteString == "https://h.test/weather/v000903/addr/United%20Kingdom%20London?a=b")
        let marks = try #require(WeatherRequests.requestURL("https://h.test/p/{x}`'?q='`{}#frag"))
        #expect(marks.absoluteString == "https://h.test/p/%7Bx%7D%60'?q=%27%60%7B%7D",
                "' stays in the path; the fragment is not sent")
        #expect(WeatherRequests.requestURL("/weather/v000903/coord/1,2") == nil, "no server: nothing is requested")
    }
}
