import CryptoKit
import Foundation
import Observation
import os
import TWDomain
import TWModel
import TWStorage

/// A GET with request headers that gives the body of a successful response; an error status throws (`URLSessionGet`
/// throws `StatusError`, as Angular's `$http` rejects with the status in `err.code`).
public protocol WeatherHTTP: Sendable {
    func get(_ url: URL, headers: [String: String]) async throws -> Data
}

extension URLSessionGet: WeatherHTTP {
    public func get(_ url: URL, headers: [String: String]) async throws -> Data {
        var request = URLRequest(url: url)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw StatusError(status: http.statusCode)
        }
        return data
    }
}

/// A place's weather fields as `updateCity` keeps them (`currentWeather`, `timeChart`, `dayChart`, …) and when they came.
public struct WeatherEntry: Sendable, Equatable {
    public let weather: JSONObject
    public let loadedAt: Date

    public init(weather: JSONObject, loadedAt: Date) {
        self.weather = weather
        self.loadedAt = loadedAt
    }
}

public enum LoadResult: Sendable {
    /// The response applied to the place that requested it; `place` carries what the response changed in it.
    case loaded(key: String, entry: WeatherEntry, place: Place)
    /// Loaded less than ten minutes ago in this process (`canLoadCity`), or disabled.
    case skipped
    /// A later request for the same place was sent; its answer counts.
    case superseded
    /// No weather: the place has neither coordinates nor address (`invalid_input`), the request failed (`network`:
    /// an error status, a timeout, no connection), or the body did not parse or convert (`unconvertible`: JSON that
    /// `convertWeatherData` could not convert).
    case failed(network: Bool, unconvertible: Bool)
}

/// The weather of the saved places (#2957): the request of `getWeatherByGeoInfo`, the response conversion and the city
/// updates of `WeatherInfo`. A response applies to the place that requested it, whichever place is selected when it
/// arrives (V09, the A01 fix decided in AN-06): entries are keyed by the place (`key`), and only the latest request of
/// a key applies; an answer to an older request, a failure included, is `superseded`. The rest is the Cordova
/// behavior: fields a response leaves out keep their old value (A02), the ten-minute gate lives in memory only, and a
/// failure keeps what was there. Entries are cached in `cacheDirectory`, as the Cordova app kept the weather with the
/// city, so a cold start shows them while it loads. Port of the Android `WeatherRepository`.
///
/// Without a server (`baseURL` nil: the private build input `TW_SERVER_URL` is not set) nothing is requested and every
/// load fails like a request that found no server.
@MainActor
@Observable
public final class WeatherRepository {
    /// `canLoadCity`'s ten minutes.
    public nonisolated static let gate = Duration.seconds(600)

    /// The weather fields `updateCity` replaces, each only when the response's value is truthy (A02).
    public nonisolated static let weatherFields = ["currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "source",
                                       "airInfo", "airInfoList"]

    @ObservationIgnored private let baseURL: String?
    @ObservationIgnored private let cacheDirectory: URL?
    @ObservationIgnored private let http: any WeatherHTTP
    @ObservationIgnored private let clock: any AppClock
    @ObservationIgnored private var loadTimes: [String: Date] = [:]
    @ObservationIgnored private var latestRequest: [String: Int] = [:]
    @ObservationIgnored private var requests = 0

    /// Entries by place key, as loaded or read from the cache in this process.
    public private(set) var weather: [String: WeatherEntry] = [:]
    /// Keys of the places with a request in flight (the title's spinner).
    public private(set) var loading: Set<String> = []

    public init(baseURL: String?, cacheDirectory: URL?, http: any WeatherHTTP = URLSessionGet(),
                clock: any AppClock = SystemClock()) {
        self.baseURL = baseURL.flatMap { $0.isEmpty ? nil : $0 }
        self.cacheDirectory = cacheDirectory
        self.http = http
        self.clock = clock
    }

    /// `canLoadCity`: a disabled place never; otherwise not loaded in this process, or more than ten minutes ago.
    public func canLoad(_ place: Place) -> Bool {
        if place.disable { return false }
        guard let loaded = loadTimes[Self.key(place)] else { return true }
        return clock.now.timeIntervalSince(loaded) > 600
    }

    /// `reloadCity`: the next gated load of `place` runs.
    public func invalidate(_ place: Place) { loadTimes[Self.key(place)] = nil }

    /// Every place's next gated load runs (a unit or setting change resets `loadTime` of every city).
    public func invalidateAll() { loadTimes.removeAll() }

    /// The weather `place` has: from this process, else from the cache.
    public func cached(_ place: Place) -> WeatherEntry? {
        let key = Self.key(place)
        if let entry = weather[key] { return entry }
        guard let entry = readCache(key) else { return nil }
        weather[key] = entry
        return entry
    }

    /// Loads `place` unless the gate stops it (`force` bypasses the gate, as a tab tap, the retry button and the timer
    /// do, after `reloadCity`). `acceptLanguage` is the WebView's header (`ShellLocale.acceptLanguage`).
    public func load(_ place: Place, units: UnitSettings, acceptLanguage: String, force: Bool) async -> LoadResult {
        if place.disable || (!force && !canLoad(place)) { return .skipped }
        let location = place.location
        guard let text = WeatherRequests.url(base: baseURL ?? "", lat: location?.lat, long: location?.long,
                                             address: place.address, units: UnitSettings.keys.map { ($0, units.value($0)) })
        else { return .failed(network: false, unconvertible: false) }
        let key = Self.key(place)
        requests += 1
        let request = requests
        latestRequest[key] = request
        loading.insert(key)
        // The route is public; the place's coordinates or address are the user's and stay private in the log.
        let route = text.contains("/coord/") ? "coord" : text.contains("/kma/addr") ? "kma-addr" : "addr"
        Self.log.info("weather request \(request, privacy: .public) \(route, privacy: .public) \(text, privacy: .private)")
        let http = self.http, clock = self.clock
        let url = baseURL == nil ? nil : WeatherRequests.requestURL(text)
        let headers = ["Accept-Language": acceptLanguage]
        // `_getHttp`: the attempts of `_retryGetHttp`; then `$http`'s JSON parsing and `convertWeatherData`, off the
        // main actor.
        let outcome: Outcome = await Task.detached {
            guard let url else { return .network }
            let body = await firstSettled(attempts: WeatherRequests.attempts, gap: WeatherRequests.attemptGap,
                                          timeout: WeatherRequests.timeout, clock: clock) {
                try await http.get(url, headers: headers)
            }
            guard case .success(let data) = body else { return .network }
            // `$http` parses the body as `JSON.parse` does (the server answers with a JSON content type) and rejects it
            // when it cannot.
            guard let json = try? JSONValue.parse(data) else { return .network }
            guard let converted = try? WeatherConverter.convert(json) else { return .unconvertible }
            return .converted(converted)
        }.value
        if latestRequest[key] == request { loading.remove(key) }
        Self.log.info("weather response \(request, privacy: .public) \(String(describing: outcome.label), privacy: .public)")
        // An answer to a request a later one replaced counts for nothing, a failure included.
        guard latestRequest[key] == request else { return .superseded }
        switch outcome {
        case .network: return .failed(network: true, unconvertible: false)
        case .unconvertible: return .failed(network: false, unconvertible: true)
        case .converted(let city):
            // Stored at once on the main actor, so a slower answer of an older request cannot follow a newer one.
            let entry = WeatherEntry(weather: Self.merge(cached(place)?.weather, city), loadedAt: clock.now)
            let updated = Self.updatePlace(place, city)
            let newKey = Self.key(updated)
            loadTimes[key] = entry.loadedAt
            // A place that gets its coordinates from the response is found under its new key from now on.
            if newKey != key { loadTimes[newKey] = entry.loadedAt }
            weather[key] = entry
            weather[newKey] = entry
            writeCache(key, entry)
            if newKey != key { writeCache(newKey, entry) }
            return .loaded(key: key, entry: entry, place: updated)
        }
    }

    private enum Outcome: Sendable {
        case network, unconvertible
        case converted(JSONObject)

        var label: String {
            switch self {
            case .network: "failed"
            case .unconvertible: "unconvertible"
            case .converted: "loaded"
            }
        }
    }

    private nonisolated static let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "weather")

    /// Which place a request and its entry belong to: the current position, else its coordinates, else its address.
    public nonisolated static func key(_ place: Place) -> String {
        if place.currentPosition { return "current" }
        if let location = place.location, location.lat != 0, !location.lat.isNaN {
            return "coord:\(Js.numberToString(location.lat)),\(Js.numberToString(location.long))"
        }
        return "addr:\(place.address ?? "")"
    }

    /// `updateCity`'s weather fields: the previous ones, replaced by the converted response's truthy values.
    public nonisolated static func merge(_ previous: JSONObject?, _ converted: JSONObject) -> JSONObject {
        var fields = JSONObject()
        for (k, v) in previous ?? JSONObject() where weatherFields.contains(k) { fields[k] = v }
        for field in weatherFields {
            if let v = converted[field], Js.truthy(v) { fields[field] = v }
        }
        return fields
    }

    /// `updateCity`'s place fields: the current position takes the response's name, country, address and location; a
    /// saved place without a usable location takes the response's (old saved cities, #1971).
    public nonisolated static func updatePlace(_ place: Place, _ converted: JSONObject) -> Place {
        let location = converted["location"].flatMap { Js.truthy($0) ? Self.location($0) : nil }
        var updated = place
        if place.currentPosition {
            updated.name = text(converted["name"]) ?? place.name
            updated.country = text(converted["country"]) ?? place.country
            updated.address = text(converted["address"]) ?? place.address
            updated.location = location ?? place.location
            return updated
        }
        let own = place.location
        let hasLocation = own.map { $0.lat != 0 && !$0.lat.isNaN } ?? false
        if !hasLocation, let location, location.lat != 0 { updated.location = location }
        return updated
    }

    private nonisolated static func text(_ value: JSONValue?) -> String? {
        guard case .string(let s)? = value, !s.isEmpty else { return nil }
        return s
    }

    private nonisolated static func location(_ value: JSONValue) -> Location? {
        guard let lat = value["lat"]?.numberValue?.double, let long = value["long"]?.numberValue?.double else { return nil }
        return Location(lat: lat, long: long)
    }

    // MARK: - File cache

    private func cacheFile(_ key: String) -> URL? {
        guard let cacheDirectory else { return nil }
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return cacheDirectory.appendingPathComponent("\(name).json")
    }

    private func readCache(_ key: String) -> WeatherEntry? {
        guard let file = cacheFile(key), let data = try? Data(contentsOf: file), let o = try? JSONValue.parse(data),
              let weather = o["weather"]?.objectValue, let at = o["loadedAt"]?.numberValue?.double else { return nil }
        return WeatherEntry(weather: weather, loadedAt: Date(timeIntervalSince1970: at / 1000))
    }

    /// The whole file is replaced at once (written to a temporary file, then renamed): a reader sees the old entry or
    /// the new one, never half. A failed write leaves the cache as it was.
    private func writeCache(_ key: String, _ entry: WeatherEntry) {
        guard let file = cacheFile(key) else { return }
        let record = JSONValue.object(JSONObject([
            ("loadedAt", .number((entry.loadedAt.timeIntervalSince1970 * 1000).rounded())),
            ("weather", .object(entry.weather)),
        ]))
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(record.jsonText.utf8).write(to: file, options: .atomic)
    }
}

/// The weather a place shows: its entry's fields with the place's own (`cities[index]` of the Cordova app).
public func cityRecord(_ place: Place, _ entry: WeatherEntry?) -> JSONObject {
    var fields = entry?.weather ?? JSONObject()
    if let name = place.name { fields["name"] = .string(name) }
    if let address = place.address { fields["address"] = .string(address) }
    if let country = place.country { fields["country"] = .string(country) }
    if let location = place.location {
        fields["location"] = .object(JSONObject([("lat", .number(location.lat)), ("long", .number(location.long))]))
    }
    fields["currentPosition"] = .bool(place.currentPosition)
    if let photo = place.photo { fields["photo"] = .string(photo) }
    return fields
}
