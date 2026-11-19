import Foundation
import TWDomain
import TWModel

enum WidgetRefresh {
    static func weather(for place: WidgetPlace, at now: Date) async -> WidgetWeather? {
        guard WidgetStore.expiry(at: now) != nil, stillConfigured(place) else { return nil }
        let cached = WidgetStore.weather(for: place.id)
        // Share the app's latest successful load instead of making an identical request on every activation.
        if let cached, (0..<600).contains(now.timeIntervalSince(cached.date)) { return cached }
        guard let url = place.request else { return cached }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue(AppLanguage.acceptLanguage(Locale.preferredLanguages), forHTTPHeaderField: "Accept-Language")
        let fetched: WidgetWeather?
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                  let converted = try WeatherConverter.convert(JSONValue.parse(data)) else {
                throw URLError(.cannotParseResponse)
            }
            fetched = WidgetWeatherProjection.make(converted, updatedAt: Date())
        } catch {
            fetched = nil
        }
        // A fetch may span the deadline, a place deletion, a unit change or a new GPS fix.
        guard WidgetStore.expiry(at: Date()) != nil, stillConfigured(place) else { return nil }
        if let fetched, WidgetStore.save(fetched, for: place) { return fetched }
        return WidgetStore.weather(for: place.id)
    }

    private static func stillConfigured(_ place: WidgetPlace) -> Bool {
        WidgetStore.places().contains { $0.id == place.id && $0.request == place.request }
    }
}
