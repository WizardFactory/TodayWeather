import Foundation
import os
import TWDomain
import TWModel
import TWStorage

/// The geocoding of the start page and the place search (`getGeoInfoByLocation` and `getGeoInfoByAddr` in
/// service.weatherutil.js, #2959): `/geocode/v000903/coord/{lat},{long}` and `/geocode/v000903/addr/{address}` of the
/// legacy server, sent as the weather requests are (`_getHttp`: 10 s per attempt, three attempts 2 s apart, the first to
/// settle decides, with the WebView's `Accept-Language`). The text is built as Cordova concatenates it and encoded as
/// WebKit encodes it (`WeatherRequests.requestURL`). An answer is the body as JSON (`data.data`); a body that is no JSON
/// object reads as one without fields. Port of the Android `GeocodeClient` (AN-10).
///
/// Without a server (`baseURL` nil: the private build input `TW_SERVER_URL` is not set) nothing is requested and every
/// lookup fails.
public struct GeocodeClient: Sendable {
    private let baseURL: String?
    private let http: any WeatherHTTP
    private let clock: any AppClock

    public init(baseURL: String?, http: any WeatherHTTP = URLSessionGet(), clock: any AppClock = SystemClock()) {
        self.baseURL = baseURL.flatMap { $0.isEmpty ? nil : $0 }
        self.http = http
        self.clock = clock
    }

    /// The place at `location` (already rounded to three decimals) with its name; nil when the request fails.
    public func byLocation(_ location: Location, acceptLanguage: String) async -> JSONObject? {
        let path = "/geocode/\(WeatherRequests.version)/coord/\(Js.numberToString(location.lat)),\(Js.numberToString(location.long))"
        return await get(path, acceptLanguage: acceptLanguage)
    }

    /// The place of `address`, without a name; nil when the request fails.
    public func byAddress(_ address: String, acceptLanguage: String) async -> JSONObject? {
        await get("/geocode/\(WeatherRequests.version)/addr/\(address)", acceptLanguage: acceptLanguage)
    }

    private func get(_ path: String, acceptLanguage: String) async -> JSONObject? {
        guard let baseURL, let url = WeatherRequests.requestURL(baseURL + path) else { return nil }
        let route = path.contains("/coord/") ? "coord" : "addr"
        // The route is public; the place is the user's and stays private in the log.
        Self.log.info("geocode request \(route, privacy: .public) \(path, privacy: .private)")
        let http = self.http
        let headers = ["Accept-Language": acceptLanguage]
        let body = await firstSettled(attempts: WeatherRequests.attempts, gap: WeatherRequests.attemptGap,
                                      timeout: WeatherRequests.timeout, clock: clock) {
            try await http.get(url, headers: headers)
        }
        guard case .success(let data) = body, let json = try? JSONValue.parse(data) else {
            Self.log.info("geocode response \(route, privacy: .public) failed")
            return nil
        }
        Self.log.info("geocode response \(route, privacy: .public) loaded")
        return json.objectValue ?? JSONObject()
    }

    private static let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "geocode")

    /// A `geoInfo` as a place: its `name`, `address`, `country` and `location` (when both coordinates are numbers), as
    /// `saveCity` copies them.
    public static func place(_ geoInfo: JSONObject, currentPosition: Bool) -> Place {
        var location: Location?
        if let lat = geoInfo["location"]?["lat"]?.numberValue?.double, let long = geoInfo["location"]?["long"]?.numberValue?.double {
            location = Location(lat: lat, long: long)
        }
        return Place(currentPosition: currentPosition, disable: false, name: geoInfo["name"]?.stringValue,
                     address: geoInfo["address"]?.stringValue, country: geoInfo["country"]?.stringValue, location: location)
    }
}
