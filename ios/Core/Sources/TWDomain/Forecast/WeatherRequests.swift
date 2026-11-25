import Foundation
import TWModel

/// The weather request of the Cordova app (`getWeatherByGeoInfo` and its URL builders in service.weatherutil.js), with
/// path version `v000903` for every call (#2948). Port of the Android `WeatherRequests`, with JavaScript's number
/// text for the coordinates (the Cordova code concatenates `location.lat` into the path).
public enum WeatherRequests {
    public static let version = "v000903"

    /// `_getHttp(url)` in `getWeatherByGeoInfo`: each attempt ends after 10 s (`_retryGetHttp`'s default timeout).
    public static let timeout = Duration.seconds(10)
    /// `_retryGetHttp(3, …)`: up to three attempts, the next one 2 s after the previous while none has settled.
    public static let attempts = 3
    public static let attemptGap = Duration.seconds(2)

    /// Whether a place's coordinates are its location: Cordova's `if (location.lat)` prefers the address at latitude 0 (A05);
    /// without an address the coordinates stand (a linked place on the equator, #3097). The request, the weather key and
    /// `updateCity`'s location all follow this one rule (Android CODEX-3164-5, -11, -13).
    public static func usesCoordinates(lat: Double?, address: String?) -> Bool {
        guard let lat, !lat.isNaN else { return false }
        return lat != 0 || (address ?? "").isEmpty
    }

    /// The URL for a place, or nil when it has neither a usable location nor an address (Cordova rejects with "Need
    /// location or address", `invalid_input`).
    ///
    /// - Coordinates win when they are the place's location (`usesCoordinates`; A05: latitude 0 falls back to the address
    ///   when there is one):
    ///   `/weather/v000903/coord/{lat},{long}` and the units.
    /// - An address gets `대한민국 ` when it lacks it and is split into a KMA town: `/v000903/kma/addr/{first}/{second}/
    ///   {third}` (empty parts left out) and the units.
    /// - When no part of the town is left, the free-form route `/weather/v000903/addr/{address as stored}` and the units.
    ///   The legacy server does not serve it: through the gateway it answers HTTP 501 (docs/architecture/mobile-api.md),
    ///   which fails the request as any error status does.
    ///
    /// Nothing is percent-encoded here, as in Cordova; `WeatherRequests.requestURL` encodes the string as WebKit does.
    /// `units` are the `Units.getAllUnits()` pairs in order.
    public static func url(base: String, lat: Double?, long: Double?, address: String?,
                           units: [(String, String)]) -> String? {
        if let lat, let long, usesCoordinates(lat: lat, address: address) {
            return "\(base)/weather/\(version)/coord/\(Js.numberToString(lat)),\(Js.numberToString(long))\(unitsQuery(units))"
        }
        guard let address, !address.isEmpty else { return nil }
        let full = JSString.includes(address, "대한민국") ? address : "대한민국 " + address
        let town = AddressFormat.town(AddressFormat.split(full))
        if town.first.isEmpty && town.second.isEmpty && town.third.isEmpty {
            return "\(base)/weather/\(version)/addr/\(address)\(unitsQuery(units))"
        }
        let parts = [town.first, town.second, town.third].filter { !$0.isEmpty }.map { "/" + $0 }.joined()
        return "\(base)/\(version)/kma/addr\(parts)\(unitsQuery(units))"
    }

    /// `_getUnitsParams`: every unit in `Units.getAllUnits()` order, then `airForecastSource=kaq`.
    public static func unitsQuery(_ units: [(String, String)]) -> String {
        var query = ""
        for (i, (key, value)) in units.enumerated() {
            query += (i == 0 ? "?" : "&") + key + "=" + value
        }
        return query + "&airForecastSource=kaq"
    }

    public static func coordinateForecastURL(base: String, lat: Double, long: Double, product: String) -> URL? {
        requestURL("\(base)/weather/\(version)/coord/\(Js.numberToString(lat)),\(Js.numberToString(long))/\(product)")
    }

    /// The URL WebKit requests for `text`, which `$http` passes as written: the path and query keep their characters
    /// except those WebKit's URL parser (the WHATWG percent-encode sets) encodes as UTF-8: controls, spaces, `"`, `<`,
    /// `>` and every non-ASCII character, `` ` ``, `{` and `}` in the path, `'` in the query. A `#` starts the
    /// fragment, which is not sent. Foundation's `URL` refuses `` ` ``, `{`, `}`, `|`, `\` and `^` anywhere, so those
    /// are encoded in the query too (WebKit would send them raw there; no weather URL has them: the query holds the
    /// ASCII unit choices). Nil when `text` is no absolute URL.
    public static func requestURL(_ text: String) -> URL? {
        let withoutFragment = text.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? text
        var out = ""
        var inQuery = false
        for scalar in withoutFragment.unicodeScalars {
            if scalar == "?" { inQuery = true }
            let v = scalar.value
            let encode = v <= 0x20 || v >= 0x7F || scalar == "\"" || scalar == "<" || scalar == ">" || scalar == "`"
                || scalar == "{" || scalar == "}" || scalar == "|" || scalar == "\\" || scalar == "^"
                || (inQuery && scalar == "'")
            if encode {
                for byte in String(scalar).utf8 { out += String(format: "%%%02X", byte) }
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
        guard let url = URL(string: out, encodingInvalidCharacters: false), url.scheme != nil, url.host != nil else { return nil }
        return url
    }
}
