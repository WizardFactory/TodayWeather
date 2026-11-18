import Foundation

struct WidgetPlace: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let request: URL?
}

struct WidgetForecast: Codable, Equatable, Sendable {
    let label: String
    let temperature: String
    let symbol: String
}

struct WidgetWeather: Codable, Equatable, Sendable {
    let date: Date
    let temperature: String
    let symbol: String
    let high: String
    let low: String
    let air: String
    let daily: [WidgetForecast]
    let hourly: [WidgetForecast]
}

enum WidgetVisit {
    static func expiry(lastActive: Date?, now: Date) -> Date? {
        guard let lastActive, lastActive <= now else { return nil }
        let deadline = lastActive.addingTimeInterval(5 * 24 * 60 * 60)
        return now < deadline ? deadline : nil
    }
}

/// The app owns the visit and catalog. App and extension may each publish the latest
/// successful forecast. Include the request identity to isolate changes of units/location.
enum WidgetStore {
    static let kind = "TodayWeatherWidget"
    private static var suite: UserDefaults? { UserDefaults(suiteName: "group.net.wizardfactory.todayweather") }
    private static let visitKey = "nativeWidget.lastActive"
    private static let catalogKey = "nativeWidget.catalog"
    private static func weatherKey(_ id: String) -> String { "nativeWidget.weather." + id }

    private struct Catalog: Codable, Equatable {
        let places: [WidgetPlace]
        let selectedID: String?
    }
    private struct Cached: Codable {
        let request: URL?
        let weather: WidgetWeather
    }
    private static func read<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = suite?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    private static func write<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        suite?.set(data, forKey: key)
    }

    static func activated(at date: Date) { suite?.set(date, forKey: visitKey) }

    static func expiry(at now: Date) -> Date? {
        WidgetVisit.expiry(lastActive: suite?.object(forKey: visitKey) as? Date, now: now)
    }

    static func places() -> [WidgetPlace] { read(Catalog.self, key: catalogKey)?.places ?? [] }
    static func selectedID() -> String? { read(Catalog.self, key: catalogKey)?.selectedID }

    @discardableResult
    static func publish(places: [WidgetPlace], selectedID: String?) -> Bool {
        let old = read(Catalog.self, key: catalogKey)
        let next = Catalog(places: places, selectedID: selectedID)
        guard old != next else { return false }
        for prior in old?.places ?? [] where !places.contains(where: { $0.id == prior.id && $0.request == prior.request }) {
            suite?.removeObject(forKey: weatherKey(prior.id))
        }
        write(next, key: catalogKey)
        return true
    }

    static func weather(for id: String) -> WidgetWeather? {
        guard expiry(at: Date()) != nil,
              let place = places().first(where: { $0.id == id }),
              let entry = read(Cached.self, key: weatherKey(id)),
              entry.request == place.request else { return nil }
        return entry.weather
    }

    @discardableResult
    static func save(_ weather: WidgetWeather, for place: WidgetPlace) -> Bool {
        let id = place.id
        guard places().contains(where: { $0.id == id && $0.request == place.request }),
              expiry(at: Date()) != nil else { return false }
        if let prior = self.weather(for: id), prior.date >= weather.date { return false }
        write(Cached(request: place.request, weather: weather), key: weatherKey(id))
        return true
    }
}
