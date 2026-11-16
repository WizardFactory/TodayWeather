import Foundation
import os
import TWDomain
import TWModel
import TWStorage

/// What a page's request gave: the answer, or nothing after a failure.
public enum PageLoad<Value: Sendable>: Sendable {
    case loaded(Value)
    /// The request failed: an error status, no answer in time, or an answer the page cannot read.
    case failed
}

/// The requests of the nationwide pages and the warnings (IN-13, #2962), with path version `v000903` and the WebView's
/// `Accept-Language` (`ShellLocale.acceptLanguage`): `getNationWeather(Util.region)` for S10 and S11, and `getData` of
/// KmaSpecialCtrl for S12. Each page sends its request when it opens (the Cordova states have `cache: false`). Without a
/// server URL (the private build input `TW_SERVER_URL`) nothing is sent and the request fails. Port of the Android
/// `NationSource` (AN-13).
public struct NationSource: Sendable {
    /// `_getHttp(url, 20000)` of `getNationWeather`: each attempt ends after 20 s.
    public static let nationTimeout = Duration.seconds(20)
    /// `$http({timeout: 3000})` of KmaSpecialCtrl.
    public static let specialTimeout = Duration.seconds(3)

    private let baseURL: String?
    private let http: any WeatherHTTP
    private let clock: any AppClock
    private static let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "nation")

    public init(baseURL: String?, http: any WeatherHTTP = URLSessionGet(), clock: any AppClock = SystemClock()) {
        self.baseURL = baseURL.flatMap { $0.isEmpty ? nil : $0 }
        self.http = http
        self.clock = clock
    }

    /// `getNationWeather(region)`: `_getHttp(url, 20000)`, so up to three attempts 2 s apart; the first to settle
    /// decides, a failure included. The callback reads `data.weather` and `data.air`, so a body that is not a JSON
    /// object fails (a text body leaves the page without values, `null` throws there).
    public func nation(region: String, units: UnitSettings, acceptLanguage: String) async -> PageLoad<NationResponse> {
        guard let baseURL, let url = WeatherRequests.requestURL(Self.nationURL(base: baseURL, region: region, units: units)) else {
            return .failed
        }
        let http = self.http
        let headers = ["Accept-Language": acceptLanguage]
        Self.log.info("nation request")
        let body = await firstSettled(attempts: WeatherRequests.attempts, gap: WeatherRequests.attemptGap,
                                      timeout: Self.nationTimeout, clock: clock) {
            try await http.get(url, headers: headers)
        }
        guard case .success(let data) = body, case .object(let o)? = try? JSONValue.parse(data) else {
            Self.log.info("nation response failed")
            return .failed
        }
        Self.log.info("nation response loaded")
        return .loaded(NationResponse(json: o))
    }

    /// `getData(url)` of KmaSpecialCtrl: one GET with `$http`'s 3 s timeout and `responseType: 'json'`. A body that is
    /// not JSON reads as null, as the WebView gives it, and shows no card.
    public func special(acceptLanguage: String) async -> PageLoad<JSONValue> {
        guard let baseURL, let url = WeatherRequests.requestURL(Self.specialURL(base: baseURL)) else { return .failed }
        let http = self.http
        let headers = ["Accept-Language": acceptLanguage]
        Self.log.info("special request")
        let body = await withTimeout(Self.specialTimeout, clock: clock) { try await http.get(url, headers: headers) }
        guard case .success(let data) = body else {
            Self.log.info("special response failed")
            return .failed
        }
        Self.log.info("special response loaded")
        return .loaded((try? JSONValue.parse(data)) ?? .null)
    }

    /// `clientConfig.serverUrl + '/v000903/nation/' + nationCode + _getUnitsParams()`.
    public static func nationURL(base: String, region: String, units: UnitSettings) -> String {
        "\(base)/\(WeatherRequests.version)/nation/\(region)" + WeatherRequests.unitsQuery(UnitSettings.keys.map { ($0, units.value($0)) })
    }

    /// `_makeQueryUrl`: `clientConfig.serverUrl + '/v000903/kma/special'`.
    public static func specialURL(base: String) -> String { "\(base)/\(WeatherRequests.version)/kma/special" }
}
